import * as dbService from '../supabase-service.js';

let outfitContestUnsub = null;

export function initOutfitUpload(showScreen, showToast, user) {
    showScreen('screen-outfit');

    // Cleanup old contest-state listener if any
    if (outfitContestUnsub) { outfitContestUnsub(); outfitContestUnsub = null; }

    // Listen to admin-controlled contest state
    outfitContestUnsub = dbService.listenToOutfitContestState((isActive) => {
        const locked = document.getElementById('outfit-locked-wrap');
        const open   = document.getElementById('outfit-open-wrap');
        if (locked) locked.style.display = isActive ? 'none' : '';
        if (open)   open.style.display   = isActive ? '' : 'none';
    });

    // Listen for Realtime updates to guests (who have outfit_urls)
    dbService.supabase
        .channel('outfit-gallery-sync')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'guests'
        }, () => {
            loadOutfitGallery();
        })
        .subscribe();

    loadOutfitGallery();
}

let currentOutfits = [];

async function loadOutfitGallery() {
    const gallery = document.getElementById('outfit-gallery');
    if (!gallery) return;

    try {
        currentOutfits = await dbService.fetchAllOutfits();
        if (currentOutfits.length === 0) {
            gallery.innerHTML = '<p class="text-center col-span-2 p-8 opacity-40 italic">Be the first to share your outfit! 🌸</p>';
            return;
        }

        const myPhone = dbService.normalizePhone(localStorage.getItem('user_phone') || '');
        const myLikes = await dbService.fetchUserLikes(myPhone);

        gallery.innerHTML = currentOutfits.map((o, i) => {
            const isLiked = myLikes.includes(o.phone);
            return `
                <div class="relative rounded-xl overflow-hidden aspect-[4/5] border border-cream shadow-sm fade-up cursor-pointer" onclick="openOutfitCard(${i})">
                    <img src="${o.outfit_url}" class="w-full h-full object-cover">
                    <div class="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm font-bold flex items-center gap-1">
                        ${isLiked ? '❤️' : '🤍'} ${o.votes || 0}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        gallery.innerHTML = '<p class="text-xs text-red-500 text-center col-span-2">Failed to load gallery</p>';
    }
}

export async function openOutfitCard(idx) {
    const o = currentOutfits[idx];
    if (!o) return;

    // Fetch user likes to check state for this specifically
    const myPhone = dbService.normalizePhone(localStorage.getItem('user_phone') || '');
    const likes = await dbService.fetchPostLikes(o.phone || o.id, 'outfit');
    const hasLiked = likes.some(l => dbService.normalizePhone(l.user_phone) === myPhone);

    const html = `
        <div class="social-head">
            ${o.photo_url ? `<img src="${o.photo_url}" class="social-avatar" onclick="openLightbox(this.src)" style="cursor:pointer;" alt="${o.name}'s Profile">` : `<div class="social-avatar-ph">🌸</div>`}
            <div style="flex:1;">
                <p class="social-name font-bold text-[14px]">${o.name}</p>
                <p class="text-[10px] opacity-40 uppercase tracking-widest">Outfit Contest</p>
            </div>
        </div>
        <div class="social-body">
            <img src="${o.outfit_url}" alt="${o.name}" class="social-img w-full block" onclick="openLightbox(this.src)" style="cursor:pointer;">
        </div>
        <div class="social-foot flex items-center justify-between px-4 py-3">
            <div class="flex items-center gap-2">
                <button onclick="window.toggleLike('${o.phone}', 'outfit', this)" class="like-btn p-0 text-2xl ${hasLiked ? 'liked' : ''} transition-transform active:scale-125">
                    ${hasLiked ? '❤️' : '🤍'}
                </button>
                <span class="text-[14px] font-bold text-brown-warm">${o.votes || 0}</span>
            </div>
            <span style="font-size:8px; opacity:0.3; letter-spacing:1px; text-transform:uppercase;">TAP TO VOTE ✨</span>
        </div>
    `;
    window.openCardModal(html);
}


export async function uploadOutfitPhoto(phone, showToast, setLoading) {
    const input = document.getElementById('outfit-file');
    if (!input || !input.files[0]) {
        showToast('Please select a photo first 📸', 'error');
        return;
    }

    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
        showToast('Photo too large (max 5MB)', 'error');
        return;
    }

    setLoading(true);
    try {
        await dbService.uploadOutfit(phone, file);
        showToast('Outfit shared with everyone! ✨', 'success');

        input.value = '';
        if (document.getElementById('file-name')) {
            document.getElementById('file-name').textContent = 'No file chosen';
        }
        // No need to manually load, Realtime listener will catch it
    } catch (e) {
        console.error(e);
        showToast('Upload failed 🙏', 'error');
    }
    setLoading(false);
}
