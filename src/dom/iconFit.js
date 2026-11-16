// Центровка иконок по контенту (пилот DOM, этап 1, шаг 1.5).
// Пиксель-арт PNG имеет прозрачные поля и смещённый рисунок (у item_bomb контент
// занимает x=6..64 из 64): при object-fit: contain арт «уезжает» из слота.
// Phaser решает это measureIcon (src/ui/iconMetrics.js): берёт КРУПНЕЙШУЮ связную
// компоненту alpha-маски (отсекая отдельные искры/мусор), нормирует её к размеру
// слота и центрует по её bbox. Здесь тот же алгоритм в CSS-координатах.
// Внутри .dom-slot/.dom-chip/.dom-pair img абсолютный: см. .dom-icon в dom.css.

const ALPHA_VISIBLE = 20; // как в src/ui/iconMetrics.js

function contentBox(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    const seen = new Uint8Array(w * h);
    let best = null;
    for (let sy = 0; sy < h; sy++) {
        for (let sx = 0; sx < w; sx++) {
            const start = sy * w + sx;
            if (seen[start] || data[start * 4 + 3] <= ALPHA_VISIBLE) continue;
            // 4-связная компонента; через границу строки не переходим
            const queue = [start];
            seen[start] = 1;
            let count = 0,
                minX = sx,
                maxX = sx,
                minY = sy,
                maxY = sy;
            while (queue.length) {
                const cur = queue.pop();
                const x = cur % w;
                const y = (cur - x) / w;
                count++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                for (const n of [cur - 1, cur + 1, cur - w, cur + w]) {
                    if (n < 0 || n >= w * h || seen[n]) continue;
                    if (Math.abs((n % w) - x) > 1) continue;
                    if (data[n * 4 + 3] <= ALPHA_VISIBLE) continue;
                    seen[n] = 1;
                    queue.push(n);
                }
            }
            if (!best || count > best.count) best = { count, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        }
    }
    return best;
}

function fitOne(img) {
    if (img.dataset.fit === '1') return; // idempotent: повторный рендер не переобмеряет
    const box = img.parentElement;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    if (!bw || !bh) return;
    const content = contentBox(img);
    if (!content) return;
    const scale = Math.min(bw / content.w, bh / content.h);
    img.style.width = `${img.naturalWidth * scale}px`;
    img.style.height = `${img.naturalHeight * scale}px`;
    img.style.left = `${(bw - content.w * scale) / 2 - content.x * scale}px`;
    img.style.top = `${(bh - content.h * scale) / 2 - content.y * scale}px`;
    img.dataset.fit = '1';
}

// Вызывать после вставки разметки: дожидается загрузки каждого img.
export function fitIcons(root) {
    for (const img of root.querySelectorAll('.dom-icon img')) {
        if (img.complete && img.naturalWidth) fitOne(img);
        else img.addEventListener('load', () => fitOne(img), { once: true });
    }
}
