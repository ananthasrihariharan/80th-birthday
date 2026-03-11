import { SUPABASE_CONFIG, ADMIN_PHONES } from './config.js';

// Initialize Supabase
const { createClient } = window.supabase;
export const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// ════════════════════════════════════════════════
// AUTH & ROLE MANAGEMENT
// ════════════════════════════════════════════════

export async function getUserRole(phone) {
    if (ADMIN_PHONES.includes(phone)) return 'admin';

    const { data, error } = await supabase
        .from('roles')
        .select('role')
        .eq('phone', phone)
        .single();

    if (data) return data.role;
    return 'guest';
}

export async function addStaffRole(phone, role) {
    if (!phone || !role) return;
    const fullPhone = phone.startsWith('+') ? phone : '+91' + phone;
    await supabase.from('roles').upsert({ phone: fullPhone, role });
}

export async function removeStaff(phone) {
    await supabase.from('roles').delete().eq('phone', phone);
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

// ════════════════════════════════════════════════
// GUEST ALLOCATION
// ════════════════════════════════════════════════

export async function allocateGuest(guestPhone, waiterPhone, tableNumber) {
    const { error } = await supabase.from('guests').update({
        assigned_waiter: waiterPhone,
        table_number: tableNumber,
        status: 'active',
        allocated_at: new Date().toISOString()
    }).eq('phone', guestPhone);
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
    const { error } = await supabase.from('guests').update({ status }).eq('phone', guestPhone);
    if (error) throw error;
}

// ════════════════════════════════════════════════
// GUEST SERVICES
// ════════════════════════════════════════════════

export async function getGuest(phone) {
    const { data } = await supabase.from('guests').select('*').eq('phone', phone).single();
    return data;
}

export async function saveGuest(phone, data) {
    // Ensure phone is included in the upsert data
    const { error } = await supabase.from('guests').upsert({ phone, ...data });
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
    const fileName = `${phone}_${Date.now()}.jpg`;
    const { data, error } = await supabase.storage
        .from('outfits')
        .upload(fileName, file);

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
        .from('outfits')
        .getPublicUrl(fileName);

    // Save to guest record
    await supabase.from('guests').update({ outfit_url: publicUrl }).eq('phone', phone);
    return publicUrl;
}

export async function fetchAllOutfits() {
    const { data } = await supabase.from('guests').select('name, outfit_url').not('outfit_url', 'is', null);
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
    const fullPhone = phone.startsWith('+') ? phone : '+91' + phone;
    // For now, allow any valid-looking number to "login"
    // In production, you might want to check if they are in the 'guests' or 'roles' table first
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
    const { data: guest, error: fetchErr } = await supabase.from('guests').select('votes').eq('phone', outfitPhone).single();
    if (fetchErr) throw fetchErr;

    const { error: updateErr } = await supabase.from('guests').update({
        votes: (guest.votes || 0) + 1
    }).eq('phone', outfitPhone);
    if (updateErr) throw updateErr;
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
