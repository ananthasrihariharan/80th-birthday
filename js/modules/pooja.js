export function initPoojaGallery(showScreen) {
    showScreen('screen-pooja');
    renderPoojaCards();
}

function renderPoojaCards() {
    const container = document.getElementById('pooja-gallery-container');
    if (!container) return;

    // List of pooja photos from the JKS series
    const photos = [
        'JKS_1071.JPG', 'JKS_1075.JPG', 'JKS_1076.JPG', 'JKS_1084.JPG',
        'JKS_1086.JPG', 'JKS_1087.JPG', 'JKS_1088.JPG', 'JKS_1103.JPG',
        'JKS_1104.JPG', 'JKS_1127.JPG', 'JKS_1133.JPG', 'JKS_1147.JPG',
        'JKS_1150.JPG', 'JKS_1194.JPG', 'JKS_1200.JPG', 'JKS_1201.JPG'
    ];

    container.innerHTML = photos.map((img, index) => `
        <div class="pooja-card stagger-in animate" style="animation-delay: ${index * 0.1}s">
            <div class="pooja-frame">
                <img src="${img}" alt="Temple Pooja" loading="lazy">
            </div>
            <div class="pooja-label">
                <span class="text-[10px] uppercase tracking-widest text-gold font-bold">Sacred Moment</span>
            </div>
        </div>
    `).join('');
}
