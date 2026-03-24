import { CONFIG } from './config.js';
import * as dbService from './supabase-service.js';

// Import New Modules
import * as AdminModule from './modules/admin.js';
import * as WaiterModule from './modules/waiter.js';
import * as GuestModule from './modules/guest.js';
import * as OutfitModule from './modules/outfit.js';
import * as PoojaModule from './modules/pooja.js';
import * as ValetModule from './modules/valet.js';

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
    } else if (role === 'valet') {
        ValetModule.initValetDashboard(showScreen, showToast, currentUser);
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
        console.error("Login failed:", e);
        showToast('Login failed 🙏', 'error');
    }
    setLoading(false);
}

// Global scope exposures for HTML onclicks
window.showScreen = showScreen;
window.switchGuestTab = (id, btn) => {
    showScreen(id);
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
};
window.handleGalleryUpload = (btn) => GuestModule.handleGalleryUpload(btn);
window.toggleLike = (targetId, type, btn) => GuestModule.toggleSocialLike(targetId, type, btn);
window.logout = () => dbService.auth.signOut().then(() => showScreen('screen-login'));

window.openLightbox = (src) => {
    const lb = document.getElementById('lightbox-overlay');
    const lbimg = document.getElementById('lightbox-img');
    if(lb && lbimg && src) {
        lbimg.src = src;
        lb.style.display = 'flex';
    }
};
window.closeLightbox = () => {
    const lb = document.getElementById('lightbox-overlay');
    if(lb) lb.style.display = 'none';
};

window.openCardModal = (htmlContent) => {
    const modal = document.getElementById('card-modal-overlay');
    const content = document.getElementById('card-modal-content');
    if (modal && content) {
        content.innerHTML = `<div class="social-card" style="margin-bottom:0; cursor:default;">${htmlContent}</div>`;
        modal.style.display = 'flex';
    }
};
window.closeCardModal = () => {
    const modal = document.getElementById('card-modal-overlay');
    if(modal) modal.style.display = 'none';
};

window.openGalleryCard = (idx, focusComment = false) => GuestModule.openGalleryCard(idx, focusComment);
window.openOutfitCard = (idx) => OutfitModule.openOutfitCard(idx);
window.openAdminGalleryCard = (idx, focusComment = false) => AdminModule.openAdminGalleryCard(idx, focusComment);
window.submitGalleryComment = (postId) => GuestModule.submitGalleryComment(postId);
window.replyToComment = (username, postId, commentId) => {
    const input = document.getElementById(`comment-input-${postId}`);
    if(input) {
        input.value = `@${username} ` + input.value;
        input.dataset.parentId = commentId; // Store the ID to reply to
        input.focus();
    }
};
window.toggleLike = (id, type, btn) => GuestModule.toggleSocialLike(id, type, btn);


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
window.submitGuestForm = () => GuestModule.submitGuestForm(currentUser.phoneNumber, () => {
    dbService.getGuest(currentUser.phoneNumber).then(g => GuestModule.updateGuestUI(g, currentUser, showScreen));
}, showToast, setLoading);
window.handlePoojaGallery = () => PoojaModule.initPoojaGallery(showScreen);
window.openAllocationUI = (guestId) => AdminModule.openAllocationUI(guestId);
window.enterEditMode = () => GuestModule.enterEditMode(currentUser.phoneNumber);
window.requestValetPickup = () => GuestModule.requestValetPickup(currentUser.phoneNumber);

window.submitFeedback = () => {
    const stars = document.querySelectorAll('.star.active').length;
    const msg = document.getElementById('feedback-msg').value.trim();
    GuestModule.submitFeedback(currentUser.phoneNumber, stars, msg);
};

window.voteForOutfit = (outfitPhone) => GuestModule.voteForOutfit(currentUser.phoneNumber, outfitPhone);

// Admin Bridge
window.switchAdminTab = (btn, sectionId) => AdminModule.switchAdminTab(btn, sectionId);
window.toggleOutfitContest = () => AdminModule.toggleOutfitContest();
window.addNewStaff = () => AdminModule.addNewStaff();
window.removeStaff = (phone) => AdminModule.removeStaff(phone);
window.addNewDish = () => AdminModule.addNewDish();
window.removeDish = (id) => AdminModule.removeDish(id);
window.confirmAllocation = () => AdminModule.confirmAllocation();
window.closeAllocationModal = () => AdminModule.closeAllocationModal();
window.adminAssignValet = (id) => AdminModule.adminAssignValet(id);
window.adminValetReturnCar = (id) => AdminModule.adminValetReturnCar(id);
window.adminUpdateStatus = (phone, status) => AdminModule.adminUpdateStatus(phone, status);
window.handleGuestSearch = () => AdminModule.handleGuestSearch();
window.startAdminScanner = () => AdminModule.startAdminScanner();
window.stopAdminScanner = () => AdminModule.stopAdminScanner();
window.showGuestDetails = (phone) => AdminModule.showGuestDetails(phone);
window.closeGuestDetails = () => AdminModule.closeGuestDetails();
window.updateForecast = () => AdminModule.updateForecast();
window.uploadAdminPhoto = () => AdminModule.uploadAdminPhoto();
// Waiter Bridge
window.checkInGuest = () => WaiterModule.checkInGuest();
window.updateStatus = (phone, status) => WaiterModule.updateStatus(phone, status);

// Valet Bridge
window.valetSearchGuest = () => ValetModule.valetSearchGuest();
window.valetTakeCar = (id) => ValetModule.valetTakeCar(id);
window.valetReturnCar = (id) => ValetModule.valetReturnCar(id);
window.valetRequestedPickup = (id) => ValetModule.valetRequestedPickup(id);

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
