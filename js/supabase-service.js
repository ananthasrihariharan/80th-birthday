import { SUPABASE_CONFIG, ADMIN_PHONES } from './config.js';

// Initialize Supabase
const { createClient } = window.supabase;
export const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// ════════════════════════════════════════════════
// AUTH & ROLE MANAGEMENT
// ════════════════════════════════════════════════

// Helper to ensure phone numbers are consistent
export function normalizePhone(phone) {
    if (!phone) return "";
    const clean = phone.replace(/[\s-]/g, '');
    return clean.startsWith('+') ? clean : '+91' + clean;
}

export async function getUserRole(phone) {
    const fullPhone = normalizePhone(phone);
    if (ADMIN_PHONES.includes(fullPhone)) return 'admin';

    const { data, error } = await supabase
        .from('roles')
        .select('role')
        .eq('phone', fullPhone)
        .maybeSingle();

    if (data) return data.role;
    return 'guest';
}

export async function addStaffRole(phone, role, name = null) {
    if (!phone || !role) return;
    const fullPhone = normalizePhone(phone);
    const payload = { phone: fullPhone, role };
    if (name) payload.name = name;
    await supabase.from('roles').upsert(payload);
}

export async function removeStaff(phone) {
    const fullPhone = normalizePhone(phone);
    await supabase.from('roles').delete().eq('phone', fullPhone);
}

export function listenToStaff(callback) {
    // Supabase Realtime for roles
    const channel = supabase
        .channel('roles-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, () => {
            fetchStaff(callback);
        })
        .subscribe();

    fetchStaff(callback);
    return () => supabase.removeChannel(channel);
}

async function fetchStaff(callback) {
    const { data } = await supabase.from('roles').select('*');
    callback(data || []);
}

export async function setOutfitContestState(isActive) {
    // Use fixed key — do NOT go through normalizePhone as this is a settings row, not a phone
    const { error } = await supabase.from('roles').upsert(
        { phone: '__OUTFIT_CONTEST__', role: isActive ? 'active' : 'locked' },
        { onConflict: 'phone' }
    );
    if (error) {
        // Fallback: try insert then update
        await supabase.from('roles').insert({ phone: '__OUTFIT_CONTEST__', role: isActive ? 'active' : 'locked' })
            .then(() => {})
            .catch(() => supabase.from('roles').update({ role: isActive ? 'active' : 'locked' }).eq('phone', '__OUTFIT_CONTEST__'));
    }
}

export function listenToOutfitContestState(callback) {
    const KEY = '__OUTFIT_CONTEST__';
    const channel = supabase.channel('setting-outfit-contest')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'roles', filter: `phone=eq.${KEY}` }, (payload) => {
            callback(payload.new?.role === 'active');
        }).subscribe();

    // Initial fetch
    supabase.from('roles').select('role').eq('phone', KEY).maybeSingle().then(({ data }) => {
        callback(data?.role === 'active');
    });

    return () => supabase.removeChannel(channel);
}

// ════════════════════════════════════════════════
// GUEST ALLOCATION
// ════════════════════════════════════════════════

export async function allocateGuest(guestPhone, waiterPhone, tableNumber) {
    const fullGuestPhone = normalizePhone(guestPhone);
    const fullWaiterPhone = normalizePhone(waiterPhone);
    const { error } = await supabase.from('guests').update({
        assigned_waiter: fullWaiterPhone,
        table_number: tableNumber,
        status: 'active',
        allocated_at: new Date().toISOString()
    }).eq('phone', fullGuestPhone);
    if (error) throw error;
}

export function listenToAssignedGuests(waiterPhone, callback) {
    const channel = supabase
        .channel('assigned-guests')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'guests',
            filter: `assigned_waiter=eq.${waiterPhone}`
        }, () => {
            fetchAssignedGuests(waiterPhone, callback);
        })
        .subscribe();

    fetchAssignedGuests(waiterPhone, callback);
    return () => supabase.removeChannel(channel);
}

async function fetchAssignedGuests(waiterPhone, callback) {
    const { data } = await supabase.from('guests').select('*').eq('assigned_waiter', waiterPhone);
    callback(data || []);
}

export async function updateGuestStatus(guestPhone, status) {
    const fullPhone = normalizePhone(guestPhone);
    const { error } = await supabase.from('guests').update({ status }).eq('phone', fullPhone);
    if (error) throw error;
}

// ════════════════════════════════════════════════
// GUEST SERVICES
// ════════════════════════════════════════════════

export async function getGuest(phone) {
    const fullPhone = normalizePhone(phone);
    const { data } = await supabase.from('guests').select('*').eq('phone', fullPhone).maybeSingle();
    return data;
}

export async function saveGuest(phone, data) {
    const fullPhone = normalizePhone(phone);
    // Ensure phone is included in the upsert data
    const { error } = await supabase.from('guests').upsert({ phone: fullPhone, ...data });
    if (error) throw error;
}

export async function removeGuest(phone) {
    const fullPhone = normalizePhone(phone);
    const { error } = await supabase.from('guests').delete().eq('phone', fullPhone);
    if (error) throw error;
}

export function listenToGuests(callback) {
    const channel = supabase
        .channel('guests-all')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, () => {
            fetchAllGuests(callback);
        })
        .subscribe();

    fetchAllGuests(callback);
    return () => supabase.removeChannel(channel);
}

async function fetchAllGuests(callback) {
    const { data } = await supabase.from('guests').select('*');
    callback(data || []);
}

// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
// 📸 EVENT GALLERY & SOCIAL
// ════════════════════════════════════════════════

export async function uploadGalleryPhoto(phone, file, message) {
    const fileName = `gallery_${phone.replace(/\+/g, '')}_${Date.now()}.jpg`;
    
    // Upload to dedicated event-gallery bucket
    const { error: uploadErr } = await supabase.storage.from('event-gallery').upload(fileName, file);
    if (uploadErr) throw uploadErr;

    const { data } = supabase.storage.from('event-gallery').getPublicUrl(fileName);
    
    // Create post entry
    const { error: postErr } = await supabase.from('gallery_posts').insert([{
        guest_phone: phone,
        photo_url: data.publicUrl,
        message: message || ''
    }]);
    if (postErr) throw postErr;
}

export async function fetchGalleryPosts() {
    const { data } = await supabase.from('gallery_posts')
        .select('*, guests(name, photo_url)')
        .order('created_at', { ascending: false });
    return data || [];
}

export function listenToGallery(callback) {
    const chan = supabase
        .channel('gallery-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gallery_posts' }, () => {
            fetchGalleryPosts().then(callback);
        })
        .subscribe();
    fetchGalleryPosts().then(callback);
    return () => supabase.removeChannel(chan);
}

export async function removeGalleryPost(postId) {
    const { error } = await supabase.from('gallery_posts').delete().eq('id', postId);
    if (error) throw error;
}

// ════════════════════════════════════════════════
// 💬 COMMENTS
// ════════════════════════════════════════════════

export async function addComment(postId, phone, content, parentId = null) {
    const { error } = await supabase.from('comments').insert([{
        post_id: postId,
        guest_phone: phone,
        content: content,
        parent_id: parentId
    }]);
    if (error) throw error;
}

export async function fetchComments(postId) {
    const { data } = await supabase.from('comments')
        .select('*, guests(name, photo_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
    return data || [];
}

export function listenToComments(postId, callback) {
    const chan = supabase
        .channel(`comments-${postId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, () => {
            fetchComments(postId).then(callback);
        })
        .subscribe();
    fetchComments(postId).then(callback);
    return () => supabase.removeChannel(chan);
}

// ════════════════════════════════════════════════
// ❤️ LIKES
// ════════════════════════════════════════════════

export async function fetchPostLikes(postId, type = 'gallery') {
    const { data } = await supabase.from('likes')
        .select('user_phone, guests(name, photo_url)')
        .eq('target_id', postId)
        .eq('target_type', type);
    return data || [];
}

export async function fetchUserLikes(userPhone) {
    const { data } = await supabase.from('likes')
        .select('target_id')
        .eq('user_phone', userPhone);
    return (data || []).map(l => l.target_id);
}


/**
 * Universal Like System
 * @param {string} userPhone - Phone of person liking
 * @param {string} targetId - Post UUID or Outfit Guest Phone
 * @param {string} type - 'gallery' or 'outfit'
 */
export async function toggleLike(userPhone, targetId, type) {
    const fullPhone = normalizePhone(userPhone);
    // 1. Check if already liked
    const { data: existing } = await supabase.from('likes')
        .select('id')
        .eq('user_phone', fullPhone)
        .eq('target_id', targetId)
        .eq('target_type', type)
        .maybeSingle(); // Better than .single() which errors on zero results

    if (existing) {
        // Unlike - Counts are updated by tr_update_like_count in Postgres
        await supabase.from('likes').delete().eq('id', existing.id);
    } else {
        // Like - Counts are updated by tr_update_like_count in Postgres
        await supabase.from('likes').insert([{
            user_phone: fullPhone,
            target_id: targetId,
            target_type: type
        }]);
    }
}


// DISH SERVICES
// ════════════════════════════════════════════════

export async function fetchDishes() {
    const { data } = await supabase.from('dishes').select('*').order('created_at', { ascending: false });
    return data || [];
}

export function listenToDishes(callback) {
    const channel = supabase
        .channel('dishes-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, () => {
            fetchDishes().then(callback);
        })
        .subscribe();

    fetchDishes().then(callback);
    return () => supabase.removeChannel(channel);
}

export async function addDish(data) {
    await supabase.from('dishes').insert([data]);
}

export async function removeDish(id) {
    await supabase.from('dishes').delete().eq('id', id);
}

// ════════════════════════════════════════════════
// STORAGE SERVICES (Outfit Uploads)
// ════════════════════════════════════════════════

export async function uploadOutfit(phone, file) {
    const fileName = `${phone.replace(/\+/g, '')}_${Date.now()}.jpg`;
    const { data, error } = await supabase.storage
        .from('outfits')
        .upload(fileName, file, { contentType: 'image/jpeg' });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
        .from('outfits')
        .getPublicUrl(fileName);

    // Save to guest record
    await supabase.from('guests').update({ outfit_url: publicUrl }).eq('phone', phone);
    return publicUrl;
}

export async function fetchAllOutfits() {
    const { data } = await supabase.from('guests').select('name, phone, outfit_url, votes, photo_url').not('outfit_url', 'is', null);
    return data || [];
}

// ════════════════════════════════════════════════
// AUTH WRAPPERS
// ════════════════════════════════════════════════
// Since we are using "Fast Login" (custom db check) for free tier:
export const auth = {
    async signOut() {
        localStorage.removeItem('user_phone');
        window.location.reload();
    },
    onAuthStateChanged(callback) {
        const phone = localStorage.getItem('user_phone');
        if (phone) {
            callback({ phoneNumber: phone });
        } else {
            callback(null);
        }
    }
};

// Custom Login Logic
export async function fastLogin(phone) {
    const fullPhone = normalizePhone(phone);
    // For now, allow any valid-looking number to "login"
    localStorage.setItem('user_phone', fullPhone);
    return { phoneNumber: fullPhone };
}

// ════════════════════════════════════════════════
// FEEDBACK & VOTING
// ════════════════════════════════════════════════

export async function submitFeedback(phone, rating, message) {
    const { error } = await supabase.from('feedback').insert([{ phone, rating, message }]);
    if (error) throw error;
}

export function listenToFeedback(callback) {
    const channel = supabase
        .channel('feedback-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'feedback' }, () => {
            fetchFeedback(callback);
        })
        .subscribe();

    fetchFeedback(callback);
    return () => supabase.removeChannel(channel);
}

async function fetchFeedback(callback) {
    const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false });
    callback(data || []);
}

export async function voteForOutfit(voterPhone, outfitPhone) {
    // Redirecting to universal like system for consistency
    return toggleLike(voterPhone, outfitPhone, 'outfit');
}

// Connection Check
export async function checkConnection() {
    console.log("🌸 Attempting to connect to Supabase:", SUPABASE_CONFIG.url);
    try {
        const { error } = await supabase.from('dishes').select('id', { head: true }).limit(1);
        if (error) {
            console.warn("⚠️ Supabase Connection Warning:", error.message);
            return false;
        }
        console.log("✅ Supabase Connected Successfully!");
        return true;
    } catch (e) {
        console.error("❌ Supabase Connection Critical Error:", e);
        return false;
    }
}
