import { CONFIG } from './config.js';
import * as dbService from './supabase-service.js';

// Import New Modules
import * as AdminModule from './modules/admin.js';
import * as WaiterModule from './modules/waiter.js';
import * as GuestModule from './modules/guest.js';
import * as OutfitModule from './modules/outfit.js';
import * as PoojaModule from './modules/pooja.js';

// ════════════════════════════════════════════════
// 🚀 APP INITIALIZATION
// ════════════════════════════════════════════════

let currentUser = null;
let currentRole = 'guest';

// Navigation
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('active');
        window.scrollTo(0, 0);
        // Trigger animations
        el.querySelectorAll('.stagger-in > *').forEach((child, i) => {
            setTimeout(() => child.classList.add('animate'), i * 100);
        });
    }
}

// ════════════════════════════════════════════════
// 🎭 AUTHENTICATION & ROLES
// ════════════════════════════════════════════════

async function handleLoginSuccess(user) {
    currentUser = user;
    const role = await dbService.getUserRole(user.phoneNumber);
    currentRole = role;

    if (role === 'admin') {
        AdminModule.initAdminDashboard(showScreen, showToast);
    } else if (role === 'waiter') {
        WaiterModule.initWaiterDashboard(showScreen, showToast, currentUser);
    } else {
        GuestModule.initGuestFlow(showScreen, showToast, currentUser);
    }
}

// Fast Login Handler
async function handleFastLogin() {
    const phone = document.getElementById('phone-input').value.trim();
    if (!phone) return showToast('Enter mobile number 🌸', 'error');

    setLoading(true);
    try {
        const user = await dbService.fastLogin(phone);
        await handleLoginSuccess(user);
    } catch (e) {
        showToast('Login failed 🙏', 'error');
    }
    setLoading(false);
}

// Global scope exposures for HTML onclicks
window.showScreen = showScreen;
window.logout = () => dbService.auth.signOut().then(() => showScreen('screen-login'));

// Exposed Helpers for modules
export function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    t.style.background = type === 'success' ? '#C9943A' : '#C0392B';
    t.style.color = '#fff';
    setTimeout(() => { if (t) t.style.display = 'none'; }, 3000);
}

export function setLoading(show) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = show ? 'flex' : 'none';
}

// Specific Button Handlers (Bridge to modules)
window.handleOutfitUpload = () => OutfitModule.initOutfitUpload(showScreen, showToast, currentUser);
window.uploadOutfitPhoto = () => OutfitModule.uploadOutfitPhoto(currentUser.phoneNumber, showToast, setLoading);
window.submitGuestForm = () => GuestModule.submitGuestForm(currentUser.phoneNumber, () => handleLoginSuccess(currentUser), showToast, setLoading);
window.handlePoojaGallery = () => PoojaModule.initPoojaGallery(showScreen);
window.openAllocationUI = (guestId) => AdminModule.openAllocationUI(guestId);

window.submitFeedback = () => {
    const stars = document.querySelectorAll('.star.active').length;
    const msg = document.getElementById('feedback-msg').value.trim();
    GuestModule.submitFeedback(currentUser.phoneNumber, stars, msg);
};

window.voteForOutfit = (outfitPhone) => GuestModule.voteForOutfit(currentUser.phoneNumber, outfitPhone);

// Admin Bridge
window.switchAdminTab = (btn, sectionId) => AdminModule.switchAdminTab(btn, sectionId);
window.addNewStaff = () => AdminModule.addNewStaff();
window.removeStaff = (phone) => AdminModule.removeStaff(phone);
window.addNewDish = () => AdminModule.addNewDish();
window.removeDish = (id) => AdminModule.removeDish(id);
window.confirmAllocation = () => AdminModule.confirmAllocation();
window.closeAllocationModal = () => AdminModule.closeAllocationModal();

// Waiter Bridge
window.checkInGuest = () => WaiterModule.checkInGuest();
window.updateStatus = (phone, status) => WaiterModule.updateStatus(phone, status);

// ════════════════════════════════════════════════
// 🪄 INIT
// ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Dynamic Config
    document.title = CONFIG.EVENT_NAME;
    const invDate = document.getElementById('invitation-date');
    const invVenue = document.getElementById('invitation-venue');
    if (invDate) invDate.textContent = CONFIG.DATE;
    if (invVenue) invVenue.textContent = CONFIG.VENUE;

    // Fast Login Button
    const btnLogin = document.getElementById('btn-fast-login');
    if (btnLogin) btnLogin.onclick = handleFastLogin;

    // Auth Listener
    dbService.auth.onAuthStateChanged(user => {
        if (user) {
            handleLoginSuccess(user);
        } else {
            showScreen('screen-invitation');
        }
    });
});
