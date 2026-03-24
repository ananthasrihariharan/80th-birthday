import * as dbService from '../supabase-service.js';

const MAX_SCAN_SIZE = 800; // Increased for better detail on high-res mobile cameras
const SCAN_INTERVAL_MS = 250; // Slower for mobile CPU stability
let lastScanTime = 0;

// Scanner Scope Variables
let scanVideo, scanCanvas, scanContext, scanToast;
let scannerActive = false;
let videoStream = null;
let waiterListeners = [];
let allAvailableDishes = [];
let lastWaiterQueue = [];

export function initWaiterDashboard(showScreen, showToast, currentUser) {
    showScreen('screen-waiter');
    
    // Stop any existing scanner first
    stopScanner();
    initScanner(showToast);

    // Cleanup existing listeners
    waiterListeners.forEach(unsub => { if(typeof unsub === 'function') unsub(); });
    waiterListeners = [];

    // Expose for manual retry if needed
    window.retryWaiterScanner = () => initScanner(showToast);

    waiterListeners.push(dbService.listenToDishes((dishes) => {
        allAvailableDishes = dishes;
        if (lastWaiterQueue.length > 0) renderWaiterQueue(lastWaiterQueue);
    }));

    waiterListeners.push(dbService.listenToAssignedGuests(currentUser.phoneNumber, (guests) => {
        lastWaiterQueue = guests;
        renderWaiterQueue(guests);
    }));
}

function initScanner(showToast) {
    scanVideo = document.getElementById('waiter-video');
    scanCanvas = document.getElementById('scan-canvas');
    scanToast = showToast;

    if (!scanVideo || !scanCanvas) return;
    if (scannerActive) return;

    // 1. Check for Secure Context (HTTPS/Localhost)
    const isSecure = window.isSecureContext ||
        window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

    if (!isSecure) {
        console.error("❌ Camera access blocked (Insecure Context)");
        showToast('Camera requires HTTPS or Localhost 🔒', 'error');

        const btn = document.getElementById('btn-retry-camera');
        if (btn) {
            btn.style.display = 'block';
            btn.innerHTML = "Why is camera blocked? ℹ️";
            btn.onclick = () => {
                alert(
                    "📱 MOBILE CAMERA SECURITY:\n\n" +
                    "To protect your privacy, mobile browsers only allow camera access on 'Secure Connections' (HTTPS).\n\n" +
                    "FOR LOCAL TESTING:\n" +
                    "1. Use 'localhost' on your PC (works automatically)\n" +
                    "2. On phones, use a tool like 'ngrok' to get a free HTTPS link\n" +
                    "3. Or deploy to a secure host like GitHub Pages/Vercel."
                );
            };
        }
        return;
    }

    scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });

    const startCamera = async (constraints) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log("✅ Camera stream acquired");
            videoStream = stream;
            scanVideo.srcObject = stream;
            scanVideo.setAttribute('playsinline', true);
            scanVideo.muted = true; // Ensure muted for mobile auto-play

            await scanVideo.play().catch(e => console.warn("Video play delayed:", e));
            scannerActive = true;

            if (!window.jsQR) {
                console.error("❌ jsQR library not found on window");
                showToast('Scanner library error 🛠️', 'error');
            }

            requestAnimationFrame(tick);
        } catch (err) {
            throw err;
        }
    };

    // Try high-resolution first, then fallback
    const constraintsSet = [
        { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: 'environment' } },
        { video: true }
    ];

    const tryConstraints = async (index) => {
        if (index >= constraintsSet.length) {
            console.error("❌ All camera constraints failed");
            showToast('Camera not found or blocked 📸', 'error');
            const btn = document.getElementById('btn-retry-camera');
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = "Retry Camera 📸";
            }
            return;
        }

        try {
            console.log(`📡 Trying camera constraint set ${index}...`);
            await startCamera(constraintsSet[index]);
        } catch (err) {
            console.warn(`⚠️ Constraint set ${index} failed (${err.name}):`, err.message);
            await tryConstraints(index + 1);
        }
    };

    tryConstraints(0);
}

function tick(time) {
    try {
        const screen = document.getElementById('screen-waiter');
        if (!screen || !screen.classList.contains('active')) {
            stopScanner();
            return;
        }

        if (!scannerActive || !scanVideo || !scanCanvas || !scanContext) return;

        // Check if video is actually playing and has dimensions
        if (scanVideo.readyState >= 2 && scanVideo.videoWidth > 0) {
            // Throttling
            if (time - lastScanTime > SCAN_INTERVAL_MS) {
                lastScanTime = time;

                const videoWidth = scanVideo.videoWidth;
                const videoHeight = scanVideo.videoHeight;

                // Safety guard for dimensions
                if (videoWidth > 0 && videoHeight > 0) {
                    const scale = Math.min(MAX_SCAN_SIZE / videoWidth, MAX_SCAN_SIZE / videoHeight, 1.0);

                    if (scanCanvas.width !== videoWidth * scale) {
                        scanCanvas.width = videoWidth * scale;
                        scanCanvas.height = videoHeight * scale;
                    }

                    scanContext.drawImage(scanVideo, 0, 0, scanCanvas.width, scanCanvas.height);
                    const imageData = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);

                    if (window.jsQR) {
                        try {
                            const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
                                inversionAttempts: 'attemptBoth',
                            });

                             if (code) {
                                 console.log("📍 QR Found! Data:", code.data);
                                 
                                 // 1. Trigger Success Animation
                                 const wrap = document.querySelector('.scan-wrap');
                                 if (wrap) {
                                     wrap.classList.add('success');
                                     wrap.style.borderColor = "#4CAF50";
                                     setTimeout(() => {
                                         wrap.classList.remove('success');
                                         wrap.style.borderColor = "";
                                     }, 600);
                                 }
                                 
                                 // 2. Haptic Feedback
                                 if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

                                 // 3. Process Result (Normalized)
                                 let phoneToProcess = code.data.trim();
                                 try {
                                     const parsed = JSON.parse(code.data);
                                     phoneToProcess = parsed.phone || phoneToProcess;
                                 } catch (e) { /* Not JSON */ }

                                 handleScanResult(phoneToProcess);
                             } else {
                                 // No QR code in current frame
                             }
                         } catch (qrErr) {
                             console.error("❌ jsQR internal error:", qrErr);
                         }
                     } else {
                         console.error("❌ jsQR library missing from window object! Check your script tags in index.html.");
                         if (Math.random() < 0.05) alert("QR Scanner library missing! 🛠️");
                     }
                }
            }
        }
    } catch (criticalError) {
        console.error("❌ Critical error in scanner tick:", criticalError);
    }

    if (scannerActive) requestAnimationFrame(tick);
}

function stopScanner() {
    scannerActive = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (scanVideo) {
        scanVideo.srcObject = null;
    }
}

async function handleScanResult(phone) {
    if (!phone) return;
    
    // De-bounce and Pause
    const now = Date.now();
    if (now - lastScanTime < 2000) return; 
    lastScanTime = now;

    console.log("🎯 QR Scanned:", phone);
    
    // Visual feedback
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    
    // Stop scanner to show result
    stopScanner();
    
    // Attempt check-in
    await checkInGuest(phone);
    setTimeout(() => {
        if (videoStream) scannerActive = true;
        requestAnimationFrame(tick);
    }, 3000);
}

function renderCurrentSessionDishes(guest) {
    const currentSess = getCurrentSessionKey();
    const selections = guest.menu_selections || {};
    const data = selections[currentSess] || { dishes: [], fav: "" };

    if (!data || (!data.dishes && !guest.dishes)) {
        return '<span class="text-[10px] opacity-40">No dishes selected yet</span>';
    }

    const dishes = data.dishes || guest.dishes || [];
    
    // Resolve IDs to Names
    const names = dishes.map(id => {
        const d = allAvailableDishes.find(item => item.id === id);
        return d ? d.name : id;
    });

    const html = names.map(n => `<span class="px-2 py-1 bg-white rounded text-[10px] font-bold border border-gold-light/20">✦ ${n}</span>`).join('');
    const favNote = data.fav || guest.fav_dish;
    const favHtml = favNote ? `<div class="w-full mt-2 p-2 bg-red-50 border-l-4 border-red-500 rounded animate-pulse"><p class="text-[10px] text-red-700 font-extrabold italic uppercase tracking-wider">⚠️ Special Request: ${favNote}</p></div>` : '';
    
    return `<div class="flex flex-wrap gap-1">${html}</div>${favHtml}`;
}

function renderWaiterQueue(guests) {
    const container = document.getElementById('waiter-queue');
    if (!container) return;

    if (!guests || guests.length === 0) {
        container.innerHTML = '<p class="no-data">No guests assigned yet 🌸</p>';
        return;
    }

    container.innerHTML = guests.map(g => `
        <div class="premium-card stagger-in mb-4">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
                ${g.photo_url ? `<img src="${g.photo_url}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);">` : `<div style="width:48px;height:48px;border-radius:50%;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-size:20px;">🌸</div>`}
                <div class="flex-1">
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="font-bold text-brown-deep">${g.name}</h4>
                            <p class="text-[10px] text-gold font-extrabold tracking-widest">TABLE ${g.table_number || '??'}</p>
                        </div>
                        <span class="status-badge ${getStatusClass(g.status)}">${g.status}</span>
                    </div>
                    <p class="text-[10px] text-text-mid font-bold mt-1">📞 ${g.phone} | 👥 ${g.members} guests</p>
                </div>
            </div>
            
            <div class="bg-ivory/50 rounded-xl p-3 border border-cream mb-4">
                <p class="text-[9px] font-extrabold text-gold uppercase mb-2 tracking-widest">Menu Selections</p>
                <div class="grid grid-cols-1 gap-2">
                    ${(g.menu_selections && Object.keys(g.menu_selections).length > 0) ? 
                        Object.entries(g.menu_selections).map(([key, data]) => `
                            <div class="mb-1">
                                <p class="text-[8px] font-bold text-gold/70 uppercase">${key.replace('_', ' ')}</p>
                                <div class="flex flex-wrap gap-1">
                                    ${(data.dishes || []).map(d => `<span class="px-1.5 py-0.5 bg-white rounded text-[8px] font-bold border border-gold-light/20">${d}</span>`).join('')}
                                </div>
                                ${data.fav ? `
                                    <div class="w-full mt-1 p-1.5 bg-red-50 border-l-2 border-red-500 rounded">
                                        <p class="text-[8px] text-red-700 font-bold italic">⚠️ ${data.fav}</p>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('') :
                        `<div class="flex flex-wrap gap-1">
                            ${(g.dishes || []).map(d => `<span class="px-1.5 py-0.5 bg-white rounded text-[8px] font-bold border border-gold-light/20">${d}</span>`).join('')}
                            ${g.fav_dish ? `
                                <div class="w-full mt-2 p-2 bg-red-50 border-l-4 border-red-500 rounded animate-pulse">
                                    <p class="text-[9px] text-red-700 font-black italic uppercase">⚠️ Special Request: ${g.fav_dish}</p>
                                </div>
                            ` : ''}
                        </div>`
                    }
                </div>
                ${(!g.menu_selections || Object.keys(g.menu_selections).length === 0) && (!g.dishes || g.dishes.length === 0) ? '<p class="text-[8px] italic opacity-40">No selections yet</p>' : ''}
            </div>

            <div class="flex gap-2">
                <button onclick="updateStatus('${g.phone}', 'active')" class="btn-gold flex-1 text-[10px] py-2">Active</button>
                <button onclick="updateStatus('${g.phone}', 'served')" class="btn-gold flex-1 text-[10px] py-2" style="background:var(--green-success)">Served</button>
            </div>
        </div>
    `).join('');
}

function getStatusClass(status) {
    switch (status) {
        case 'active': return 'bg-gold-light text-brown-deep';
        case 'hold': return 'bg-yellow-100 text-yellow-800';
        case 'served': return 'bg-green-100 text-green-800';
        default: return 'bg-gray-100';
    }
}

export async function updateStatus(phone, status) {
    try {
        await dbService.updateGuestStatus(phone, status);
    } catch (e) {
        console.error("Status update failed", e);
    }
}

export async function checkInGuest(phoneFromScan) {
    const phoneInput = document.getElementById('checkin-phone');
    const phone = phoneFromScan || (phoneInput ? phoneInput.value.trim() : '');
    if (!phone) return;

    const resultEl = document.getElementById('checkin-result');
    if (resultEl) resultEl.innerHTML = '<p class="text-xs animate-pulse p-4">Fetching details... 🌸</p>';

    try {
        const guest = await dbService.getGuest(phone);

        if (!guest) {
            if (resultEl) resultEl.innerHTML = '<p class="text-red-error p-4 text-xs font-bold">Guest not found! ❌</p>';
            if (scanToast) scanToast('Guest not found ❌', 'error');
            return;
        }

        if (scanToast) scanToast('Guest Found! ✅', 'success');
        
        // Auto-activate on scan if not yet active
        if (guest.status === 'pending') {
            await dbService.updateGuestStatus(guest.phone, 'active');
            if (scanToast) scanToast('Guest Activated! 🚀', 'success');
        }

        // Hide scanner and show result
        const scanArea = document.getElementById('waiter-scan-area');
        if (scanArea) scanArea.style.display = 'none';
        
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `
                <div class="premium-card stagger-in mt-4 border-gold bg-gold-pale overflow-hidden" style="max-width:320px; margin:0 auto;">
                    ${guest.photo_url ? `<img src="${guest.photo_url}" class="w-full h-48 object-cover border-b border-gold-light mb-3">` : `<div class="h-48 bg-cream/30 flex items-center justify-center text-4xl">🌸</div>`}
                    <div class="p-4">
                        <p class="font-bold text-brown-deep text-xl mb-1">${guest.name}</p>
                        <p class="text-[10px] uppercase font-extrabold text-gold tracking-widest mb-4">TABLE ${guest.table_number || 'NONE'} | ${guest.members} GUESTS</p>
                        
                        <div class="p-4 bg-white/80 rounded-2xl border border-gold-light/50">
                            <p class="text-[9px] font-black text-brown-deep uppercase mb-3 tracking-widest">✦ READY TO SERVE</p>
                            ${renderCurrentSessionDishes(guest)}
                        </div>

                        <div class="mt-4 flex gap-2">
                             <button class="btn-gold flex-1 py-3 text-[10px]" onclick="updateStatus('${guest.phone}', 'served'); document.getElementById('checkin-result').style.display='none'; document.getElementById('waiter-scan-area').style.display='block';">Mark Served ✅</button>
                             <button class="btn-gold flex-1 py-3 text-[10px] bg-red-600 border-red-600" style="background:#e5e7eb; color:#4b5563; border-color:#e5e7eb;" onclick="document.getElementById('checkin-result').style.display='none'; document.getElementById('waiter-scan-area').style.display='block';">Close</button>
                        </div>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        console.error("Check-in error:", e);
        if (resultEl) resultEl.innerHTML = '<p class="text-red-error p-4 text-xs font-bold">Connection Error 🙏</p>';
    }
}

function getCurrentSessionKey() {
    const now = new Date();
    const hour = now.getHours();
    // Simple heuristic: adjust based on actual event schedule
    let sess = 'Breakfast';
    if(hour >= 11 && hour < 12) sess = 'Before-Lunch';
    else if(hour >= 12 && hour < 16) sess = 'Lunch';
    else if(hour >= 16 && hour < 19) sess = 'Evening-Snack';
    else if(hour >= 19) sess = 'Dinner';
    
    // Logic for Day 1 vs Day 2 (assuming event starts on a specific date)
    // For now, let's assume 'day1' but you can refine with date checks
    return `day1_${sess}`;
}
