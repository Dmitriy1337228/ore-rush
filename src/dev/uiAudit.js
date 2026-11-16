// UI Layout Audit — измеряемая проверка вёрстки (ТОЛЬКО dev-сборка).
// Подключается из main.js под `import.meta.env.DEV`: в prod-бандл не попадает.
//
// Что делает: обходит display list всех активных сцен, собирает экранные
// bounds видимых объектов (с переводом контента скролл-камер в экранные
// координаты) и применяет набор правил (см. UI_RULES). Результат — структура
// { items, violations }, пригодная и для консоли, и для JSON-репорта, и для
// размеченного скриншота (scripts/ui-check.mjs, горячие клавиши F8/F9).
//
// Правила (severity): error — ломает вёрстку, warn — нарушение дизайн-правил.
//   OVERLAP        error  объекты пересекаются, но не вложены друг в друга
//   OVERFLOW       error  текст/элемент вылезает за свой фон (карточка, кнопка, панель)
//   TEXT-COVERED   error  текст лежит ПОД своим фоном (порядок отрисовки)
//   OFFSCREEN      error  текст/кнопка вне канваса
//   MIN-FONT       error/warn  кегль на экране меньше порога (в CSS-пикселях)
//   ROW-NAME       error  имя ряда улучшений шире своего лимита
//   PADDING        warn   текст ближе порога к краю своего фона
//   TOUCH-TARGET   warn   интерактивный объект меньше минимального размера нажатия
//   BUTTON-GAP     warn   кнопки почти касаются (зазор 0..minButtonGap)
//   MISALIGNED     warn   одинаковые кнопки в ряду/колонке сдвинуты на 1..alignTolerance px
//   EDGE           warn   текст/кнопка прижаты к краю канваса
//
// СЛЕПЫЕ ЗОНЫ (честно): Graphics/ParticleEmitter не измеряются; glyph-бокс текста
// приближён (бокс минус 3px); 9-slice-фаска входит в bbox фона — PADDING меряется
// от bbox, а не от «внутренней» области; прозрачные пиксели иконок считаются
// частью bbox.

import { gameState } from '../state.js';
import { MIN } from '../ui/shared/theme.js';

export const UI_RULES = {
    overlapTolerance: 1, // px игровой сетки
    minPadding: MIN.padding, // отступ текста от края своего фона (px игровой сетки)
    hostMinShare: 0.6, // доля элемента внутри фона, чтобы считать фон «его»
    minFontCss: MIN.fontCss, // кегль на экране, CSS px
    minTouchCss: MIN.touchCss, // зона нажатия, CSS px (мобильный/десктоп)
    mobileMaxWidthCss: 820,
    minButtonGap: 4, // px игровой сетки
    minButtonSize: 24, // меньше — не считаем кнопкой для GAP/ALIGN (иконки-индикаторы)
    alignTolerance: 4, // px игровой сетки
    edgeMargin: 4, // px игровой сетки
    overlayDepth: 38, // слои >= этого (обучение, окна, уведомления): перекрывают нижние слои штатно
    fullscreenShare: 0.9, // объект >= 90% канваса по обеим осям — затемнение/подложка
    textGlyphTrim: 3 // бокс Text выше/ниже глифов на ~3px
};

const HOST_TEX_RE = /(button|panel|card|frame|bar_background|board|inset)/i;
const SKIP_TYPES = new Set(['ParticleEmitter', 'Graphics', 'Zone']);

// Объект сейчас анимируется твином (всплывающие подписи, дыхание блока) — положение транзитно
function isTweening(go) {
    try {
        return !!(go.scene && go.scene.tweens && go.scene.tweens.getTweensOf(go).length);
    } catch (e) {
        return false;
    }
}
const IMAGE_TYPES = new Set(['Image', 'Sprite', 'NineSlice']);

// ---------- Сбор объектов ----------

function transformScale(go) {
    try {
        const m = go.getWorldTransformMatrix();

        return Math.abs(m.scaleY) || 1;
    } catch (e) {
        return Math.abs(go.scaleY) || 1;
    }
}

function normalizeLabelText(text) {
    return String(text || '')
        .replace(/\d+([.,]\d+)?/g, '#')
        .slice(0, 26);
}

// Мировой размер кастомной hit-зоны по оси ('x'|'y'): hitArea живёт в локальных
// единицах объекта (у displaySize-картинок — единицы кадра), мировые px =
// hitArea × свой масштаб × масштабы родительских контейнеров. null — кастомной
// зоны нет (эффективная зона = видимые границы, берётся из bounds).
function hitSize(go, axis) {
    try {
        const input = go.input;
        if (!input || !input.enabled || !input.customHitArea) {
            return null;
        }

        const ha = input.hitArea;
        if (!ha || typeof ha.width !== 'number') {
            return null;
        }

        let scale = Math.abs(axis === 'x' ? go.scaleX || 1 : go.scaleY || 1);
        let p = go.parentContainer;
        while (p) {
            scale *= Math.abs(axis === 'x' ? p.scaleX || 1 : p.scaleY || 1);
            p = p.parentContainer;
        }

        return (axis === 'x' ? ha.width : ha.height) * scale;
    } catch (e) {
        return null;
    }
}

// Минимальная сторона кастомной hit-зоны ближайшего родителя-контейнера
// (масштабы цепочки учтены). null — такой зоны нет.
function ancestorHitSize(go) {
    try {
        let p = go.parentContainer;
        while (p) {
            const pa = p.input;
            if (pa && pa.enabled && pa.customHitArea && pa.hitArea && typeof pa.hitArea.width === 'number') {
                // мировые px: локальная зона × масштаб p × масштабы выше по цепочке
                let wx = Math.abs(p.scaleX || 1);
                let wy = Math.abs(p.scaleY || 1);
                let q = p.parentContainer;
                while (q) {
                    wx *= Math.abs(q.scaleX || 1);
                    wy *= Math.abs(q.scaleY || 1);
                    q = q.parentContainer;
                }

                return Math.min(pa.hitArea.width * wx, pa.hitArea.height * wy);
            }

            p = p.parentContainer;
        }

        return null;
    } catch (e) {
        return null;
    }
}

export function collectItems(game, cssScale = 1) {
    const W = game.scale.gameSize.width;
    const H = game.scale.gameSize.height;
    const ui = game.scene.getScene('UIScene');
    const items = [];
    const layers = ui
        ? [
              { name: 'list', root: ui.listContent, cam: ui.listCam, active: () => true },
              { name: 'map', root: ui.mapContent, cam: ui.mapCam, active: () => ui._mapOpen }
              // Мастерская — DOM-слой (src/dom), её вёрстку проверяет ui:check:dom
          ]
        : [];

    game.scene.getScenes(true).forEach((scene, sceneIdx) => {
        const sceneKey = scene.scene.key;
        // order: [сцена, слой(0 main / 1 скролл-камера), depth корня, индекс корня, индексы вложенности...]
        const visit = (go, parentAlpha, layer, order, rootDepth) => {
            if (go.visible === false) {
                return;
            }

            const alpha = parentAlpha * (go.alpha === undefined ? 1 : go.alpha);
            let curLayer = layer;
            if (sceneKey === 'UIScene') {
                const found = layers.find((l) => l.root === go);
                if (found) {
                    curLayer = found;
                }
            }

            if (go.list) {
                go.list.forEach((child, i) => visit(child, alpha, curLayer, order.concat(i), rootDepth));

                return;
            }

            // Rectangle: реальная плотность заливки = alpha * fillAlpha (невидимые hit-зоны не считаются)
            const opacity = go.type === 'Rectangle' ? alpha * (go.fillAlpha === undefined ? 1 : go.fillAlpha) : alpha;
            if (SKIP_TYPES.has(go.type) || opacity < 0.05) {
                return;
            }

            // транзитные объекты: подписи/частицы-подобные в GameScene и любые анимируемые тексты
            if ((go.type === 'Text' || sceneKey === 'GameScene') && isTweening(go)) {
                return;
            }

            let b;
            try {
                b = go.getBounds();
            } catch (e) {
                return;
            }
            if (!b || (b.width <= 1 && b.height <= 1)) {
                return;
            }

            let x = b.x,
                y = b.y,
                r = b.right,
                bt = b.bottom;
            if (curLayer) {
                // Контент скролл-камеры (ряды, карта, мастерская): в экранные координаты
                // и только то, что попадает в видимую полосу камеры
                if (!curLayer.active() || !curLayer.cam) {
                    return;
                }

                const cam = curLayer.cam;
                x = x - cam.scrollX + cam.x;
                r = r - cam.scrollX + cam.x;
                y = y - cam.scrollY + cam.y;
                bt = bt - cam.scrollY + cam.y;
                if (bt < cam.y - 2 || y > cam.y + cam.height + 2 || r < cam.x - 2 || x > cam.x + cam.width + 2) {
                    return;
                }
            }

            const isText = go.type === 'Text';
            if (isText) {
                y += UI_RULES.textGlyphTrim;
                bt -= UI_RULES.textGlyphTrim;
            }

            const w = r - x,
                h = bt - y;
            const tex = (go.texture && go.texture.key) || '';
            const fullscreen = w >= W * UI_RULES.fullscreenShare && h >= H * UI_RULES.fullscreenShare;
            const fontPx = isText ? parseFloat(go.style && go.style.fontSize) || 0 : 0;
            const isHost =
                !fullscreen &&
                (go.type === 'NineSlice' ||
                    (IMAGE_TYPES.has(go.type) && HOST_TEX_RE.test(tex)) ||
                    (go.type === 'Rectangle' && w >= 16 && h >= 12));
            items.push({
                id: items.length,
                scene: sceneKey,
                layer: curLayer ? curLayer.name : 'main',
                kind: go.type,
                text: isText ? String(go.text || '') : '',
                tex,
                label: isText ? `"${normalizeLabelText(go.text)}"` : tex ? `[${tex}]` : go.type,
                x,
                y,
                r,
                b: bt,
                w,
                h,
                interactive: !!(go.input && go.input.enabled),
                // Фактическая hit-зона (правило «размер нажатия»): кастомный
                // hitArea в локальных единицах объекта (для displaySize-картинок —
                // единицы кадра, HIT.*), мировые px = hitArea × свой масштаб ×
                // цепочка масштабов родительских контейнеров. Без кастомного
                // hitArea зона = видимые границы (bounds).
                hitW: hitSize(go, 'x'),
                hitH: hitSize(go, 'y'),
                // Хит-зона ближайшего родителя-контейнера с кастомным hitArea
                // (>= порога): эргономику маленькой кнопки обеспечивает ряд
                // (хит-колонка с диспетчем по Y) — см. TOUCH-TARGET
                ancestorHitMin: ancestorHitSize(go),
                alpha: opacity,
                order: [order[0], curLayer ? 1 : 0].concat(order.slice(1)),
                rootDepth,
                fullscreen,
                host: isHost,
                fontPx,
                fontCss: fontPx * (isText ? transformScale(go) : 1) * cssScale
            });
        };
        scene.children.list.forEach((go, idx) => visit(go, 1, null, [sceneIdx, go.depth || 0, idx], go.depth || 0));
    });

    return { items, W, H, ui };
}

// порядок отрисовки: меньше = рисуется раньше (ниже)
function compareOrder(a, b) {
    const n = Math.min(a.order.length, b.order.length);
    for (let i = 0; i < n; i++) {
        if (a.order[i] !== b.order[i]) {
            return a.order[i] - b.order[i];
        }
    }

    return a.order.length - b.order.length;
}

// ---------- Геометрия ----------

const area = (i) => Math.max(0, i.w) * Math.max(0, i.h);
function intersectionArea(a, b) {
    const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
    const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);

    return ox > 0 && oy > 0 ? ox * oy : 0;
}
const share = (inner, outer) => (area(inner) > 0 ? intersectionArea(inner, outer) / area(inner) : 0);
const centerInside = (inner, outer) => {
    const cx = (inner.x + inner.r) / 2,
        cy = (inner.y + inner.b) / 2;

    return cx >= outer.x && cx <= outer.r && cy >= outer.y && cy <= outer.b;
};
const isContained = (a, b, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.r <= b.r + tol && a.b <= b.b + tol;
const box = (i, role) => ({ x: i.x, y: i.y, w: i.w, h: i.h, role: role || '' });
const round = (n) => Math.round(n);

function sameLayer(a, b) {
    return a.scene === b.scene && a.layer === b.layer;
}

// ---------- Правила ----------

export function auditItems({ items, W, H, ui }, cssScale) {
    const R = UI_RULES;
    const violations = [];
    const add = (rule, severity, scene, msg, boxes, sigParts) => {
        violations.push({ rule, severity, scene, msg, boxes, sig: [rule, scene, ...sigParts].join('|') });
    };
    const mobile = W * cssScale <= R.mobileMaxWidthCss;
    const overlayVsBelow = (a, b) => a.rootDepth >= R.overlayDepth !== b.rootDepth >= R.overlayDepth;

    // OVERLAP: пересечение без вложенности (Rectangle — подложки/затемнения — не участвуют)
    for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (a.kind === 'Rectangle') {
            continue;
        }

        for (let j = i + 1; j < items.length; j++) {
            const b = items[j];
            if (b.kind === 'Rectangle' || !sameLayer(a, b)) {
                continue;
            }

            if (isContained(a, b) || isContained(b, a)) {
                continue;
            }

            if (overlayVsBelow(a, b)) {
                continue;
            }

            const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
            const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
            if (ox > R.overlapTolerance && oy > R.overlapTolerance) {
                add(
                    'OVERLAP',
                    'error',
                    a.scene,
                    `${a.label} (${round(a.x)},${round(a.y)}) x ${b.label} (${round(b.x)},${round(b.y)}) ox=${round(ox)} oy=${round(oy)}`,
                    [box(a, a.label), box(b, b.label)],
                    [a.label, b.label].sort()
                );
            }
        }
    }

    // Фон (host) каждого элемента: наименьший фон, ниже элемента по порядку отрисовки, в котором элемент лежит
    const hosts = items.filter((i) => i.host);
    const hostOf = (it) => {
        let best = null;
        for (const h of hosts) {
            if (h === it || !sameLayer(it, h)) {
                continue;
            }

            if (area(h) < area(it)) {
                continue;
            }

            if (!centerInside(it, h)) {
                continue;
            }

            if (share(it, h) < R.hostMinShare) {
                continue;
            }

            if (compareOrder(h, it) > 0) {
                continue;
            } // фон выше — отдельное правило TEXT-COVERED

            if (overlayVsBelow(it, h)) {
                continue;
            } // фон из другого слоя (например, шапка под окном)

            // Фоном считается ближайший снизу в порядке отрисовки: кнопка на панели -> кнопка
            if (!best || compareOrder(h, best) > 0) {
                best = h;
            }
        }

        return best;
    };

    for (const it of items) {
        if (it.host || it.fullscreen) {
            continue;
        }

        const isText = it.kind === 'Text' && it.text.trim() !== '';
        const isElement = it.interactive || IMAGE_TYPES.has(it.kind);
        if (!isText && !isElement) {
            continue;
        }

        const host = hostOf(it);
        if (host) {
            const overflow = Math.max(host.x - it.x, it.r - host.r, host.y - it.y, it.b - host.b);
            if (overflow > R.overlapTolerance) {
                add(
                    'OVERFLOW',
                    'error',
                    it.scene,
                    `${it.label} вылезает за ${host.label} на ${round(overflow)}px`,
                    [box(it, it.label), box(host, host.label)],
                    [it.label, host.label]
                );
            } else if (isText) {
                const pad = Math.min(it.x - host.x, host.r - it.r, it.y - host.y, host.b - it.b);
                const need = host.interactive ? R.minPadding.button : R.minPadding.panel;
                if (pad < need) {
                    add(
                        'PADDING',
                        'warn',
                        it.scene,
                        `${it.label}: отступ ${round(pad)}px до края ${host.label} (нужно >= ${need})`,
                        [box(it, it.label), box(host, host.label)],
                        [it.label, host.label]
                    );
                }
            }
        }
    }

    // TEXT-COVERED: фон, содержащий текст, отрисован ПОЗЖЕ текста
    for (const t of items) {
        if (t.kind !== 'Text' || !t.text.trim()) {
            continue;
        }

        for (const h of items) {
            if (h === t || h.kind === 'Text' || h.fullscreen || !sameLayer(t, h)) {
                continue;
            }

            if (!(IMAGE_TYPES.has(h.kind) || h.kind === 'Rectangle')) {
                continue;
            }

            if (h.alpha < 0.5 || area(h) < area(t)) {
                continue;
            }

            if (share(t, h) < 0.8) {
                continue;
            }

            if (compareOrder(h, t) <= 0) {
                continue;
            }

            if (overlayVsBelow(t, h)) {
                continue;
            }

            add(
                'TEXT-COVERED',
                'error',
                t.scene,
                `${t.label} закрыт сверху ${h.label} (порядок отрисовки)`,
                [box(t, t.label), box(h, h.label)],
                [t.label, h.label]
            );
        }
    }

    const interactiveItems = items.filter((i) => i.interactive && !i.fullscreen);
    for (const it of items) {
        const isText = it.kind === 'Text' && it.text.trim() !== '';
        const isTarget = isText || it.interactive;
        if (it.fullscreen) {
            continue;
        }

        if (isText) {
            if (it.fontCss > 0 && it.fontCss < R.minFontCss.warn) {
                const severity = it.fontCss < R.minFontCss.error ? 'error' : 'warn';
                add(
                    'MIN-FONT',
                    severity,
                    it.scene,
                    `${it.label}: кегль ${it.fontPx}px => ${it.fontCss.toFixed(1)}px на экране (порог ${severity === 'error' ? R.minFontCss.error : R.minFontCss.warn})`,
                    [box(it, it.label)],
                    [it.label]
                );
            }
        }

        if (isTarget && it.layer === 'main') {
            const out = Math.max(-it.x, it.r - W, -it.y, it.b - H);
            if (out > R.overlapTolerance) {
                add(
                    'OFFSCREEN',
                    'error',
                    it.scene,
                    `${it.label} выходит за канвас на ${round(out)}px`,
                    [box(it, it.label)],
                    [it.label]
                );
            } else if (it.scene === 'UIScene') {
                const edge = Math.min(it.x, W - it.r, it.y, H - it.b);
                if (edge < R.edgeMargin) {
                    add(
                        'EDGE',
                        'warn',
                        it.scene,
                        `${it.label} в ${round(edge)}px от края канваса (нужно >= ${R.edgeMargin})`,
                        [box(it, it.label)],
                        [it.label]
                    );
                }
            }
        }

        if (it.interactive && it.kind !== 'Text') {
            // «Размер нажатия»: кастомная hit-зона, если задана, иначе видимые
            // границы (bounds — прокси для setInteractive() без аргументов)
            const hitW = it.hitW ?? it.w;
            const hitH = it.hitH ?? it.h;
            const effMin = Math.min(hitW, hitH) * cssScale;
            const need = mobile ? R.minTouchCss.mobile : R.minTouchCss.desktop;
            // Кнопка, целиком вложенная в более крупную интерактивную зону
            // (ряд с хит-колонкой >= порога), эргономику нажатия получает от
            // неё — сама по себе маленькая кнопка нарушением не является
            const covered = interactiveItems.some(
                (o) =>
                    o !== it &&
                    o.scene === it.scene &&
                    o.layer === it.layer &&
                    !o.fullscreen &&
                    Math.min(o.hitW ?? o.w, o.hitH ?? o.h) * cssScale >= need &&
                    o.x - 1 <= it.x &&
                    o.y - 1 <= it.y &&
                    o.r + 1 >= it.r &&
                    o.b + 1 >= it.b
            );
            const ancestorCovered = (it.ancestorHitMin ?? 0) * cssScale >= need;
            if (effMin < need && !covered && !ancestorCovered) {
                add(
                    'TOUCH-TARGET',
                    'warn',
                    it.scene,
                    `${it.label}: зона нажатия ${round(hitW * cssScale)}x${round(hitH * cssScale)} CSS px (min ${need})`,
                    [box(it, it.label)],
                    [it.label]
                );
            }
        }
    }

    // BUTTON-GAP / MISALIGNED: интерактивные «кнопки» (изображения)
    const buttons = items.filter(
        (i) =>
            i.interactive &&
            IMAGE_TYPES.has(i.kind) &&
            !i.fullscreen &&
            i.w >= R.minButtonSize &&
            i.h >= R.minButtonSize
    );
    for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
            const a = buttons[i],
                b = buttons[j];
            if (!sameLayer(a, b) || isContained(a, b) || isContained(b, a) || overlayVsBelow(a, b)) {
                continue;
            }

            const gapX = Math.max(a.x, b.x) - Math.min(a.r, b.r);
            const gapY = Math.max(a.y, b.y) - Math.min(a.b, b.b);
            const overlapY = Math.min(a.b, b.b) - Math.max(a.y, b.y);
            const overlapX = Math.min(a.r, b.r) - Math.max(a.x, b.x);
            const minH = Math.min(a.h, b.h),
                minW = Math.min(a.w, b.w);
            const sameRow = overlapY >= minH * 0.5 && gapX > 0;
            const sameCol = overlapX >= minW * 0.5 && gapY > 0;
            if (sameRow && gapX < R.minButtonGap) {
                add(
                    'BUTTON-GAP',
                    'warn',
                    a.scene,
                    `${a.label} и ${b.label}: зазор ${round(gapX)}px по горизонтали (нужно >= ${R.minButtonGap})`,
                    [box(a, a.label), box(b, b.label)],
                    [a.label, b.label].sort()
                );
            } else if (sameCol && gapY < R.minButtonGap) {
                add(
                    'BUTTON-GAP',
                    'warn',
                    a.scene,
                    `${a.label} и ${b.label}: зазор ${round(gapY)}px по вертикали (нужно >= ${R.minButtonGap})`,
                    [box(a, a.label), box(b, b.label)],
                    [a.label, b.label].sort()
                );
            }

            const sameSize = Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
            if (sameSize) {
                const dy = Math.abs((a.y + a.b) / 2 - (b.y + b.b) / 2);
                const dx = Math.abs((a.x + a.r) / 2 - (b.x + b.r) / 2);
                if (sameRow && dy > 0.5 && dy <= R.alignTolerance) {
                    add(
                        'MISALIGNED',
                        'warn',
                        a.scene,
                        `${a.label} и ${b.label}: в ряду сдвиг по вертикали ${dy.toFixed(1)}px`,
                        [box(a, a.label), box(b, b.label)],
                        [a.label, b.label].sort()
                    );
                } else if (sameCol && dx > 0.5 && dx <= R.alignTolerance) {
                    add(
                        'MISALIGNED',
                        'warn',
                        a.scene,
                        `${a.label} и ${b.label}: в колонке сдвиг по горизонтали ${dx.toFixed(1)}px`,
                        [box(a, a.label), box(b, b.label)],
                        [a.label, b.label].sort()
                    );
                }
            }
        }
    }

    // ROW-NAME: имя ряда улучшений не шире своего лимита (независимо от видимости ряда)
    if (ui && ui.rows) {
        for (const row of ui.rows) {
            if (!row.nameText || !row.nameText.width) {
                continue;
            }

            if (row.nameText.width > row.nameMaxW + 1) {
                add(
                    'ROW-NAME',
                    'error',
                    'UIScene',
                    `имя ряда "${row.nameText.text}" шире лимита: ${round(row.nameText.width)} > ${row.nameMaxW}`,
                    [],
                    [normalizeLabelText(row.nameText.text)]
                );
            }
        }
    }

    return violations;
}

// ---------- Публичный API ----------

// cssScale — CSS-пикселей на один пиксель игровой сетки (FIT-масштаб)
export function getCssScale(game) {
    const rect = game.canvas.getBoundingClientRect();

    return rect.width / game.scale.gameSize.width;
}

export function auditUi(game) {
    const cssScale = getCssScale(game);
    const data = collectItems(game, cssScale);
    const violations = auditItems(data, cssScale);

    return {
        cssScale,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        game: { w: data.W, h: data.H, portrait: data.H > data.W },
        counts: {
            items: data.items.length,
            error: violations.filter((v) => v.severity === 'error').length,
            warn: violations.filter((v) => v.severity === 'warn').length
        },
        violations,
        items: data.items.map((i) => ({
            id: i.id,
            scene: i.scene,
            layer: i.layer,
            kind: i.kind,
            label: i.label,
            text: i.text.slice(0, 40),
            x: round(i.x),
            y: round(i.y),
            w: round(i.w),
            h: round(i.h),
            interactive: i.interactive,
            font: i.fontPx || undefined
        }))
    };
}

// ---------- Наложение на страницу (DOM) ----------

const OVERLAY_ID = '__ui-audit-overlay';
const COLORS = { error: '#ff2d2d', warn: '#ff9f1a' };

export function hideOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) {
        el.remove();
    }
}

// Рисует рамки нарушений поверх канваса; номер = индекс в списке violations.
// known: Set индексов «известного долга» (рисуются приглушённо).
export function showOverlay(game, violations, known = new Set()) {
    hideOverlay();
    const rect = game.canvas.getBoundingClientRect();
    const k = rect.width / game.scale.gameSize.width;
    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.style.cssText =
        'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;font:bold 11px monospace';
    violations.forEach((v, idx) => {
        const color = COLORS[v.severity];
        const dim = known.has(idx);
        v.boxes.forEach((b, bi) => {
            const d = document.createElement('div');
            d.style.cssText =
                `position:absolute;left:${rect.left + b.x * k}px;top:${rect.top + b.y * k}px;` +
                `width:${Math.max(2, b.w * k)}px;height:${Math.max(2, b.h * k)}px;box-sizing:border-box;` +
                `border:${bi === 0 ? 2 : 1}px ${bi === 0 ? 'solid' : 'dashed'} ${color};opacity:${dim ? 0.55 : 1};` +
                (bi === 0 ? `background:${color}22;` : '');
            root.appendChild(d);
            if (bi === 0) {
                const n = document.createElement('div');
                n.textContent = String(idx + 1);
                n.style.cssText =
                    `position:absolute;left:${rect.left + b.x * k - 1}px;top:${rect.top + b.y * k - 13}px;` +
                    `background:${color};color:#fff;padding:0 3px;line-height:13px;opacity:${dim ? 0.7 : 1}`;
                root.appendChild(n);
            }
        });
    });
    document.body.appendChild(root);
}

// ---------- Репорт для разработчика/агента ----------

function openScreens(game) {
    const ui = game.scene.getScene('UIScene');
    const gs = game.scene.getScene('GameScene');
    const open = [];
    if (!ui) {
        return open;
    }

    if (ui._mapOpen) {
        open.push('map');
    }

    if (ui._craftOpen) {
        open.push('craft');
    }

    if (ui.modal && ui.modal.visible) {
        open.push('settings');
    }

    if (ui._offlineOpen) {
        open.push('offline');
    }

    if (ui._dailyOpen) {
        open.push('daily');
    }

    if (ui._bossRewardOpen) {
        open.push('bossReward');
    }

    if (ui._playerDownOpen) {
        open.push('playerDown');
    }

    if (gs && gs.boss) {
        open.push(`boss:${gs.boss.def.id}`);
    }

    return open;
}

export function buildReport(game) {
    const audit = auditUi(game);
    const ui = game.scene.getScene('UIScene');

    return {
        kind: 'ui-report',
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        ...audit,
        screens: openScreens(game),
        listScroll: ui && ui.listCam ? ui.listCam.scrollY : 0,
        // состояние для воспроизведения: `npm run ui:check -- --replay <файл>.json`
        gameState: JSON.parse(JSON.stringify(gameState))
    };
}

function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 1000);
}

// Скачивает PNG канваса с нарисованными нарушениями + JSON-репорт
export function downloadReport(game) {
    const report = buildReport(game);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    download(`ui-report-${stamp}.json`, new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    game.renderer.snapshot((img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const k = img.width / game.scale.gameSize.width;
        ctx.font = `bold ${Math.round(11 * k)}px monospace`;
        report.violations.forEach((v, idx) => {
            ctx.strokeStyle = ctx.fillStyle = COLORS[v.severity];
            v.boxes.forEach((b, bi) => {
                ctx.lineWidth = bi === 0 ? 2 * k : k;
                ctx.setLineDash(bi === 0 ? [] : [4 * k, 3 * k]);
                ctx.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
                if (bi === 0) {
                    ctx.fillText(String(idx + 1), b.x * k, Math.max(10 * k, b.y * k - 3 * k));
                }
            });
        });
        c.toBlob((blob) => download(`ui-report-${stamp}.png`, blob), 'image/png');
    });
    console.info(`[ui-audit] репорт: ошибок ${report.counts.error}, предупреждений ${report.counts.warn}`);

    return report;
}

// F8 — живое наложение нарушений (обновляется раз в 500 мс), F9 — скачать репорт (PNG+JSON)
export function installUiAuditTools(game) {
    window.__uiAudit = (g = game) => auditUi(g);
    window.__uiReport = () => buildReport(game); // JSON для ui:check --replay
    window.__uiOverlay = { show: (g, v, k) => showOverlay(g || game, v, k), hide: hideOverlay };
    let timer = null;
    const tick = () => {
        const { violations } = auditUi(game);
        showOverlay(game, violations);
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F8') {
            e.preventDefault();
            if (timer) {
                clearInterval(timer);
                timer = null;
                hideOverlay();
                console.info('[ui-audit] overlay выкл');

                return;
            }

            tick();
            timer = setInterval(tick, 500);
            console.info('[ui-audit] overlay вкл (F8 — выкл, F9 — репорт)');
        } else if (e.key === 'F9') {
            e.preventDefault();
            downloadReport(game);
        }
    });
}
