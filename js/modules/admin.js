import * as dbService from '../supabase-service.js';

let allStaff = [];
let currentGuests = [];
let adminListeners = [];
let allAvailableDishes = [];
export function initAdminDashboard(showScreen, showToast) {
    showScreen('screen-admin');

    // Cleanup existing listeners to prevent duplicates
    adminListeners.forEach(unsub => { if(typeof unsub === 'function') unsub(); });
    adminListeners = [];

    // Check Connection
    dbService.checkConnection().then(async connected => {
        updateConnectionStatus(connected);
        if (connected) {
            const myPhone = localStorage.getItem('user_phone');
            if (myPhone) {
                // Ensure Admin has a Guest profile so they can post/comment (DB FK constraint)
                const guest = await dbService.getGuest(myPhone);
                if (!guest) {
                    await dbService.saveGuest(myPhone, {
                        name: "Admin Host",
                        completed: true,
                        status: 'active',
                        members: 1
                    });
                    console.log("🛠️ Admin guest profile created for social access");
                }
            }
        }
    });

    // Overview, Guests & Analytics (Consolidated Listener)
    adminListeners.push(dbService.listenToGuests((guests) => {
        currentGuests = guests;
        renderAdminGuestList(guests);
        renderOverviewStats(guests);
        
        // Preserve current filter state during real-time updates
        const day = document.getElementById('forecast-day')?.value || 1;
        const sess = document.getElementById('forecast-sess')?.value || 'breakfast';
        renderDishAnalytics(guests, parseInt(day), sess);

        renderOutfitContest(guests);
        renderAdminMasterQueue(guests);
        renderTableDashboard(guests);
        renderAdminValetList(); // Refresh valet view on any guest change
    }));

    // Local state for admin's likes
    let adminLikes = [];
    const myPhone = localStorage.getItem('user_phone');
    if (myPhone) {
        dbService.fetchUserLikes(myPhone).then(likes => adminLikes = likes);
    }


    // Feedback
    adminListeners.push(dbService.listenToFeedback((feedback) => {
        renderFeedbackList(feedback);
    }));

    // Sync Staff
    adminListeners.push(dbService.listenToStaff((staff) => {
        allStaff = staff;
        renderStaffList(staff);
        updateAllocWaiterDropdown();
    }));

    // Sync Dishes
    adminListeners.push(dbService.listenToDishes((dishes) => {
        allAvailableDishes = dishes;
        renderDishManagement(dishes);
    }));

    // Specific Valet Listener for Admin
    dbService.supabase.channel('admin-valet-monitor').on('postgres_changes', { event: '*', schema: 'public', table: 'valet_requests' }, () => {
        renderAdminValetList();
    }).subscribe();

    // Activity Logger (Generic)
    dbService.supabase.channel('admin-activity-monitor').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'menu_selections' }, p => {
        logActivity(`Guest updated their menu preferences! 🥘`);
    }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'guests' }, p => {
        if(p.old.status !== p.new.status) logActivity(`Guest ${p.new.name} is now ${p.new.status.toUpperCase()} ✅`);
        if(p.old.assigned_waiter !== p.new.assigned_waiter) logActivity(`Guest ${p.new.name} assigned to Waiter ${p.new.assigned_waiter} 👔`);
    }).subscribe();

    // Sync Gallery
    adminListeners.push(dbService.listenToGallery(async (posts) => {
        if (myPhone) adminLikes = await dbService.fetchUserLikes(myPhone);
        renderAdminGallery(posts, adminLikes);
    }));

    // Outfit Contest State
    adminListeners.push(dbService.listenToOutfitContestState((isActive) => {
        const btn = document.getElementById('admin-toggle-outfit');
        if (btn) {
            btn.dataset.active = isActive ? 'true' : 'false';
            btn.innerHTML = isActive ? 'Lock Contest 🔒' : 'Unlock Contest 🔓';
            btn.className = isActive ? 'btn-gold w-auto text-[10px] py-1.5 px-3' : 'btn-outline w-auto text-[10px] py-1.5 px-3';
        }
    }));

    window.addEventListener('resize', () => {
        if (document.getElementById('admin-section-guests')?.classList.contains('active')) {
            renderAdminGuestList(currentGuests);
        }
    });

    // Initial analytics sync
    setTimeout(() => { if(window.updateForecast) window.updateForecast(); }, 1000);
}

function renderAdminMasterQueue(guests) {
    const container = document.getElementById('admin-master-queue');
    if(!container) return;
    
    const activeGuests = guests.filter(g => g.status === 'active' || g.status === 'hold');
    if(activeGuests.length === 0) {
        container.innerHTML = '<p class="no-data">No active guests being served. 🍽️</p>';
        return;
    }

    container.innerHTML = activeGuests.map(g => {
        // Find if they have any special requests in current or any session
        const hasSpecialRequest = Object.values(g.menu_selections || {}).some(s => s.fav);
        
        return `
            <div class="bg-ivory/50 rounded-xl p-3 border border-cream mb-2 flex justify-between items-center cursor-pointer hover:bg-ivory/80 transition-colors" onclick="showGuestDetails('${g.phone}')">
                <div>
                    <div class="flex items-center gap-2">
                        <p class="text-[11px] font-bold text-brown-deep">${g.name}</p>
                        ${hasSpecialRequest ? '<span class="text-[8px] bg-red-100 text-red-600 px-1 rounded font-bold">⚠️ REQUEST</span>' : ''}
                    </div>
                    <p class="text-[9px] text-gold font-extrabold uppercase mt-0.5">
                        TBL ${g.table_number || '?'} • ${g.members} MBRS • ${g.assigned_waiter ? 'Assigned' : 'UNASSIGNED'}
                    </p>
                </div>
                <div class="text-right">
                    <span class="status-badge ${getStatusClass(g.status)} text-[8px] uppercase px-2 mb-1 block">${g.status}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function renderAdminValetList() {
    const container = document.getElementById('admin-valet-list');
    if(!container) return;

    // Join with guests table to get the name
    const { data: requests } = await dbService.supabase
        .from('valet_requests')
        .select('*, guests(name)')
        .order('created_at', { ascending: false });
    
    if(!requests || requests.length === 0) {
        container.innerHTML = '<p class="no-data">No valet requests found. 🚗</p>';
        return;
    }

    container.innerHTML = requests.map(r => `
        <div class="premium-card p-3 border-l-4 ${r.status === 'pickup_requested' ? 'border-red-500 animate-pulse' : 'border-gold'}">
            <div class="flex justify-between items-start">
                <div>
                    <p class="text-[10px] font-bold text-brown-deep">${r.guests?.name || 'Unknown'} — ${r.car_model} (${r.car_number})</p>
                    <p class="text-[8px] text-gold font-extrabold uppercase">${r.car_colour} | ${r.guest_phone}</p>
                </div>
                <span class="status-badge ${getValetStatusClass(r.status)} text-[8px] px-2 uppercase">${r.status.replace('_', ' ')}</span>
            </div>
        </div>
    `).join('');
}

function getValetStatusClass(status) {
    if(status === 'pickup_requested') return 'bg-red-100 text-red-800';
    if(status === 'parked') return 'bg-green-100 text-green-800';
    return 'bg-gray-100 text-gray-800';
}

function renderOverviewStats(guests) {
    const totalFamilies = guests.length;
    const totalServed = guests.filter(g => g.status === 'served').length;
    const totalMembers = guests.reduce((sum, g) => sum + (parseInt(g.members) || 0), 0);

    document.getElementById('stat-total').textContent = totalFamilies;
    document.getElementById('stat-served').textContent = totalServed;
    document.getElementById('stat-members').textContent = totalMembers;
}

function renderDishAnalytics(guests, dayNum = 1, sessKey = 'breakfast') {
    const container = document.getElementById('dish-analytics');
    if (!container) return;

    const dishCounts = {};
    const lowerSessKey = sessKey.toLowerCase();
    guests.forEach(g => {
        const selections = g.menu_selections || {};
        const sessData = selections[`day${dayNum}_${lowerSessKey}`];
        if(sessData && sessData.dishes) {
            sessData.dishes.forEach(d => {
                dishCounts[d] = (dishCounts[d] || 0) + (parseInt(g.members) || 1);
            });
        }
    });

    const entries = Object.entries(dishCounts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No selections for Day ' + dayNum + ' ' + sessKey.toUpperCase() + ' yet 🍽️</p>';
        return;
    }

    container.innerHTML = entries.map(([name, count]) => `
        <div class="flex justify-between items-center p-2 border-b border-cream">
            <span class="text-sm font-bold text-text-mid">${name}</span>
            <span class="text-xs px-2 py-1 bg-gold-pale rounded-lg font-bold text-gold">${count} portions</span>
        </div>
    `).join('');
}

function renderOutfitContest(guests) {
    const container = document.getElementById('admin-outfit-contest');
    const outfits = guests.filter(g => g.outfit_url).sort((a, b) => (b.votes || 0) - (a.votes || 0));

    if (!outfits.length) {
        container.innerHTML = '<p class="no-data">No outfits uploaded yet ✨</p>';
        return;
    }

    container.innerHTML = outfits.map((g, i) => `
        <div class="premium-card p-2 flex gap-3 items-center">
            <img src="${g.outfit_url}" class="w-12 h-12 rounded-lg object-cover border border-gold/30" onclick="openLightbox(this.src)" style="cursor:pointer;" alt="Outfit">
            <div class="flex-1">
                <span class="text-xs font-bold block">${g.name}</span>
                <span class="text-[10px] text-gold">#${i + 1} Leader</span>
            </div>
            <div class="text-center bg-gold-pale px-3 py-1 rounded-xl">
                <span class="block text-xs font-bold text-gold">${g.votes || 0}</span>
                <span class="text-[8px] uppercase font-bold opacity-60">Votes</span>
            </div>
        </div>
    `).join('');
}

function renderFeedbackList(feedback) {
    const container = document.getElementById('admin-feedback-list');
    if (!container || !feedback.length) {
        container.innerHTML = '<p class="no-data">Waiting for warm wishes... 🌸</p>';
        return;
    }

    container.innerHTML = feedback.map(f => {
        const sender = currentGuests.find(g => g.phone === f.phone);
        const name = sender ? sender.name : f.phone;
        
        return `
            <div class="bg-ivory p-4 rounded-2xl mb-3 border border-cream">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-[10px] font-bold text-gold">${'★'.repeat(f.rating)}</span>
                    <span class="text-[8px] opacity-40">${new Date(f.created_at).toLocaleTimeString()}</span>
                </div>
                <p class="text-xs italic text-text-mid mb-2">"${f.message}"</p>
                <div class="text-right">
                    <span class="text-[9px] font-bold text-gold uppercase tracking-widest">— ${name}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ... existing helper functions (getStatusClass, renderAdminGuestList, etc.) ...

export function switchAdminTab(btn, sectionId) {
    // Buttons
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Sections
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
}

export async function toggleOutfitContest() {
    const btn = document.getElementById('admin-toggle-outfit');
    if (!btn) return;
    const isActive = btn.dataset.active === 'true';
    if(window.showToast) window.showToast('Updating Contest state... ✨');
    try {
        await dbService.setOutfitContestState(!isActive);
    } catch(e) {
        console.error(e);
        if(window.showToast) window.showToast('Failed to update state', 'error');
    }
}

let searchQuery = "";

export function handleGuestSearch() {
    searchQuery = document.getElementById('admin-guest-search').value.toLowerCase().trim();
    renderAdminGuestList(currentGuests);
}

function renderAdminGuestList(guests) {
    const list = document.getElementById('admin-guest-list');
    if (!list) return;

    const filtered = guests.filter(g => 
        g.name.toLowerCase().includes(searchQuery) || 
        g.phone.includes(searchQuery)
    );

    if (filtered.length === 0) {
        list.innerHTML = `<p class="text-center p-8 italic text-sm text-text-mid">${searchQuery ? 'No guests match your search.' : 'No guests registered yet.'} 🌸</p>`;
        return;
    }

    // Identify if we are on desktop for table view
    const isDesktop = window.innerWidth >= 1024; // Upping to 1024 for more reliable table view space

    list.innerHTML = filtered.map(g => {
        const sessionCount = g.menu_selections ? Object.keys(g.menu_selections).length : 0;
        
        if (isDesktop) {
            // TABLE VIEW
            return `
                <div class="guest-row" onclick="showGuestDetails('${g.phone}')">
                    <div class="flex items-center gap-2">
                        ${g.photo_url ? `<img src="${g.photo_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid var(--gold-pale);">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--gold-pale);display:flex;align-items:center;justify-center;text-align:center;font-size:10px;">🌸</div>`}
                        <span class="font-bold text-brown-deep">${g.name}</span>
                    </div>
                    <span class="opacity-60 text-xs">${g.phone}</span>
                    <span class="text-xs font-bold text-gold">${sessionCount} Sessions Set</span>
                    <div><span class="status-badge ${getStatusClass(g.status)} text-[9px] px-2 py-0.5 rounded-full">${g.status}</span></div>
                    <button class="text-[10px] font-bold text-gold uppercase underline" onclick="event.stopPropagation(); openAllocationUI('${g.phone}')">Assign</button>
                </div>
            `;
        } else {
            // CARD VIEW (Mobile)
            return `
                <div class="premium-card stagger-in mb-3 border-l-4 ${g.status === 'served' ? 'border-green-500' : 'border-gold'}" onclick="showGuestDetails('${g.phone}')">
                    <div class="flex gap-3 items-center">
                        ${g.photo_url ? `<img src="${g.photo_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--gold-pale);">` : `<div style="width:40px;height:40px;border-radius:50%;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-size:12px;">🌸</div>`}
                        <div class="flex-1">
                            <div class="flex justify-between items-start">
                                <h4 class="font-bold text-sm text-brown-deep">${g.name}</h4>
                                <span class="status-badge ${getStatusClass(g.status)} text-[8px] uppercase font-extrabold px-1.5 py-0.5">${g.status}</span>
                            </div>
                            <p class="text-[9px] text-gold font-extrabold">TBL ${g.table_number || 'NONE'} | ${sessionCount} Sessions</p>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');
}

export function showGuestDetails(phone) {
    const guest = currentGuests.find(g => g.phone === phone);
    if (!guest) return;

    const modal = document.getElementById('modal-guest-details');
    const content = document.getElementById('details-content');
    
    // Build multi-session summary
    const sessions = guest.menu_selections || {};
    const sessionHTML = Object.entries(sessions).map(([key, data]) => {
        const dishNames = (data.dishes || []).map(id => {
            const d = allAvailableDishes.find(item => item.id === id);
            return d ? d.name : id;
        });

        return `
        <div style="margin-bottom:12px; padding:12px; background:white; border-radius:16px; border:1px solid var(--cream);">
            <p style="font-size:10px; font-weight:900; color:var(--gold); text-transform:uppercase; margin-bottom:8px; letter-spacing:1px;">${key.replace(/_/g, ' ')}</p>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
                ${dishNames.map(name => `
                    <span style="display:inline-block; padding:4px 10px; background:var(--ivory); border-radius:8px; font-size:11px; color:var(--brown-deep); border:1px solid var(--cream); font-weight:600;">✦ ${name}</span>
                `).join('')}
            </div>
            ${data.fav ? `
                <div style="margin-top:8px; padding:10px; background:#FEF9E7; border-left:4px solid #F1C40F; border-radius:8px;">
                    <p style="font-size:11px; color:#9A7D0A; font-weight:700; margin:0; text-transform:uppercase; letter-spacing:0.5px;">⚠️ Special Request</p>
                    <p style="font-size:12px; color:#7D6608; margin:2px 0 0; font-style:italic;">"${data.fav}"</p>
                </div>
            ` : ''}
        </div>
    `;
    }).join('') || '<p style="text-align:center; opacity:0.5; font-style:italic; font-size:12px; padding:20px;">No menu selections yet</p>';

    content.innerHTML = `
        <div style="padding:24px;">
            <div style="display:flex; gap:16px; align-items:center; margin-bottom:24px;">
                ${guest.photo_url ? `<img src="${guest.photo_url}" style="width:120px;height:120px;border-radius:20px;object-fit:cover;border:2px solid var(--gold);box-shadow:var(--shadow-lg);">` : `<div style="width:120px;height:120px;border-radius:20px;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-size:40px;box-shadow:inset 0 2px 10px rgba(0,0,0,0.05);">🌸</div>`}
                <div style="flex:1;">
                    <h3 style="font-size:24px; font-weight:700; color:var(--brown-deep); margin:0;">${guest.name}</h3>
                    <p style="font-size:12px; color:var(--gold); font-weight:700; uppercase; letter-spacing:1px; margin:4px 0;">${guest.phone}</p>
                    <span style="display:inline-block; padding:4px 12px; border-radius:20px; font-size:10px; font-weight:700; ${guest.status === 'served' ? 'background:#E8F5E9; color:#2E7D32;' : 'background:var(--gold-pale); color:var(--brown-deep);'}">${guest.status.toUpperCase()}</span>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:24px;">
                <div style="background:var(--ivory); padding:12px; rounded:16px; text-align:center; border:1px solid var(--cream);">
                    <p style="font-size:9px; font-weight:800; color:var(--text-mid); text-transform:uppercase; margin-bottom:4px;">Members</p>
                    <p style="font-size:18px; font-weight:800; color:var(--brown-deep);">${guest.members}</p>
                </div>
                <div style="background:var(--ivory); padding:12px; rounded:16px; text-align:center; border:1px solid var(--cream);">
                    <p style="font-size:9px; font-weight:800; color:var(--text-mid); text-transform:uppercase; margin-bottom:4px;">Table</p>
                    <p style="font-size:18px; font-weight:800; color:var(--brown-deep);">${guest.table_number || '—'}</p>
                </div>
            </div>

            <p style="font-size:12px; font-weight:800; color:var(--brown-deep); text-transform:uppercase; margin-bottom:12px; border-bottom:1px solid var(--cream); padding-bottom:8px;">Menu Selections</p>
            <div style="max-height:300px; overflow-y:auto; padding-right:8px;" class="custom-sb">
                ${sessionHTML}
            </div>
            
            <div style="margin-top:24px; display:flex; gap:12px;">
                <button class="btn-gold" style="flex:1; margin:0;" onclick="openAllocationUI('${guest.phone}')">Manage Table / Team</button>
            </div>
            <div style="margin-top:12px; text-align:center;">
                <button style="background:none; border:none; color:var(--text-mid); font-size:12px; cursor:pointer;" onclick="closeGuestDetails()">Close</button>
            </div>
        </div>
    `;

    document.getElementById('modal-guest-details').classList.add('open');
}

export function closeGuestDetails() {
    document.getElementById('modal-guest-details').classList.remove('open');
}

function getStatusClass(status) {
    switch (status) {
        case 'active': return 'bg-gold-light text-brown-deep';
        case 'hold': return 'bg-yellow-100 text-yellow-800';
        case 'served': return 'bg-green-100 text-green-800';
        default: return 'bg-gray-100';
    }
}

function getCurrentSessionKey() {
    const now = new Date();
    const hour = now.getHours();
    let sess = 'Breakfast';
    if(hour >= 11 && hour < 12) sess = 'Before-Lunch';
    else if(hour >= 12 && hour < 16) sess = 'Lunch';
    else if(hour >= 16 && hour < 19) sess = 'Evening-Snack';
    else if(hour >= 19) sess = 'Dinner';
    return `day1_${sess.toLowerCase()}`;
}

function renderStaffList(staff) {
    const list = document.getElementById('admin-waiter-list');
    if (!list) return;

    if (staff.length === 0) {
        list.innerHTML = '<p class="text-center p-4 italic text-xs">No team members yet.</p>';
        return;
    }

    list.innerHTML = staff.map(s => `
        <div class="flex justify-between items-center p-4 bg-ivory rounded-xl mb-2 border border-cream shadow-sm">
            <div>
                <span class="font-bold text-text-mid block">${s.phone}</span>
                <span class="text-[10px] uppercase font-bold text-gold">${s.role}</span>
            </div>
            <button class="text-red-error text-xs font-bold uppercase tracking-widest" onclick="removeStaff('${s.phone}')">Remove</button>
        </div>
    `).join('');
}

function renderDishManagement(dishes) {
    const list = document.getElementById('admin-dish-list');
    if (!list) return;

    if (dishes.length === 0) {
        list.innerHTML = '<p class="text-center p-4 italic text-xs">No dishes added yet.</p>';
        return;
    }

    list.innerHTML = dishes.map(d => `
        <div class="flex justify-between items-center p-3 border-b border-cream">
            <div class="flex gap-3 items-center">
                <span class="text-xl">${d.emoji || '🥗'}</span>
                <div>
                    <span class="font-bold block text-sm">${d.name}</span>
                    <span class="text-[10px] uppercase font-bold text-gold opacity-70">${d.category}</span>
                </div>
            </div>
            <button class="text-red-error text-[10px] font-bold" onclick="removeDish('${d.id}')">✕</button>
        </div>
    `).join('');
}

// --- ADMIN QR SCANNER ---
let adminVideo = null;
let adminStream = null;
let adminScannerActive = false;

export async function startAdminScanner() {
    const modal = document.getElementById('modal-admin-qr');
    adminVideo = document.getElementById('admin-video');
    const canvas = document.getElementById('admin-scan-canvas');
    if (!modal || !adminVideo || !canvas) return;

    modal.classList.add('open');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        adminStream = stream;
        adminVideo.srcObject = stream;
        adminVideo.setAttribute('playsinline', true);
        await adminVideo.play();
        adminScannerActive = true;
        
        requestAnimationFrame(() => tickAdminScanner(canvas));
    } catch (err) {
        console.error("Admin Scanner Error:", err);
        alert("Camera access denied or not available 📸");
        stopAdminScanner();
    }
}

function tickAdminScanner(canvas) {
    if (!adminScannerActive || !adminVideo) return;

    if (adminVideo.readyState === adminVideo.HAVE_ENOUGH_DATA) {
        canvas.height = adminVideo.videoHeight;
        canvas.width = adminVideo.videoWidth;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(adminVideo, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        const code = window.jsQR ? window.jsQR(imageData.data, imageData.width, imageData.height) : null;

        if (code) {
            console.log("Admin Scanned QR:", code.data);
            adminScannerActive = false;
            handleAdminScanResult(code.data);
            return;
        }
    }
    requestAnimationFrame(() => tickAdminScanner(canvas));
}

function handleAdminScanResult(phone) {
    stopAdminScanner();
    // Validate if it's a known guest
    const guest = currentGuests.find(g => g.phone === phone);
    if (guest) {
        showGuestDetails(phone);
    } else {
        alert("Guest not found: " + phone);
    }
}

export function stopAdminScanner() {
    adminScannerActive = false;
    if (adminStream) {
        adminStream.getTracks().forEach(track => track.stop());
        adminStream = null;
    }
    if (adminVideo) adminVideo.srcObject = null;
    const qrModal = document.getElementById('modal-admin-qr');
    if (qrModal) qrModal.classList.remove('open');
}

function logActivity(msg) {
    const container = document.getElementById('admin-activity-log');
    if(!container) return;
    const noData = container.querySelector('.no-data');
    if(noData) noData.remove();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<span class="activity-time">${time}</span><span class="activity-msg">${msg}</span>`;
    container.prepend(item);
}

function renderTableDashboard(guests) {
    const grid = document.getElementById('admin-table-grid');
    if(!grid) return;
    const TOTAL_TABLES = 25;
    let html = '';
    for(let i = 1; i <= TOTAL_TABLES; i++) {
        const tableGuests = guests.filter(g => parseInt(g.table_number) === i);
        const isOccupied = tableGuests.length > 0;
        const allServed = isOccupied && tableGuests.every(g => g.status === 'served');
        html += `
            <div class="table-card ${isOccupied ? 'occupied' : ''} ${allServed ? 'served' : ''}" 
                 onclick="${isOccupied ? `showGuestDetails('${tableGuests[0].phone}')` : ''}">
                <div class="table-num">T${i}</div>
                ${isOccupied ? `
                    <div class="table-guest">${tableGuests.map(g => g.name).join(', ')}</div>
                    <div class="table-waiter">${tableGuests[0].assigned_waiter ? '👤 ' + tableGuests[0].assigned_waiter.slice(-4) : 'NEEDS TEAM'}</div>
                ` : `<div class="text-[8px] opacity-30 mt-2 uppercase tracking-widest">Available</div>`}
            </div>
        `;
    }
    grid.innerHTML = html;
}

window.updateForecast = () => {
    const day = parseInt(document.getElementById('forecast-day').value);
    const sess = document.getElementById('forecast-sess').value;
    renderDishAnalytics(currentGuests, day, sess);
};

// Global scope exposures for HTML
export async function addNewStaff() {
    const phone = document.getElementById('new-waiter-phone').value.trim();
    const name = document.getElementById('new-staff-name').value.trim();
    const role = document.getElementById('new-staff-role').value;
    if (!phone) return;

    try {
        await dbService.addStaffRole(phone, role, name);
        document.getElementById('new-waiter-phone').value = '';
        document.getElementById('new-staff-name').value = '';
        if(window.showToast) window.showToast(`Staff member added! 💼`);
        logActivity(`New staff member added: ${name ? name + ' ' : ''}(${phone} - ${role})`);
    } catch (e) {
        if(window.showToast) window.showToast(`Failed to add staff 🙏`, true);
    }
}

export async function removeStaff(phone) {
    if (confirm(`Remove ${phone}?`)) {
        try {
            await dbService.removeStaff(phone);
            if(window.showToast) window.showToast(`Staff member removed.`);
            logActivity(`Staff member removed: ${phone}`);
        } catch (e) {
            if(window.showToast) window.showToast(`Failed to remove staff 🙏`, true);
        }
    }
}

export async function addNewDish() {
    const name = document.getElementById('new-dish-name').value.trim();
    const emoji = document.getElementById('new-dish-emoji').value.trim();
    const category = document.getElementById('new-dish-category').value.trim();
    const day = parseInt(document.getElementById('new-dish-day').value);
    const session = document.getElementById('new-dish-sess').value;

    if (!name || !category) {
        if(window.showToast) window.showToast(`Dish name and category required!`, true);
        return;
    }

    try {
        await dbService.addDish({ name, emoji: emoji || '🥗', category, day, session });
        document.getElementById('new-dish-name').value = '';
        document.getElementById('new-dish-emoji').value = '🥗';
        if(window.showToast) window.showToast(`${name} added to menu! ✨`);
        logActivity(`New dish added: ${name}`);
    } catch (e) {
        if(window.showToast) window.showToast(`Failed to add dish 🙏`, true);
    }
}

export async function removeDish(id) {
    if (confirm('Delete this dish?')) {
        try {
            await dbService.removeDish(id);
            if(window.showToast) window.showToast(`Dish removed from menu.`);
        } catch (e) {
            if(window.showToast) window.showToast(`Failed to delete dish 🙏`, true);
        }
    }
}

// Allocation Logic
let selectedGuest = null;

export function openAllocationUI(guestId) {
    const guest = currentGuests.find(g => g.phone === guestId);
    if (!guest) return;

    selectedGuest = guest;
    document.getElementById('alloc-guest-name').textContent = guest.name;
    document.getElementById('modal-allocation').classList.add('open');
    updateAllocWaiterDropdown();
}

function updateAllocWaiterDropdown() {
    const select = document.getElementById('alloc-waiter');
    if (!select) return;
    const waiters = allStaff.filter(s => s.role === 'waiter');
    select.innerHTML = waiters.map(w => `<option value="${w.phone}">${w.phone}</option>`).join('');
}

export function closeAllocationModal() {
    document.getElementById('modal-allocation').classList.remove('open');
}

export async function confirmAllocation() {
    const waiterPhone = document.getElementById('alloc-waiter').value;
    const tableNum = document.getElementById('alloc-table').value;

    if (!waiterPhone || !tableNum) {
        alert('Please select a waiter and table number');
        return;
    }

    try {
        await dbService.allocateGuest(selectedGuest.phone, waiterPhone, tableNum);
        closeAllocationModal();
        alert('Guest allocated successfully! ✨');
    } catch (e) {
        alert('Allocation failed 🙏');
    }
}

function updateConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    if (connected) {
        el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span> Connected`;
        el.classList.remove('opacity-70', 'text-red-error');
        el.classList.add('text-green-500');
    } else {
        el.innerHTML = `
            <span class="w-1.5 h-1.5 rounded-full bg-red-error animate-pulse"></span> 
            Connection Failed 
            <button onclick="location.reload()" class="ml-2 text-[8px] underline">Retry</button>
        `;
        el.classList.add('opacity-70', 'text-red-error');
        el.classList.remove('text-green-500');
    }
}

// ════════════════════════════════════════════════
// 📸 ADMIN GALLERY & EVENT TOOLS
// ════════════════════════════════════════════════

export async function uploadAdminPhoto() {
    const fileInput = document.getElementById('admin-gallery-file');
    if (!fileInput || !fileInput.files[0]) {
        if (window.showToast) window.showToast('Please select a photo first 📸', 'error');
        return;
    }

    const file = fileInput.files[0];
    if (file.size > 8 * 1024 * 1024) {
        if (window.showToast) window.showToast('Photo too large (max 8MB)', 'error');
        return;
    }

    if (window.showToast) window.showToast('Uploading to Memory Wall... ✨');

    try {
        // Upload to the same event-gallery bucket using the admin's actual phone number
        const phone = localStorage.getItem('user_phone');
        await dbService.uploadGalleryPhoto(phone, file, '📸 Event moment from the host');
        if (window.showToast) window.showToast('Photo added to Memory Wall! 🌸');
        fileInput.value = '';
        const nameEl = document.getElementById('admin-file-name');
        if (nameEl) nameEl.textContent = 'No file chosen';
    } catch (e) {
        console.error('Admin gallery upload failed:', e);
        if (window.showToast) window.showToast('Upload failed — check bucket permissions 🙏', 'error');
    }
}

let currentAdminPosts = [];

function renderAdminGallery(posts, userLikes = []) {
    const container = document.getElementById('admin-gallery-view');
    if (!container) return;

    currentAdminPosts = posts || [];

    if (currentAdminPosts.length === 0) {
        container.innerHTML = '<p class="no-data col-span-2">No moments shared yet 📸</p>';
        return;
    }

    container.innerHTML = currentAdminPosts.map((p, i) => {
        const isLiked = userLikes.includes(p.id);
        return `
            <div class="relative rounded-xl overflow-hidden aspect-[4/5] border border-cream shadow-sm fade-up cursor-pointer" onclick="openAdminGalleryCard(${i})">
                <img src="${p.photo_url}" class="w-full h-full object-cover">
                <div class="absolute bottom-2 right-2 flex gap-1.5">
                    <div class="bg-black/60 text-white text-[9px] px-2 py-0.5 rounded-full backdrop-blur-sm font-bold flex items-center gap-1">
                        ${isLiked ? '❤️' : '🤍'} ${p.likes_count || 0}
                    </div>
                    <div class="bg-black/60 text-white text-[9px] px-2 py-0.5 rounded-full backdrop-blur-sm font-bold flex items-center gap-1"
                         onclick="event.stopPropagation(); openAdminGalleryCard(${i}, true)">
                        💬 ${p.comments_count || 0}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

export async function openAdminGalleryCard(idx, focusComment = false) {
    const p = currentAdminPosts[idx];
    if (!p) return;
    const dateStr = new Date(p.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const name = p.guests?.name || 'Admin Host';
    const avatar = p.guests?.photo_url || '';
    // Fetch Likes for admin view too
    const myPhone = dbService.normalizePhone(localStorage.getItem('user_phone') || '');
    const likes = await dbService.fetchPostLikes(p.id);
    const hasLiked = likes.some(l => dbService.normalizePhone(l.user_phone) === myPhone);
    
    let likersHTML = '';
    if (likes.length > 0) {
        const firstLiker = likes[0].guests?.name || 'A Guest';
        if (likes.length === 1) likersHTML = `Liked by <span class="font-bold">${firstLiker}</span>`;
        else likersHTML = `Liked by <span class="font-bold">${firstLiker}</span> and <span class="font-bold">${likes.length - 1} others</span>`;
    }

    const html = `
        <div class="social-head">
            ${avatar ? `<img src="${avatar}" class="social-avatar" onclick="openLightbox(this.src)" style="cursor:pointer;" alt="Profile">` : `<div class="social-avatar-ph">🌸</div>`}
            <div style="flex:1;">
                <p class="social-name text-[14px] font-bold text-brown-deep">${name}</p>
                <p class="social-meta text-[10px] opacity-60">${dateStr} ✦ Memory Wall</p>
            </div>
        </div>
        
        <div class="social-body relative overflow-hidden" ondblclick="handleDoubleTapLike('${p.id}')">
            <img src="${p.photo_url}" class="social-img w-full block" onclick="openLightbox(this.src)" style="cursor:pointer;" alt="Post">
        </div>

        <div class="px-4 py-3 bg-white">
            <div class="flex justify-between items-center mb-3">
                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-1.5 action-trigger" onclick="toggleLike('${p.id}', 'gallery', this.querySelector('.like-btn'))">
                        <button class="like-btn p-0 text-2xl ${hasLiked ? 'liked' : ''} transition-transform active:scale-125">
                            ${hasLiked ? '❤️' : '🤍'}
                        </button>
                        <span class="text-[14px] font-bold text-brown-warm">${p.likes_count || 0}</span>
                    </div>
                    <div class="flex items-center gap-1.5 action-trigger" onclick="document.getElementById('comment-input-${p.id}').focus()">
                        <button class="p-0 text-2xl opacity-80">💬</button>
                        <span class="text-[14px] font-bold text-brown-warm">${p.comments_count || 0}</span>
                    </div>
                </div>
                <button class="text-[11px] text-red-error font-bold underline px-2 py-1" onclick="confirm('Remove this photo?') && dbService.removeGalleryPost('${p.id}')">Remove Post</button>
            </div>

            <p class="text-[12px] font-bold mb-1.5">${likersHTML}</p>

            ${p.message ? `
            <div class="text-[13px] leading-relaxed mb-1">
                <span class="font-bold mr-1.5 text-brown-deep">${name}</span>
                <span class="text-text-mid opacity-95">${p.message}</span>
            </div>` : ''}
            
            <p class="text-[9px] uppercase tracking-widest opacity-30 mt-3 font-extrabold pb-1">Shared with Love</p>
        </div>

        <div class="border-t border-cream/20">
            <div id="card-comments-${p.id}" class="social-comments hide-sb px-4 py-3 flex flex-col gap-3" style="max-height:260px; overflow-y:auto;">
                <p class="text-[10px] opacity-40 text-center py-2">Loading notes... 🌸</p>
            </div>
            
            <div class="comment-input-area px-4 pb-4 flex gap-2">
                <input type="text" id="comment-input-${p.id}" class="input-field m-0" placeholder="Add a note..." style="padding:10px 14px; font-size:12px; min-height:unset; border-radius:16px;">
                <button class="btn-gold m-0 w-auto px-4" onclick="window.submitGalleryComment('${p.id}')" style="font-size:11px;">Post</button>
            </div>
        </div>
    `;
    window.openCardModal(html);

    if (focusComment) {
        setTimeout(() => {
            const input = document.getElementById(`comment-input-${p.id}`);
            if (input) {
                input.focus();
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 300);
    }


    if (window.activeCommentListener) {
        window.activeCommentListener(); // Unsub previous
    }
    
    // Start listening
    window.activeCommentListener = dbService.listenToComments(p.id, (comments) => {
        const cdiv = document.getElementById(`card-comments-${p.id}`);
        if (!cdiv) return;
        
        if (!comments || comments.length === 0) {
            cdiv.innerHTML = '<p class="text-[10px] opacity-40 text-center py-2">No comments yet ✨</p>';
            return;
        }

        // Hierarchical rendering
        const roots = comments.filter(c => !c.parent_id);
        const children = comments.filter(c => c.parent_id);

        const renderComment = (c, level = 0) => {
            const commenterName = c.guests?.name || 'Someone';
            const safeName = commenterName.replace(/'/g, "\\'");
            const isChild = level > 0;
            
            let html = `
            <div class="flex gap-2 items-start ${isChild ? 'ml-8' : ''}">
                ${c.guests?.photo_url ? `<img src="${c.guests.photo_url}" class="${isChild ? 'w-5 h-5' : 'w-6 h-6'} rounded-full object-cover cursor-pointer" onclick="openLightbox(this.src)">` : `<div class="${isChild ? 'w-5 h-5' : 'w-6 h-6'} rounded-full bg-ivory flex items-center justify-center text-[7px]">🌸</div>`}
                <div class="flex-1 bg-ivory rounded-2xl rounded-tl-none p-2 border border-cream">
                    <p class="${isChild ? 'text-[8px]' : 'text-[9px]'} font-bold text-brown-warm">${commenterName}</p>
                    <p class="${isChild ? 'text-[10px]' : 'text-[11px]'} text-text-mid mt-0.5">${c.content}</p>
                    ${level < 2 ? `<button class="text-[9px] font-bold text-gold mt-1 opacity-70 hover:opacity-100" onclick="replyToComment('${safeName}', '${p.id}', '${c.id}')">Reply</button>` : ''}
                </div>
            </div>
            `;

            // Render children
            const replies = children.filter(child => child.parent_id === c.id);
            replies.forEach(r => {
                html += renderComment(r, level + 1);
            });

            return html;
        };

        cdiv.innerHTML = roots.map(root => renderComment(root)).join('');
        // scroll to bottom
        cdiv.scrollTop = cdiv.scrollHeight;
    });
}

// ════════════════════════════════════════════════
// 🚗 ADMIN VALET MANAGEMENT
// ════════════════════════════════════════════════

export async function adminAssignValet(requestId) {
    const myPhone = localStorage.getItem('user_phone');
    try {
        await dbService.supabase.from('valet_requests').update({
            status: 'parked',
            assigned_driver: myPhone,
            parked_at: new Date().toISOString()
        }).eq('id', requestId);
        if (window.showToast) window.showToast('Car assigned and parked! 🚗');
        logActivity('Valet: Car parked by admin');
    } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast('Assignment failed 🙏', 'error');
    }
}

export async function adminValetReturnCar(requestId) {
    try {
        await dbService.supabase.from('valet_requests').update({
            status: 'returned',
            returned_at: new Date().toISOString()
        }).eq('id', requestId);
        if (window.showToast) window.showToast('Car returned to guest! ✅');
        logActivity('Valet: Car returned to guest');
    } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast('Return failed 🙏', 'error');
    }
}

export async function adminUpdateStatus(phone, status) {
    try {
        await dbService.updateGuestStatus(phone, status);
        if (window.showToast) window.showToast(`Guest status updated to ${status} ✨`);
        logActivity(`Admin updated ${phone} to ${status}`);
    } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast('Status update failed 🙏', 'error');
    }
}

