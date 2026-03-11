import * as dbService from '../supabase-service.js';

export function initOutfitUpload(showScreen, showToast, user) {
    showScreen('screen-outfit');

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

async function loadOutfitGallery() {
    const gallery = document.getElementById('outfit-gallery');
    if (!gallery) return;

    try {
        const outfits = await dbService.fetchAllOutfits();
        if (outfits.length === 0) {
            gallery.innerHTML = '<p class="text-center p-8 opacity-50 italic">Be the first to share your outfit! 🌸</p>';
            return;
        }

        gallery.innerHTML = outfits.map(o => `
            <div class="outfit-card stagger-in">
                <img src="${o.outfit_url}" alt="${o.name}" class="rounded-xl shadow-lg w-full h-48 object-cover mb-2 border border-cream">
                <p class="text-xs font-bold text-center text-brown-warm">${o.name}</p>
            </div>
        `).join('');
    } catch (e) {
        gallery.innerHTML = '<p class="text-xs text-red-500 text-center">Failed to load gallery</p>';
    }
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
