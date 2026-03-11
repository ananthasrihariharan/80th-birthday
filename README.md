# 🎂 80th Birthday Celebration App — Setup Guide

## What's in this App

| Role | Access | Key Features |
|------|--------|-------------|
| **Guest** | Mobile OTP login | View invitation → Register details → Select food → Get QR → (At event) Upload outfit → Vote → Give feedback |
| **Waiter** | Pre-configured phone numbers | Scan QR → See guest photo + name + food preferences → Mark as served → Auto-unlocks outfit feature for guest |
| **Admin** | Pre-configured phone number | Manage menu (add/remove dishes from DB) → See all guests → Kitchen demand analytics → Outfit contest leaderboard → Read feedback |

---

## 🔥 Firebase Setup (Step by Step)

### 1. Create Firebase Project
1. Go to https://console.firebase.google.com
2. Click "Add project" → Name it (e.g. `birthday-celebration`)
3. Disable Google Analytics (not needed) → Create project

### 2. Enable Authentication
1. Build → Authentication → Get started
2. Sign-in method → Phone → Enable → Save

### 3. Create Firestore Database
1. Build → Firestore Database → Create database
2. Choose "Start in production mode"
3. Select your region → Done
4. Go to **Rules** tab → Paste contents of `firestore.rules`

### 4. Create Storage
1. Build → Storage → Get started
2. Start in production mode → Done
3. Go to **Rules** tab → Paste contents of `storage.rules`

### 5. Get Your Config
1. Project Settings (gear icon) → General → Your apps
2. Click `</>` (Web) → Register app → Copy the firebaseConfig object

### 6. Update index.html
Find this section in `index.html` and replace with your values:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",           // ← replace
  authDomain: "YOUR_AUTH_DOMAIN",   // ← replace
  projectId: "YOUR_PROJECT_ID",     // ← replace
  storageBucket: "YOUR_STORAGE_BUCKET", // ← replace
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID", // ← replace
  appId: "YOUR_APP_ID"              // ← replace
};
```

### 7. Set Your Phone Numbers
In `index.html`, update these constants:
```javascript
const ADMIN_PHONE = "+919999999999";          // Your admin number
const WAITER_PHONES = ["+918888888888", ...]; // Waiter numbers (add as many as needed)
```

Also update the same numbers in `firestore.rules` and `storage.rules`.

---

## 🌿 Adding Your Vegetarian Menu

Once deployed, log in as **Admin** → go to **Menu** tab → Add each dish with:
- **Name**: e.g. "Sambar Rice"
- **Category**: e.g. "Main Course", "Starters", "Desserts", "Beverages"
- **Emoji**: e.g. 🍛
- **Description**: optional short note

Suggested categories for a South Indian vegetarian celebration:
- Starters
- Main Course
- Rice Varieties
- Breads
- Sides & Chutneys
- Desserts & Sweets
- Beverages

---

## 📱 Deploy to Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize (from the birthday-app folder)
firebase init hosting
# → Use existing project → select your project
# → Public directory: . (current folder)
# → Single-page app: Yes
# → Don't overwrite index.html

# Deploy!
firebase deploy
```

Your app will be live at: `https://YOUR-PROJECT-ID.web.app`

---

## 🎪 Event Day Flow

1. **Before event**: Admin adds all dishes via Menu tab
2. **Pre-event**: Share the app URL with guests via WhatsApp — they register, choose food, get their QR
3. **At entry**: Waiter scans each guest's QR → sees their photo + preferences → marks as served → **this automatically unlocks the outfit upload for that guest**
4. **During event**: Guests upload outfits, vote for each other
5. **After event**: Admin checks contest leaderboard → announces winner!

---

## 🔑 Key Design Decisions

### No Food Waste — How It Works
- Food preferences are registered **per family unit** — one QR per family
- The admin's **Kitchen Demand Forecast** shows total portions needed per dish
- If 5 families of 3 each want Sambar Rice → kitchen sees "15 portions of Sambar Rice needed"
- No duplicate counting, no guesswork

### Outfit Upload Locked by QR Scan
- The outfit upload section is hidden with a lock message
- Only when a waiter scans the guest's QR does the `outfitUnlocked: true` flag get set in Firestore
- The guest's app reflects this in real time — the section unlocks seamlessly

### Dishes from Database
- Admin manages all dishes from the Admin panel
- No hardcoded dishes anywhere in the code
- Dishes are grouped by category automatically on the guest form
- Admin can add/remove dishes at any time (even day-of if needed)

---

## 💛 Personalisation Checklist

- [ ] Replace grandparents placeholder with their actual photo (update the `gp-placeholder` div with an `<img>` tag)
- [ ] Update event date and venue in the invitation screen (`[DATE]` and `[VENUE]`)
- [ ] Update grandfather's name in the invite
- [ ] Add all waiter phone numbers
- [ ] Seed the menu with all dishes before sharing with guests
- [ ] Test the full guest flow on your own phone before sharing
