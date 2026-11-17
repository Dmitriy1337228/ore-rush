// Метрики иконок: единый визуальный размер и центровка по КОНТЕНТУ.
// Сканируем alpha-маску и берём КРУПНЕЙШУЮ СВЯЗНУЮ КОМПОНЕНТУ: отсечённый мусор
// генерации (у pickaxe_diamond светлая полоса x0..6/y53..109) уходит через
// setCrop, контент нормируется к ICON_NORMALIZED_SIZE и центрируется в слоте.

const ICON_NORMALIZED_SIZE = 40; // базовый размер контента иконки, px
const ALPHA_VISIBLE = 20; // пиксели с alpha <= порога считаются прозрачными

// Ручная обрезка генеративного мусора по краям текстур. У pickaxe_diamond/
// pickaxe_iron мусор листа (куски соседних спрайтов, связанные с телом по
// альфе) СТЁР ИЗ САМИХ PNG 2026-11-13 (art-src/*_before_edgefix.png — бэкапы),
// тримы больше не нужны — записей нет. Механизм остаётся для будущих текстур.
// Формат записи: { [textureKey]: { left: px } }.
const ICON_TRIMS = {};

// Читает пиксели текстуры в ImageData через временный canvas
function readPixels(textures, key) {
    const src = textures.getFrame(key).source.image;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0);

    return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, W: canvas.width, H: canvas.height };
}

// Крупнейшая 4-связная компонента непрозрачных пикселей (BFS)
function largestComponent(data, W, H, trim) {
    const seen = new Uint8Array(W * H);
    let best = { count: 0, minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 };
    for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
            const idx = sy * W + sx;
            if (seen[idx] || data[idx * 4 + 3] <= ALPHA_VISIBLE) {
                continue;
            }

            if (trim.left !== undefined && sx < trim.left) {
                seen[idx] = 1;
                continue;
            }

            // BFS по прозрачности: собираем связную компоненту
            const queue = [idx];
            seen[idx] = 1;
            let count = 0,
                minX = sx,
                maxX = sx,
                minY = sy,
                maxY = sy;
            while (queue.length) {
                const cur = queue.pop();
                const cxx = cur % W,
                    cyy = (cur - cxx) / W;
                count++;
                if (cxx < minX) {
                    minX = cxx;
                }

                if (cxx > maxX) {
                    maxX = cxx;
                }

                if (cyy < minY) {
                    minY = cyy;
                }

                if (cyy > maxY) {
                    maxY = cyy;
                }

                const nb = [cur - 1, cur + 1, cur - W, cur + W];
                for (let n = 0; n < 4; n++) {
                    const nn = nb[n];
                    if (nn < 0 || nn >= W * H || seen[nn]) {
                        continue;
                    }

                    if (Math.abs((nn % W) - cxx) > 1) {
                        continue;
                    } // не через край строки

                    if (trim.left !== undefined && nn % W < trim.left) {
                        continue;
                    } // обрезка действует и при расширении

                    if (data[nn * 4 + 3] <= ALPHA_VISIBLE) {
                        continue;
                    }

                    seen[nn] = 1;
                    queue.push(nn);
                }
            }

            if (count > best.count) {
                best = { count, minX, minY, maxX, maxY };
            }
        }
    }

    return best;
}

// Метрики иконки: область обрезки контента и масштаб до нормированного размера
export function measureIcon(textures, key) {
    const trim = ICON_TRIMS[key] || {};
    const { data, W, H } = readPixels(textures, key);
    const best = largestComponent(data, W, H, trim);
    const cropW = best.maxX - best.minX + 1;
    const cropH = best.maxY - best.minY + 1;

    return {
        cropX: best.minX,
        cropY: best.minY,
        cropW,
        cropH,
        scale: ICON_NORMALIZED_SIZE / Math.max(cropW, cropH)
    };
}
