import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, addDoc, serverTimestamp, query, orderBy, onSnapshot, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { FIREBASE_CONFIG, ADMIN_PHONES } from './config.js';

// Initialize Firebase
const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ════════════════════════════════════════════════
// ROLE MANAGEMENT
// ════════════════════════════════════════════════

export async function getUserRole(phone) {
    if (ADMIN_PHONES.includes(phone)) return 'admin';

    // Check in 'roles' collection
    const roleRef = doc(db, 'roles', phone);
    const snap = await getDoc(roleRef);
    if (snap.exists()) {
        return snap.data().role; // 'admin' or 'waiter'
    }
    return 'guest';
}

export async function addStaffRole(phone, role) {
    if (!phone || !role) return;
    const fullPhone = phone.startsWith('+') ? phone : '+91' + phone;
    await setDoc(doc(db, 'roles', fullPhone), {
        role: role,
        addedAt: serverTimestamp()
    });
}

export async function removeStaff(phone) {
    await deleteDoc(doc(db, 'roles', phone));
}

export function listenToStaff(callback) {
    return onSnapshot(collection(db, 'roles'), (snap) => {
        const staff = [];
        snap.forEach(d => staff.push({ phone: d.id, ...d.data() }));
        callback(staff);
    });
}

// ════════════════════════════════════════════════
// GUEST ALLOCATION
// ════════════════════════════════════════════════

export async function allocateGuest(guestPhone, waiterPhone, tableNumber) {
    await updateDoc(doc(db, 'guests', guestPhone), {
        assignedWaiter: waiterPhone,
        tableNumber: tableNumber,
        status: 'active',
        allocatedAt: serverTimestamp()
    });
}

export function listenToAssignedGuests(waiterPhone, callback) {
    const q = query(collection(db, 'guests'), where('assignedWaiter', '==', waiterPhone));
    return onSnapshot(q, (snap) => {
        const guests = [];
        snap.forEach(d => guests.push({ phone: d.id, ...d.data() }));
        callback(guests);
    });
}

export async function updateGuestStatus(guestPhone, status) {
    await updateDoc(doc(db, 'guests', guestPhone), { status: status });
}

// ════════════════════════════════════════════════
// GUEST SERVICES
// ════════════════════════════════════════════════

export async function getGuest(phone) {
    const snap = await getDoc(doc(db, 'guests', phone));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveGuest(phone, data) {
    await setDoc(doc(db, 'guests', phone), {
        ...data,
        registeredAt: serverTimestamp()
    }, { merge: true });
}

export function listenToGuests(callback) {
    return onSnapshot(collection(db, 'guests'), (snap) => {
        const guests = [];
        snap.forEach(d => guests.push({ id: d.id, ...d.data() }));
        callback(guests);
    });
}

// ════════════════════════════════════════════════
// DISH SERVICES
// ════════════════════════════════════════════════

export function listenToDishes(callback) {
    return onSnapshot(query(collection(db, 'dishes'), orderBy('createdAt', 'desc')), (snap) => {
        const dishes = [];
        snap.forEach(d => dishes.push({ id: d.id, ...d.data() }));
        callback(dishes);
    });
}

export async function addDish(data) {
    await addDoc(collection(db, 'dishes'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

export async function removeDish(id) {
    await deleteDoc(doc(db, 'dishes', id));
}
