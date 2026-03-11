import * as dbService from '../supabase-service.js';

const MAX_SCAN_SIZE = 800; // Increased for better detail on high-res mobile cameras
const SCAN_INTERVAL_MS = 250; // Slower for mobile CPU stability
let lastScanTime = 0;

// Scanner Scope Variables
let scanVideo, scanCanvas, scanContext, scanToast;
let scannerActive = false;
let videoStream = null;

export function initWaiterDashboard(showScreen, showToast, currentUser) {
    showScreen('screen-waiter');
    initScanner(showToast);

    // Expose for manual retry if needed
    window.retryWaiterScanner = () => initScanner(showToast);

    dbService.listenToAssignedGuests(currentUser.phoneNumber, (guests) => {
        renderWaiterQueue(guests);
    });
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
            showToast('Camera not found or blocked 📸', 'error');
            const btn = document.getElementById('btn-retry-camera');
            if (btn) btn.style.display = 'block';
            return;
        }

        try {
            await startCamera(constraintsSet[index]);
        } catch (err) {
            console.warn(`⚠️ Constraint set ${index} failed:`, err.name);
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
                        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: 'attemptBoth',
                        });

                        if (code) {
                            console.log("📍 QR Found:", code.data);

                            // 1. Trigger Success Animation
                            const wrap = document.querySelector('.scan-wrap');
                            if (wrap) {
                                wrap.classList.add('success');
                                setTimeout(() => wrap.classList.remove('success'), 600);
                            }

                            // 2. Haptic Feedback
                            if (navigator.vibrate) navigator.vibrate(120);

                            // 3. Process Result
                            try {
                                const data = JSON.parse(code.data);
                                handleScanResult(data.phone || data.toString());
                            } catch (e) {
                                const text = code.data.trim();
                                if (/^\+?[\d\s-]{10,}$/.test(text)) handleScanResult(text);
                            }
                        }
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
    if (scanVideo) scanVideo.srcObject = null;
}

async function handleScanResult(phone) {
    if (!scannerActive) return;

    // Pause scanner to give feedback
    scannerActive = false;

    document.getElementById('checkin-phone').value = phone;
    await checkInGuest();

    // Resume after 3 seconds
    setTimeout(() => {
        if (videoStream) scannerActive = true;
        requestAnimationFrame(tick);
    }, 3000);
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
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h4 class="font-bold text-lg">${g.name}</h4>
                    <p class="text-xs text-gold font-bold">TABLE ${g.table_number || '??'}</p>
                </div>
                <span class="status-badge ${getStatusClass(g.status)}">${g.status}</span>
            </div>
            
            <div class="text-xs text-text-mid mb-4">
                <p>📞 ${g.phone}</p>
                <p>👥 ${g.members} members</p>
                <p class="mt-2 text-[10px] font-bold text-brown-warm uppercase">Dishes: ${(g.dishes || []).join(', ')}</p>
                ${g.fav_dish ? `<p class="mt-1 text-[10px] text-gold italic">Special Request: ${g.fav_dish}</p>` : ''}
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

export async function checkInGuest() {
    const phoneInput = document.getElementById('checkin-phone');
    const phone = phoneInput.value.trim();
    if (!phone) return;

    const resultEl = document.getElementById('checkin-result');
    resultEl.innerHTML = '<p class="text-xs animate-pulse">Fetching details... 🌸</p>';

    try {
        const guest = await dbService.getGuest(phone);

        if (!guest) {
            resultEl.innerHTML = '<p class="text-red-error p-4 text-xs font-bold">Guest not found! ❌</p>';
            scanToast('Guest not found ❌', 'error');
            return;
        }

        // Check role to see if we should open allocation
        const myPhone = localStorage.getItem('user_phone');
        const myRole = await dbService.getUserRole(myPhone);

        scanToast('Guest Found! ✅', 'success');

        if (myRole === 'admin') {
            // Using window bridge because AdminModule is not imported here
            window.openAllocationUI(guest.phone);
            resultEl.innerHTML = `<p class="text-green-success p-2 text-[10px] font-bold">Opening Allocation for ${guest.name}... ✨</p>`;
        } else {
            // Auto-activate on scan if not yet active
            if (guest.status === 'pending') {
                await dbService.updateGuestStatus(guest.phone, 'active');
                scanToast('Guest Activated! 🚀', 'success');
            }

            resultEl.innerHTML = `
                <div class="premium-card stagger-in mt-4 border-gold bg-gold-pale">
                    <p class="font-bold text-brown-deep">${guest.name}</p>
                    <p class="text-[10px] uppercase font-bold text-gold">Table: ${guest.table_number || 'NOT ASSIGNED'}</p>
                    <div class="mt-2 p-2 bg-white rounded-lg border border-gold-light">
                        <p class="text-[10px] font-bold text-brown-warm">SITTING WITH: ${guest.members} GUESTS</p>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        console.error("Check-in error:", e);
        resultEl.innerHTML = '<p class="text-red-error p-4 text-xs font-bold">Connection Error 🙏</p>';
    }
}
