import * as dbService from '../supabase-service.js';

let allStaff = [];

export function initAdminDashboard(showScreen, showToast) {
    showScreen('screen-admin');

    // Check Connection
    dbService.checkConnection().then(connected => {
        updateConnectionStatus(connected);
    });

    // Overview, Guests & Analytics (Consolidated Listener)
    dbService.listenToGuests((guests) => {
        currentGuests = guests;
        renderAdminGuestList(guests);
        renderOverviewStats(guests);
        renderDishAnalytics(guests);
        renderOutfitContest(guests);
    });

    // Feedback
    dbService.listenToFeedback((feedback) => {
        renderFeedbackList(feedback);
    });

    // Sync Staff
    dbService.listenToStaff((staff) => {
        allStaff = staff;
        renderStaffList(staff);
        updateAllocWaiterDropdown();
    });

    // Sync Dishes
    dbService.listenToDishes((dishes) => {
        renderDishManagement(dishes);
    });
}

function renderOverviewStats(guests) {
    const totalFamilies = guests.length;
    const totalServed = guests.filter(g => g.status === 'served').length;
    const totalMembers = guests.reduce((sum, g) => sum + (parseInt(g.members) || 0), 0);

    document.getElementById('stat-total').textContent = totalFamilies;
    document.getElementById('stat-served').textContent = totalServed;
    document.getElementById('stat-members').textContent = totalMembers;
}

function renderDishAnalytics(guests) {
    const container = document.getElementById('dish-analytics');
    if (!container) return;

    const dishCounts = {};
    guests.forEach(g => {
        (g.dishes || []).forEach(d => {
            dishCounts[d] = (dishCounts[d] || 0) + (parseInt(g.members) || 1);
        });
    });

    const entries = Object.entries(dishCounts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<p class="no-data">No dish selections yet 🍽️</p>';
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
            <img src="${g.outfit_url}" class="w-12 h-12 rounded-lg object-cover border border-gold/30">
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

    container.innerHTML = feedback.map(f => `
        <div class="bg-ivory p-4 rounded-2xl mb-3 border border-cream">
            <div class="flex justify-between items-center mb-2">
                <span class="text-[10px] font-bold text-gold">${'★'.repeat(f.rating)}</span>
                <span class="text-[8px] opacity-40">${new Date(f.created_at).toLocaleTimeString()}</span>
            </div>
            <p class="text-xs italic text-text-mid">"${f.message}"</p>
        </div>
    `).join('');
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

function renderAdminGuestList(guests) {
    const list = document.getElementById('admin-guest-list');
    if (!list) return;

    if (guests.length === 0) {
        list.innerHTML = '<p class="text-center p-8 italic text-sm text-text-mid">No guests registered yet. 🌸</p>';
        return;
    }

    list.innerHTML = guests.map(g => `
        <div class="premium-card stagger-in mb-3">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h4 class="font-bold text-sm">${g.name || 'Guest'}</h4>
                    <p class="text-[10px] text-gold font-bold">TABLE ${g.table_number || 'UNASSIGNED'}</p>
                </div>
                <span class="status-badge ${getStatusClass(g.status)}">${g.status}</span>
            </div>
            <div class="text-[10px] text-text-mid flex justify-between items-center">
                <span>📞 ${g.phone} | 👥 ${g.members} members</span>
                ${!g.assigned_waiter ? `
                    <button class="text-gold font-bold uppercase tracking-widest text-[10px]" onclick="openAllocationUI('${g.phone}')">Assign ✦</button>
                ` : `<span class="italic">Assigned to ${g.assigned_waiter}</span>`}
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

// Global scope exposures for HTML
export async function addNewStaff() {
    const phone = document.getElementById('new-waiter-phone').value.trim();
    const role = document.getElementById('new-staff-role').value;
    if (!phone) return;

    await dbService.addStaffRole(phone, role);
    document.getElementById('new-waiter-phone').value = '';
}

export async function removeStaff(phone) {
    if (confirm(`Remove ${phone}?`)) {
        await dbService.removeStaff(phone);
    }
}

export async function addNewDish() {
    const name = document.getElementById('new-dish-name').value.trim();
    const emoji = document.getElementById('new-dish-emoji').value.trim();
    const category = document.getElementById('new-dish-category').value.trim();

    if (!name || !category) return;
    await dbService.addDish({ name, emoji: emoji || '🥗', category });

    document.getElementById('new-dish-name').value = '';
    document.getElementById('new-dish-emoji').value = '🥗';
}

export async function removeDish(id) {
    if (confirm('Delete this dish?')) {
        await dbService.removeDish(id);
    }
}

// Allocation Logic
let selectedGuest = null;
let currentGuests = [];

export function openAllocationUI(guestId) {
    const guest = currentGuests.find(g => g.phone === guestId);
    if (!guest) return;

    selectedGuest = guest;
    document.getElementById('alloc-guest-name').textContent = guest.name;
    document.getElementById('modal-allocation').style.display = 'flex';
    document.getElementById('modal-allocation').classList.remove('hidden');
    updateAllocWaiterDropdown();
}

function updateAllocWaiterDropdown() {
    const select = document.getElementById('alloc-waiter');
    if (!select) return;
    const waiters = allStaff.filter(s => s.role === 'waiter');
    select.innerHTML = waiters.map(w => `<option value="${w.phone}">${w.phone}</option>`).join('');
}

export function closeAllocationModal() {
    document.getElementById('modal-allocation').style.display = 'none';
    document.getElementById('modal-allocation').classList.add('hidden');
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
