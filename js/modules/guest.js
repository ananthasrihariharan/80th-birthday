import * as dbService from '../supabase-service.js';

// --- Multi-Session Menu Logic ---
let currentMenuDay = 1;
let currentMenuSession = 'Breakfast';
let guestMenuSelections = {}; // { "day1_breakfast": { dishes: [], fav: "" }, ... }
let allAvailableDishes = [];
let lastGuestData = null;

window.switchMenuDay = (day) => {
    saveCurrentSessionMemory();
    currentMenuDay = day;
    document.querySelectorAll('.day-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.day) === day));
    updateMenuPanel(false);
};

window.switchMenuSession = (sess, btn) => {
    saveCurrentSessionMemory();
    currentMenuSession = sess;
    document.querySelectorAll('.sess-btn').forEach(b => b.classList.toggle('active', b === btn));
    updateMenuPanel(false);
};

function updateMenuPanel(saveFirst = true) {
    // Save current session's data before switching ONLY if specified
    if (saveFirst) saveCurrentSessionMemory();

    const container = document.getElementById('dishes-container');
    const label = document.getElementById('current-sess-label');
    if (label) label.textContent = `Day ${currentMenuDay} ${currentMenuSession}`;

    const sessionKey = `day${currentMenuDay}_${currentMenuSession.toLowerCase()}`;
    const sessionData = guestMenuSelections[sessionKey] || { dishes: [], fav: "" };

    // Filter dishes for this session
    const filtered = allAvailableDishes.filter(d => 
        (d.day === currentMenuDay || d.day === 0) && 
        (d.session === currentMenuSession || !d.session)
    );

    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-xs italic opacity-60 p-4">Menu coming soon... 🌸</p>';
    } else {
        container.innerHTML = `
            <div class="dish-grid">
                ${filtered.map(d => `
                    <div class="dish-chip ${sessionData.dishes.includes(d.name) ? 'selected' : ''}" 
                        data-id="${d.name}" 
                        onclick="this.classList.toggle('selected')"
                        style="cursor:pointer;">
                        <span class="dish-emoji">${d.emoji || '🥗'}</span>
                        <span class="dish-name">${d.name}</span>
                        <div class="dish-check">✓</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Restore fav note
    const noteEl = document.getElementById('session-fav-note');
    if (noteEl) noteEl.value = sessionData.fav || "";
}

function saveCurrentSessionMemory() {
    const prevKey = `day${currentMenuDay}_${currentMenuSession.toLowerCase()}`;
    const selected = [...document.querySelectorAll('#dishes-container .dish-chip.selected')].map(el => el.dataset.id);
    const fav = document.getElementById('session-fav-note')?.value.trim() || "";
    
    if (selected.length > 0 || fav) {
        guestMenuSelections[prevKey] = { dishes: selected, fav };
    } else {
        delete guestMenuSelections[prevKey];
    }
}

export function renderDishSelection() {
    dbService.listenToDishes((dishes) => {
        allAvailableDishes = dishes;
        updateMenuPanel();
        if (lastGuestData) renderMenuTimelineChips(lastGuestData);
    });
}

export async function submitGuestForm(phone, onComplete, showToast, setLoading) {
    saveCurrentSessionMemory(); // Final save of current tab

    const name = document.getElementById('guest-name').value.trim();
    const count = parseInt(document.getElementById('guest-count').value);
    const photoFile = document.getElementById('family-photo').files[0];

    // Valet info
    const valetNeeded = document.getElementById('valet-yes-btn')?.classList.contains('active');
    const valetCarNumber = document.getElementById('valet-car-number')?.value.trim().toUpperCase();
    const valetCarModel = document.getElementById('valet-car-model')?.value.trim();
    const valetCarColour = document.getElementById('valet-car-colour')?.value.trim();
    const valetArrivalTime = document.getElementById('valet-arrival-time')?.value;
    const valetNotes = document.getElementById('valet-notes')?.value.trim();

    if (!name || isNaN(count)) {
        showToast('Please fill in your name 🌸', 'error');
        return;
    }

    setLoading(true);
    try {
        const updateData = {
            name,
            members: count,
            menu_selections: guestMenuSelections,
            completed: true,
            status: 'pending',
            valet_needed: valetNeeded || false
        };

    if (photoFile) {
            console.log("📸 Attempting photo upload to 'family-photos' bucket...");
            const fileName = `guest_${phone.replace('+', '')}_${Date.now()}.jpg`;
            const { error } = await dbService.supabase.storage.from('family-photos').upload(fileName, photoFile, { contentType: 'image/jpeg' });
            
            if (!error) {
                const { data } = dbService.supabase.storage.from('family-photos').getPublicUrl(fileName);
                updateData.photo_url = data.publicUrl;
                console.log("✅ Photo uploaded successfully:", updateData.photo_url);
            } else {
                console.error("❌ Photo upload error:", error);
                showToast('Oops, couldn\'t save the photo 📸', 'error');
            }
        } else {
            // Preserve existing photo if editing
            const existingPhoto = document.getElementById('family-photo').dataset.existing;
            if (existingPhoto) {
                updateData.photo_url = existingPhoto;
            }
        }

        await dbService.saveGuest(phone, updateData);

        // Valet request
        if (valetNeeded && valetCarNumber) {
            const normalizedGuestPhone = dbService.normalizePhone(phone);
            await dbService.supabase.from('valet_requests').upsert({
                guest_phone: normalizedGuestPhone,
                car_number: valetCarNumber,
                car_model: valetCarModel,
                car_colour: valetCarColour,
                arrival_time: valetArrivalTime || null,
                notes: valetNotes || null,
                status: 'pending',
                created_at: new Date().toISOString()
            }, { onConflict: 'guest_phone' });
        }

        showToast('Registration successful! ✨', 'success');
        onComplete();
    } catch (e) {
        console.error(e);
        showToast('Registration failed 🙏', 'error');
    }
    setLoading(false);
}

export function enterEditMode() {
    const phone = window.currentUserPhone; // We'll need to set this globally or pass it
    if (!phone) return;

    dbService.getGuest(phone).then(guest => {
        if (!guest) return;
        
        window.showScreen('screen-guest-form');
        
        document.getElementById('guest-name').value = guest.name || '';
        document.getElementById('guest-count').value = guest.members || 1;
        
        const submitBtn = document.getElementById('btn-submit');
        if (submitBtn) submitBtn.innerHTML = 'Update Details ✦';

        // Photo Preview in Edit Mode
        const photoInput = document.getElementById('family-photo');
        const photoLabel = document.getElementById('photo-label');
        if (guest.photo_url) {
            photoInput.dataset.existing = guest.photo_url;
            photoLabel.textContent = '📸 Photo already uploaded (Tap to change)';
            // Show a small preview if possible
            let preview = document.getElementById('edit-photo-preview');
            if (!preview) {
                preview = document.createElement('img');
                preview.id = 'edit-photo-preview';
                preview.style.cssText = 'width:60px;height:60px;border-radius:10px;object-fit:cover;margin-top:10px;border:2px solid var(--gold);';
                photoLabel.parentElement.appendChild(preview);
            }
            preview.src = guest.photo_url;
            preview.style.display = 'block';
        } else {
            photoInput.dataset.existing = '';
            photoLabel.textContent = 'Tap here to choose a photo';
            const preview = document.getElementById('edit-photo-preview');
            if (preview) preview.style.display = 'none';
        }
        
        // Load menu selections
        guestMenuSelections = guest.menu_selections || {};
        
        // Reset to first tab visually without triggering a save that overwrites
        currentMenuDay = 1;
        currentMenuSession = 'Breakfast';
        document.querySelectorAll('.day-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.day) === 1));
        document.querySelectorAll('.sess-btn').forEach(b => b.classList.toggle('active', b.dataset.sess === 'Breakfast'));
        updateMenuPanel(false);

        const valetBtnYes = document.getElementById('valet-yes-btn');
        const valetWrap = document.getElementById('valet-details');
        
        if (guest.valet_needed) {
            valetBtnYes?.classList.add('active');
            if (valetWrap) valetWrap.style.display = 'block';
            
            const normalizedPhone = dbService.normalizePhone(phone);
            dbService.supabase.from('valet_requests').select('*').eq('guest_phone', normalizedPhone).maybeSingle().then(({data}) => {
                if(data) {
                    const carNum = document.getElementById('valet-car-number');
                    const carModel = document.getElementById('valet-car-model');
                    const carColour = document.getElementById('valet-car-colour');
                    const arrivalTime = document.getElementById('valet-arrival-time');
                    const notes = document.getElementById('valet-notes');

                    if(carNum) carNum.value = data.car_number || '';
                    if(carModel) carModel.value = data.car_model || '';
                    if(carColour) carColour.value = data.car_colour || '';
                    if(arrivalTime) arrivalTime.value = data.arrival_time || '';
                    if(notes) notes.value = data.notes || '';
                }
            });
        }
    });
}

function showGuestDashboard(guest, user, showScreen) {
    showScreen('screen-guest-dashboard');
    document.getElementById('display-name').textContent = guest.name;
    document.getElementById('display-count').textContent = guest.members;

    const avatarImg = document.getElementById('g-avatar-img');
    const avatarPh = document.getElementById('g-avatar-ph');
    if (guest.photo_url) {
        avatarImg.src = guest.photo_url;
        avatarImg.style.display = 'block';
        avatarPh.style.display = 'none';
    } else {
        avatarImg.style.display = 'none';
        avatarPh.style.display = 'flex';
    }

    // Render Menu Chips
    renderMenuTimelineChips(guest);

    // QR Generation
    generateQR(user.phoneNumber);
    window.currentUserPhone = user.phoneNumber; 
    
    // Listeners
    startValetListener(user.phoneNumber);
    
    // Social Feed Listener
    dbService.listenToGallery(async (posts) => {
        const phone = localStorage.getItem('user_phone');
        const myLikes = phone ? await dbService.fetchUserLikes(phone) : [];
        renderEventGalleryFeed(posts, myLikes);
    });
}

function generateQR(phone) {
    const container = document.getElementById('qrcode');
    if (!container) return;
    container.innerHTML = '';
    new QRCode(container, {
        text: JSON.stringify({ phone: phone, type: 'entry' }),
        width: 180, // Slightly bigger for visibility
        height: 180,
        colorDark: "#4a1212",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

// ════════════════════════════════════════════════
// 📸 SOCIAL GALLERY (MEMORY WALL)
// ════════════════════════════════════════════════

export async function handleGalleryUpload(btn) {
    const fileInput = document.getElementById('gallery-file');
    const msgInput = document.getElementById('gallery-msg');
    
    if (!fileInput || !fileInput.files[0]) {
        return window.showToast('Please select a photo first 📸', 'error');
    }

    const file = fileInput.files[0];
    const message = msgInput.value.trim();
    const phone = localStorage.getItem('user_phone');

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Uploading... 🌸';

    try {
        await dbService.uploadGalleryPhoto(phone, file, message);
        window.showToast('Moment shared successfully! ✨', 'success');
        fileInput.value = '';
        msgInput.value = '';
        const label = document.getElementById('gallery-file-name');
        if (label) label.textContent = 'Choose a photo...';
    } catch (e) {
        console.error(e);
        window.showToast('Upload failed 🙏', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

let currentGalleryPosts = [];

export function renderEventGalleryFeed(posts, userLikes = []) {
    const feed = document.getElementById('event-gallery-feed');
    if (!feed) return;

    currentGalleryPosts = posts || [];

    if (currentGalleryPosts.length === 0) {
        feed.innerHTML = '<p class="no-data col-span-2" style="padding:40px;">Be the first to share a moment! 📸</p>';
        return;
    }

    feed.innerHTML = currentGalleryPosts.map((post, i) => {
        const isLiked = userLikes.includes(post.id);
        return `
            <div class="relative rounded-xl overflow-hidden aspect-[4/5] border border-cream shadow-sm fade-up cursor-pointer" onclick="openGalleryCard(${i})">
                <img src="${post.photo_url}" class="w-full h-full object-cover" loading="lazy">
                <div class="absolute bottom-2 right-2 flex gap-1.5" style="z-index: 5;">
                    <div class="bg-black/60 text-white text-[10px] px-2.5 py-1 rounded-full backdrop-blur-sm font-bold flex items-center gap-1.5"
                         onclick="event.stopPropagation(); window.toggleLike('${post.id}', 'gallery', this)">
                        ${isLiked ? '❤️' : '🤍'} ${post.likes_count || 0}
                    </div>
                    <div class="bg-black/60 text-white text-[10px] px-2.5 py-1 rounded-full backdrop-blur-sm font-bold flex items-center gap-1.5"
                         onclick="event.stopPropagation(); openGalleryCard(${i}, true)">
                        💬 ${post.comments_count || 0}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

export async function openGalleryCard(idx, focusComment = false) {
    const post = currentGalleryPosts[idx];
    if (!post) return;
    const dateStr = new Date(post.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const name = post.guests?.name || 'Someone Special';
    const avatar = post.guests?.photo_url || '';
    
    // Fetch Likes to check state and get names
    const myPhone = dbService.normalizePhone(localStorage.getItem('user_phone') || '');
    const likes = await dbService.fetchPostLikes(post.id);
    const hasLiked = likes.some(l => dbService.normalizePhone(l.user_phone) === myPhone);
    
    // Likely list summary
    let likersHTML = '';
    if (likes.length > 0) {
        const firstLiker = likes[0].guests?.name || 'A Guest';
        if (likes.length === 1) likersHTML = `Liked by <span class="font-bold">${firstLiker}</span>`;
        else likersHTML = `Liked by <span class="font-bold">${firstLiker}</span> and <span class="font-bold">${likes.length - 1} others</span>`;
    }

    const html = `
        <div class="social-head">
            ${avatar ? `<img src="${avatar}" class="social-avatar" onclick="openLightbox(this.src)" style="cursor:pointer;" alt="Profile">` : `<div class="social-avatar-ph">🌸</div>`}
            <div style="flex:1;">
                <p class="social-name text-[14px] font-bold text-brown-deep">${name}</p>
                <p class="social-meta text-[10px] opacity-60">${dateStr} ✦ Memory Wall</p>
            </div>
        </div>
        
        <div class="social-body relative overflow-hidden" ondblclick="handleDoubleTapLike('${post.id}')">
            <img src="${post.photo_url}" class="social-img w-full block" loading="lazy" onclick="openLightbox(this.src)" style="cursor:pointer;">
        </div>

        <div class="px-4 py-3 bg-white">
            <div class="flex items-center gap-4 mb-3">
                <div class="flex items-center gap-1.5 action-trigger" onclick="toggleLike('${post.id}', 'gallery', this.querySelector('.like-btn'))">
                    <button class="like-btn p-0 text-2xl ${hasLiked ? 'liked' : ''} transition-transform active:scale-125">
                        ${hasLiked ? '❤️' : '🤍'}
                    </button>
                    <span class="text-[14px] font-bold text-brown-warm">${post.likes_count || 0}</span>
                </div>
                <div class="flex items-center gap-1.5 action-trigger" onclick="document.getElementById('comment-input-${post.id}').focus()">
                    <button class="p-0 text-2xl opacity-80">💬</button>
                    <span class="text-[14px] font-bold text-brown-warm">${post.comments_count || 0}</span>
                </div>
            </div>
            
            <p class="text-[12px] font-bold mb-1.5">${likersHTML}</p>
            
            ${post.message ? `
            <div class="text-[13px] leading-relaxed mb-1">
                <span class="font-bold mr-1.5 text-brown-deep">${name}</span>
                <span class="text-text-mid opacity-95">${post.message}</span>
            </div>` : ''}
            
            <p class="text-[9px] uppercase tracking-widest opacity-30 mt-3 font-extrabold pb-1">Shared with Love</p>
        </div>

        <div class="border-t border-cream/20">
            <div id="card-comments-${post.id}" class="social-comments hide-sb px-4 py-3 flex flex-col gap-3" style="max-height:260px; overflow-y:auto;">
                <p class="text-[10px] opacity-40 text-center py-2">Loading notes... 🌸</p>
            </div>
            
            <div class="comment-input-area px-4 pb-4 flex gap-2">
                <input type="text" id="comment-input-${post.id}" class="input-field m-0" placeholder="Add a note..." style="padding:10px 14px; font-size:12px; min-height:unset; border-radius:16px;">
                <button class="btn-gold m-0 w-auto px-4" onclick="submitGalleryComment('${post.id}')" style="font-size:11px;">Post</button>
            </div>
        </div>
    `;
    window.openCardModal(html);

    if (focusComment) {
        setTimeout(() => {
            const input = document.getElementById(`comment-input-${post.id}`);
            if (input) {
                input.focus();
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 300);
    }

    if (window.activeCommentListener) {
        window.activeCommentListener(); // Unsub previous
    }
    
    // Start listening
    window.activeCommentListener = dbService.listenToComments(post.id, (comments) => {
        const cdiv = document.getElementById(`card-comments-${post.id}`);
        if (!cdiv) return;
        
        if (!comments || comments.length === 0) {
            cdiv.innerHTML = '<p class="text-[10px] opacity-40 text-center py-2">Be the first to comment ✨</p>';
            return;
        }

        // Hierarchical rendering
        const roots = comments.filter(c => !c.parent_id);
        const children = comments.filter(c => c.parent_id);

        const renderComment = (c, level = 0) => {
            const commenterName = c.guests?.name || 'Someone';
            const safeName = commenterName.replace(/'/g, "\\'");
            const isChild = level > 0;
            
            let html = `
            <div class="flex gap-2 items-start ${isChild ? 'ml-8' : ''}">
                ${c.guests?.photo_url ? `<img src="${c.guests.photo_url}" class="${isChild ? 'w-5 h-5' : 'w-6 h-6'} rounded-full object-cover cursor-pointer" onclick="openLightbox(this.src)">` : `<div class="${isChild ? 'w-5 h-5' : 'w-6 h-6'} rounded-full bg-ivory flex items-center justify-center text-[7px]">🌸</div>`}
                <div class="flex-1 bg-ivory rounded-2xl rounded-tl-none p-2 border border-cream">
                    <p class="${isChild ? 'text-[8px]' : 'text-[9px]'} font-bold text-brown-warm">${commenterName}</p>
                    <p class="${isChild ? 'text-[10px]' : 'text-[11px]'} text-text-mid mt-0.5">${c.content}</p>
                    ${level < 2 ? `<button class="text-[9px] font-bold text-gold mt-1 opacity-70 hover:opacity-100" onclick="replyToComment('${safeName}', '${post.id}', '${c.id}')">Reply</button>` : ''}
                </div>
            </div>
            `;

            // Render children
            const replies = children.filter(child => child.parent_id === c.id);
            replies.forEach(r => {
                html += renderComment(r, level + 1);
            });

            return html;
        };

        cdiv.innerHTML = roots.map(root => renderComment(root)).join('');
        // scroll to bottom
        cdiv.scrollTop = cdiv.scrollHeight;
    });
}

export async function submitGalleryComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input?.value.trim();
    const parentId = input?.dataset.parentId || null;
    
    if (!content) return;

    const myPhone = localStorage.getItem('user_phone');
    if (!myPhone) return window.showToast('Please login to comment 🙏', 'error');

    input.value = ''; // Optimistic clear
    delete input.dataset.parentId; // Clear reply state
    
    try {
        await dbService.addComment(postId, myPhone, content, parentId);
        if(window.showToast) window.showToast('Comment posted! 🌸');
    } catch (e) {
        console.error(e);
        if(window.showToast) window.showToast('Failed to post comment', 'error');
    }
}

export async function toggleSocialLike(targetId, type, btn) {
    const phone = localStorage.getItem('user_phone');
    if (!phone) return window.showToast('Please login to like 🌸', 'error');

    try {
        if (navigator.vibrate) navigator.vibrate(30);
        
        // Optimistic UI toggle
        const isLiked = btn && btn.classList.contains('liked');
        if (btn) {
            btn.classList.toggle('liked');
            btn.innerHTML = btn.classList.contains('liked') ? '❤️' : '🤍';
        }

        await dbService.toggleLike(phone, targetId, type);
    } catch (e) {
        console.error(e);
        // Revert on error
        if (btn) {
            btn.classList.toggle('liked');
            btn.innerHTML = btn.classList.contains('liked') ? '❤️' : '🤍';
        }
    }
}

window.handleDoubleTapLike = async (postId) => {
    const modal = document.getElementById('card-modal-content');
    const btn = modal?.querySelector('.like-btn');
    if (btn && !btn.classList.contains('liked')) {
        toggleSocialLike(postId, 'gallery', btn);
    }
    // Simple visual pop for heart
    const imgCont = modal?.querySelector('.social-body');
    const heart = document.createElement('div');
    heart.innerHTML = '❤️';
    heart.style.cssText = `position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) scale(0); font-size:60px; pointer-events:none; transition:transform 0.5s var(--ease-spring); z-index:10;`;
    imgCont?.appendChild(heart);
    setTimeout(() => heart.style.transform = 'translate(-50%,-50%) scale(1.5)', 10);
    setTimeout(() => heart.style.opacity = '0', 400);
    setTimeout(() => heart.remove(), 600);
};

function renderMenuTimelineChips(guestData) {
    const container = document.getElementById('menu-timeline');
    if (!container) return;

    const selections = guestData.menu_selections || {};
    if (Object.keys(selections).length === 0) {
        container.innerHTML = '<p class="no-data">No meals selected yet. 🍽️</p>';
        return;
    }

    const sorted = Object.entries(selections).sort((a,b) => a[0].localeCompare(b[0]));

    container.innerHTML = sorted.map(([key, data]) => {
        const [day, sess] = key.split('_');
        const dayLabel = day === 'day1' ? 'Day 1' : 'Day 2';
        
        // Resolve IDs to Names
        const dishNames = (data.dishes || []).map(id => {
            const d = allAvailableDishes.find(item => item.id === id);
            return d ? d.name : id;
        });

        return `
            <div class="timeline-item border-l-2 border-gold-pale pl-4 pb-4 relative">
                <div class="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-gold"></div>
                <div class="tl-head flex justify-between items-center">
                    <span class="tl-day text-[10px] uppercase tracking-wider font-bold text-gold">${dayLabel}</span>
                    <span class="tl-sess text-xs font-bold text-brown-warm">${sess.replace(/-/g, ' ').toUpperCase()}</span>
                </div>
                <div class="tl-body mt-2">
                    <div class="flex flex-wrap gap-1.5">
                        ${dishNames.map(name => `<span class="px-2 py-0.5 bg-ivory border border-cream rounded-lg text-[11px] font-bold text-text-mid">✦ ${name}</span>`).join('')}
                    </div>
                    ${data.fav ? `
                    <div class="mt-2 p-2 bg-cream/30 rounded-lg border-l-2 border-gold italic text-[11px] text-text-soft">
                        " ${data.fav} "
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ════════════════════════════════════════════════
// 🚗 VALET PICKUP REQUEST
// ════════════════════════════════════════════════

export async function requestValetPickup(phone) {
    try {
        const { error } = await dbService.supabase
            .from('valet_requests')
            .update({ status: 'pickup_requested' })
            .eq('guest_phone', phone);

        if (error) throw error;
        if (window.showToast) window.showToast('Car pickup requested! 🚗', 'success');
    } catch (e) {
        console.error('Valet pickup request failed:', e);
        if (window.showToast) window.showToast('Request failed 🙏', 'error');
    }
}

// ════════════════════════════════════════════════
// 💌 FEEDBACK SUBMISSION
// ════════════════════════════════════════════════

export async function submitFeedback(phone, rating, message) {
    if (!rating || rating < 1) {
        if (window.showToast) window.showToast('Please select a star rating ⭐', 'error');
        return;
    }
    try {
        await dbService.submitFeedback(phone, rating, message);
        if (window.showToast) window.showToast('Thank you for your warm wishes! 💛', 'success');
        // Reset form
        document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
        const msgEl = document.getElementById('feedback-msg');
        if (msgEl) msgEl.value = '';
    } catch (e) {
        console.error('Feedback submission failed:', e);
        if (window.showToast) window.showToast('Submission failed 🙏', 'error');
    }
}

export async function voteForOutfit(voterPhone, outfitPhone) {
    try {
        await dbService.voteForOutfit(voterPhone, outfitPhone);
        if (window.showToast) window.showToast('Vote cast! ❤️', 'success');
    } catch (e) {
        console.error('Voting failed:', e);
    }
}

export function initGuestFlow(showScreen, showToast, currentUser) {
    // Start global dish sync immediately
    renderDishSelection();

    const encodedPhone = encodeURIComponent(currentUser.phoneNumber);
    dbService.supabase
        .channel(`guest-self-${currentUser.phoneNumber.replace('+', '')}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'guests',
            filter: `phone=eq.${encodedPhone}`
        }, (payload) => {
            updateGuestUI(payload.new, currentUser, showScreen);
        })
        .subscribe();

    dbService.getGuest(currentUser.phoneNumber).then(guestData => {
        updateGuestUI(guestData, currentUser, showScreen);
    });
}

export function updateGuestUI(guestData, currentUser, showScreen) {
    lastGuestData = guestData;
    if (guestData && guestData.completed) {
        showGuestDashboard(guestData, currentUser, showScreen);
    } else {
        showScreen('screen-guest-form');
        renderDishSelection();
    }
}

function startValetListener(phone) {
    if (!phone) return;
    const normalizedPhone = dbService.normalizePhone(phone);
    
    const card = document.getElementById('valet-status-card');
    const badge = document.getElementById('valet-badge');
    const info = document.getElementById('valet-car-info');
    if(!card) return;
    
    // Initial fetch
    dbService.supabase.from('valet_requests').select('*').eq('guest_phone', normalizedPhone).maybeSingle().then(({data}) => {
        if(data) {
            card.style.display = 'block';
            renderValetCard(data, badge, info);
        }
    });

    // Realtime listener
    const encodedPhone = encodeURIComponent(normalizedPhone);
    dbService.supabase.channel('guest-valet-' + normalizedPhone.replace(/[^0-9]/g, '')).on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'valet_requests', 
        filter: 'guest_phone=eq.' + encodedPhone 
    }, (p) => {
        if (p.new) {
            card.style.display = 'block';
            renderValetCard(p.new, badge, info);
        }
    }).subscribe();
}

function renderValetCard(data, badge, info) {
    info.textContent = data.car_model + ' (' + data.car_number + ')';
    const s = data.status;
    badge.textContent = s.replace('_', ' ').toUpperCase();
    if(s === 'pending') badge.className = 'status-badge bg-yellow-100 text-yellow-800';
    else if(s === 'parked') badge.className = 'status-badge bg-green-100 text-green-800';
    else if(s === 'pickup_requested') badge.className = 'status-badge bg-red-100 text-red-800';
    else badge.className = 'status-badge bg-gray-100 text-gray-800';
}
