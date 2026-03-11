import * as dbService from '../supabase-service.js';

export function initGuestFlow(showScreen, showToast, currentUser) {
    // Instead of one-time check, we listen to the guest's own data for Realtime updates
    dbService.supabase
        .channel(`guest-self-${currentUser.phoneNumber}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'guests',
            filter: `phone=eq.${currentUser.phoneNumber}`
        }, (payload) => {
            console.log("🌸 Guest Data Updated:", payload.new);
            updateGuestUI(payload.new, currentUser, showScreen);
        })
        .subscribe();

    // Initial load
    dbService.getGuest(currentUser.phoneNumber).then(guestData => {
        updateGuestUI(guestData, currentUser, showScreen);
    });
}

function updateGuestUI(guestData, currentUser, showScreen) {
    if (guestData && guestData.completed) {
        showGuestDashboard(guestData, currentUser, showScreen);
    } else {
        showGuestForm(showScreen, currentUser);
    }
}

function showGuestForm(showScreen, currentUser) {
    showScreen('screen-guest-form');
    renderDishSelection();
}

function showGuestDashboard(guest, user, showScreen) {
    showScreen('screen-guest-dashboard');
    document.getElementById('display-name').textContent = guest.name;
    document.getElementById('display-count').textContent = guest.members;

    // Avatar (using photo_url from registration)
    const avatarImg = document.getElementById('g-avatar-img');
    const avatarPh = document.getElementById('g-avatar-ph');
    if (guest.photo_url) {
        avatarImg.src = guest.photo_url;
        avatarImg.style.display = 'block';
        avatarPh.style.display = 'none';
    }

    renderDishSummary(guest.dishes);
    generateQR(user.phoneNumber);

    // Outfit visibility - REACTION TO STATUS CHANGE
    const status = guest.status || 'pending';
    if (status === 'active' || status === 'served') {
        document.getElementById('outfit-locked-wrap').style.display = 'none';
        document.getElementById('outfit-open-wrap').style.display = 'block';
    } else {
        document.getElementById('outfit-locked-wrap').style.display = 'block';
        document.getElementById('outfit-open-wrap').style.display = 'none';
    }

    // Sync Outfit Wall (Global)
    dbService.listenToGuests((guests) => {
        renderPhotoWall(guests, user.phoneNumber);
    });
}

function generateQR(phone) {
    const container = document.getElementById('qrcode');
    if (!container) return;
    container.innerHTML = '';
    // Use high contrast for reliable scanning across all phones
    new QRCode(container, {
        text: JSON.stringify({ phone: phone, type: 'entry' }),
        width: 240,
        height: 240,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H // High error correction for better focus tolerance
    });
}

function renderDishSelection() {
    const container = document.getElementById('dishes-container');
    if (!container) return;

    dbService.listenToDishes((dishes) => {
        if (!dishes.length) {
            container.innerHTML = '<p class="text-center p-4 italic">The menu is being curated with love... 🌸</p>';
            return;
        }

        const categories = dishes.reduce((acc, d) => {
            const cat = d.category || 'Other';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(d);
            return acc;
        }, {});

        container.innerHTML = Object.entries(categories).map(([cat, items]) => `
            <div class="mb-6">
                <h4 class="category-label mb-3 text-gold text-xs tracking-widest uppercase font-bold">${cat}</h4>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    ${items.map(d => `
                        <div class="dish-chip premium-card p-3 cursor-pointer" data-id="${d.name}" onclick="this.classList.toggle('selected')">
                            <span class="text-2xl">${d.emoji || '🥗'}</span>
                            <span class="text-sm font-semibold block mt-1">${d.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    });
}

function renderDishSummary(selectedDishes) {
    const container = document.getElementById('dish-summary');
    if (!container) return;
    if (!selectedDishes || selectedDishes.length === 0) {
        container.innerHTML = '<p class="text-xs italic opacity-60">No dishes selected</p>';
        return;
    }
    container.innerHTML = `<p class="text-sm font-bold text-brown-warm">${selectedDishes.join(', ')}</p>`;
}

function renderPhotoWall(guests, myPhone) {
    const container = document.getElementById('photo-wall');
    const outfits = guests.filter(g => g.outfit_url);

    if (!outfits.length) {
        container.innerHTML = '<p class="no-data">Gallery is empty... ✨</p>';
        return;
    }

    container.innerHTML = outfits.map(g => `
        <div class="premium-card p-2 text-center">
            <div class="relative mb-2">
                <img src="${g.outfit_url}" class="w-full aspect-square object-cover rounded-lg">
                <button onclick="voteForOutfit('${g.phone}')" class="absolute bottom-2 right-2 bg-white/90 p-2 rounded-full shadow-lg">
                    ❤️ <span class="text-[10px] font-bold">${g.votes || 0}</span>
                </button>
            </div>
            <p class="text-[10px] font-bold truncate">${g.name}</p>
        </div>
    `).join('');
}

export async function voteForOutfit(voterPhone, outfitPhone) {
    try {
        await dbService.voteForOutfit(voterPhone, outfitPhone);
    } catch (e) {
        console.error("Vote failed", e);
    }
}

export async function submitFeedback(phone, stars, msg) {
    if (!stars) return alert('Select a star rating 🌸');
    if (!msg) return alert('Share a few words 🌸');

    try {
        await dbService.submitFeedback(phone, stars, msg);
        alert('Thank you for your warm wishes! 💛');
        document.getElementById('feedback-msg').value = '';
    } catch (e) {
        alert('Submission failed 🙏');
    }
}

export async function submitGuestForm(phone, onComplete, showToast, setLoading) {
    const name = document.getElementById('guest-name').value.trim();
    const count = parseInt(document.getElementById('guest-count').value);
    const favDish = document.getElementById('fav-dish').value.trim();
    const selected = [...document.querySelectorAll('.dish-chip.selected')].map(el => el.dataset.id);
    const photoFile = document.getElementById('family-photo').files[0];

    if (!name || isNaN(count)) {
        showToast('Please fill in your name 🌸', 'error');
        return;
    }

    setLoading(true);
    try {
        let photo_url = null;
        if (photoFile) {
            const fileName = `guest_${phone}_${Date.now()}.jpg`;
            const { error } = await dbService.supabase.storage.from('outfits').upload(fileName, photoFile);
            if (!error) {
                const { data } = dbService.supabase.storage.from('outfits').getPublicUrl(fileName);
                photo_url = data.publicUrl;
            }
        }

        await dbService.saveGuest(phone, {
            name,
            members: count,
            fav_dish: favDish,
            dishes: selected,
            photo_url: photo_url, // Now correctly matches the column
            completed: true,
            status: 'pending'
        });
        showToast('Successfully registered! ✨', 'success');
        // onComplete will route back to login success logic which now has Realtime listeners
        onComplete();
    } catch (e) {
        console.error(e);
        showToast('Registration failed 🙏', 'error');
    }
    setLoading(false);
};
