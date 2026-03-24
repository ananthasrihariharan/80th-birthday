import * as dbService from '../supabase-service.js';

export function initValetDashboard(showScreen, showToast, currentUser) {
    showScreen('screen-valet');
    loadValetRequests(currentUser, showToast);

    // Live listener for valet requests
    dbService.supabase
        .channel('valet-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'valet_requests' }, () => {
            loadValetRequests(currentUser, showToast);
        })
        .subscribe();
}

async function loadValetRequests(currentUser, showToast) {
    const { data: pending } = await dbService.supabase
        .from('valet_requests')
        .select('*, guests(name, phone)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

    const { data: myCars } = await dbService.supabase
        .from('valet_requests')
        .select('*, guests(name, phone)')
        .eq('assigned_driver', currentUser.phoneNumber)
        .in('status', ['parked', 'pickup_requested'])
        .order('created_at', { ascending: false });

    renderValetQueue(pending || [], showToast);
    renderMyCars(myCars || [], currentUser, showToast);
}

function renderValetQueue(requests, showToast) {
    const container = document.getElementById('valet-queue');
    if (!container) return;
    if (!requests.length) {
        container.innerHTML = '<p class="no-data" style="color:rgba(255,255,255,0.3);">No pending requests 🚗</p>';
        return;
    }
    container.innerHTML = requests.map(r => `
        <div class="valet-car-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
                <span class="valet-plate">${r.car_number}</span>
                <span class="status-badge bg-yellow-100 text-yellow-800">${r.status}</span>
            </div>
            <p style="font-size:12px;font-weight:700;color:var(--brown-deep)">${r.car_model} — ${r.car_colour}</p>
            <p style="font-size:11px;color:var(--text-mid);">Guest: ${r.guests?.name || r.guest_phone} | Arrival: ${r.arrival_time || 'Not specified'}</p>
            ${r.notes ? `<p style="font-size:10px;color:var(--gold);margin-top:4px;font-style:italic;">${r.notes}</p>` : ''}
            <div class="valet-status-row">
                <button onclick="valetTakeCar('${r.id}')" 
                    style="flex:1;padding:8px;border-radius:10px;border:none;background:var(--gold);color:var(--brown-deep);font-size:11px;font-weight:700;cursor:pointer;">
                    🚗 Take Car & Park
                </button>
            </div>
        </div>
    `).join('');
}

function renderMyCars(cars, currentUser, showToast) {
    const container = document.getElementById('valet-my-cars');
    if (!container) return;
    if (!cars.length) {
        container.innerHTML = '<p class="no-data" style="color:rgba(255,255,255,0.3);">No cars assigned yet</p>';
        return;
    }
    container.innerHTML = cars.map(r => `
        <div class="valet-car-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
                <span class="valet-plate">${r.car_number}</span>
                <span class="status-badge ${r.status === 'pickup_requested' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">${r.status}</span>
            </div>
            <p style="font-size:12px;font-weight:700;color:var(--brown-deep)">${r.car_model} — ${r.car_colour}</p>
            <p style="font-size:11px;color:var(--text-mid);">Guest: ${r.guests?.name || r.guest_phone}</p>
            ${r.status === 'pickup_requested' ? `
            <div class="valet-status-row">
                <button onclick="valetReturnCar('${r.id}')"
                    style="flex:1;padding:8px;border-radius:10px;border:none;background:#27AE60;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">
                    ✅ Car Returned to Guest
                </button>
            </div>` : `
            <div class="valet-status-row">
                <button onclick="valetRequestedPickup('${r.id}')"
                    style="flex:1;padding:8px;border-radius:10px;border:none;background:#E67E22;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">
                    🔔 Mark Pickup Request
                </button>
            </div>`}
        </div>
    `).join('');
}

export async function valetSearchGuest() {
    const query = document.getElementById('valet-search-phone')?.value.trim();
    if (!query) return;
    const resultEl = document.getElementById('valet-search-result');

    const { data } = await dbService.supabase
        .from('valet_requests')
        .select('*, guests(name, phone)')
        .or(`guest_phone.ilike.%${query}%,car_number.ilike.%${query}%`);

    if (!data || !data.length) {
        resultEl.innerHTML = '<p style="color:var(--red-error);font-size:12px;padding:8px 0;">No matching request found</p>';
        return;
    }
    const r = data[0];
    resultEl.innerHTML = `
        <div class="valet-car-card" style="margin-top:12px;">
            <span class="valet-plate">${r.car_number}</span>
            <p style="font-size:12px;font-weight:700;color:var(--brown-deep);margin-top:6px;">${r.car_model} — ${r.car_colour}</p>
            <p style="font-size:11px;color:var(--text-mid);">Guest: ${r.guests?.name || r.guest_phone} | Status: <strong>${r.status}</strong></p>
        </div>`;
}

export async function valetTakeCar(requestId) {
    const myPhone = localStorage.getItem('user_phone');
    try {
        const { error } = await dbService.supabase.from('valet_requests').update({
            status: 'parked',
            assigned_driver: myPhone,
            parked_at: new Date().toISOString()
        }).eq('id', requestId);
        
        if (error) throw error;
        if (window.showToast) window.showToast('Car marked as Parked! 🚗', 'success');
    } catch (e) {
        console.error('Valet take car failed:', e);
        if (window.showToast) window.showToast('Failed to update status 🙏', 'error');
    }
}

export async function valetReturnCar(requestId) {
    try {
        const { error } = await dbService.supabase.from('valet_requests').update({
            status: 'returned',
            returned_at: new Date().toISOString()
        }).eq('id', requestId);
        
        if (error) throw error;
        if (window.showToast) window.showToast('Car returned to guest! ✅', 'success');
    } catch (e) {
        console.error('Valet return car failed:', e);
        if (window.showToast) window.showToast('Failed to update status 🙏', 'error');
    }
}

export async function valetRequestedPickup(requestId) {
    try {
        const { error } = await dbService.supabase.from('valet_requests').update({
            status: 'pickup_requested'
        }).eq('id', requestId);
        
        if (error) throw error;
        if (window.showToast) window.showToast('Pickup request notified! 🔔', 'success');
    } catch (e) {
        console.error('Valet pickup request failed:', e);
        if (window.showToast) window.showToast('Failed to notify pickup 🙏', 'error');
    }
}
