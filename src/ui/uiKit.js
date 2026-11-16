// Базовые строительные блоки UI: шрифт, 9-slice, картинки, подписи, ужин кегля.
// Общие для всех сцен (UIScene/GameScene) — один источник вместо копий.

import Phaser from 'phaser';
import manifest from '../../spritecook-assets.json';
import { LANDSCAPE_BASE } from '../layout.js';

export const FONT = '"Monocraft", "Inter", "Consolas", monospace';

// Все подписи рисуются с resolution 2 — иначе пиксельный шрифт мылится при FIT-даунскейле
const TEXT_RESOLUTION = 2;
const DEFAULT_FONT_MIN = 9; // минимальный кегль при ужине
const ONE_LINE_HEIGHT_FACTOR = 1.55; // высота строки Monocraft относительно кегля

// Размеры исходников 9-slice текстур (в манифесте их нет — держим рядом;
// при регенерации ассета с новым размером обновить эту таблицу).
const NS_SOURCE_SIZE = {
    hud_bar_background: { w: 1892, h: 225 },
    upgrades_panel_wood: { w: 1029, h: 1119 },
    modal_panel_metal: { w: 849, h: 656 },
    upgrade_row_card_1: { w: 835, h: 218 },
    icon_slot_frame: { w: 229, h: 236 },
    buy_button_normal: { w: 267, h: 133 },
    buy_button_hover: { w: 261, h: 133 },
    buy_button_pressed: { w: 262, h: 133 },
    buy_button_disabled_gray: { w: 260, h: 133 },
    settings_button_wide: { w: 410, h: 161 },
    close_button_square: { w: 196, h: 191 }
};

// Фолбэк-борды на случай отсутствия ассета в манифесте (значения не должны
// расходиться с spritecook-assets.json).
const NS_FALLBACK = {
    hud_bar_background: { l: 55, t: 55, r: 55, b: 55 },
    upgrades_panel_wood: { l: 65, t: 65, r: 65, b: 65 },
    modal_panel_metal: { l: 60, t: 60, r: 60, b: 60 },
    upgrade_row_card_1: { l: 30, t: 30, r: 30, b: 30 },
    icon_slot_frame: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_normal: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_hover: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_pressed: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_disabled_gray: { l: 40, t: 40, r: 40, b: 40 },
    settings_button_wide: { l: 45, t: 50, r: 45, b: 50 },
    close_button_square: { l: 45, t: 45, r: 45, b: 45 }
};

// 9-slice: борды — ЕДИНСТВЕННЫЙ источник = манифест spritecook-assets.json
// (ключ текстуры = имя файла без .png). Регенерация ассета с другими фасками
// подхватывается без правки кода.
const NS_SRC = { ...NS_FALLBACK };
for (const entry of manifest.assets || []) {
    if (!entry.nine_slice || !entry.file) {
        continue;
    }

    const key = entry.file
        .split('/')
        .pop()
        .replace(/\.png$/, '');
    const size = NS_SOURCE_SIZE[key];
    if (size) {
        NS_SRC[key] = {
            l: entry.nine_slice.left,
            t: entry.nine_slice.top,
            r: entry.nine_slice.right,
            b: entry.nine_slice.bottom,
            w: size.w,
            h: size.h
        };
    }
}

const NS_MIN_BORDER = 3; // борда не тоньше 3px
const NS_MIN_SCALE = 0.25; // борды ужимаются вместе с элементом, но не мельче 1/4

function nsBorders(key, w, h) {
    const s = NS_SRC[key];
    if (!s) {
        return { left: 0, top: 0, right: 0, bottom: 0 };
    }

    const f = Math.min(w / s.w, h / s.h, 1);
    const b = (v) => Math.max(NS_MIN_BORDER, Math.round(v * Math.max(f, NS_MIN_SCALE)));

    return { left: b(s.l), top: b(s.t), right: b(s.r), bottom: b(s.b) };
}

export function addNine(scene, x, y, key, w, h, depth = 0) {
    const b = nsBorders(key, w, h);
    const ns = scene.add.nineslice(x, y, key, null, w, h, b.left, b.right, b.top, b.bottom);
    ns.setOrigin(0, 0).setDepth(depth);

    return ns;
}

export function addNineC(scene, x, y, key, w, h) {
    const b = nsBorders(key, w, h);

    return scene.add.nineslice(x, y, key, null, w, h, b.left, b.right, b.top, b.bottom);
}

// Фиксированные элементы: обычный Image с setDisplaySize вместо NineSlice.
// NineSlice со «масштированными» бордами сплющивает центр текстуры (борды в Phaser
// берутся из текстуры 1:1, не масштабируются) — врезки ложатся непредсказуемо.
// Image сохраняет пропорции текстуры, врезки считаются линейным масштабом.
export function addImg(scene, x, y, key, w, h, depth = 0) {
    // x,y = левый верхний угол
    const img = scene.add.image(x + w / 2, y + h / 2, key).setDisplaySize(w, h);
    img.setOrigin(0.5).setDepth(depth);

    return img;
}

export function addImgC(scene, x, y, key, w, h) {
    // origin (0.5), координаты центра (контейнеры модалок)
    return scene.add.image(x, y, key).setDisplaySize(w, h);
}

// Карточка ряда с УНИФОРМНЫМ масштабом арта (upgrade_row_card_1 835x218 с
// «запечённым» слотом иконки). addImg растягивает арт по осям независимо: у
// высоких рядов (мобильная мастерская, 170-310px) слот иконки вытягивался в
// «пенал», а рамка утолщалась. Здесь арт масштабируется ОДНИМ коэффициентом
// k = w/835, а растягивается лишь полоса из 2px внутри плоской серой заливки:
// левая колонка (слот целиком), правая рамка и верх/низ рамки остаются
// нетронутыми — слот растёт по высоте с чёткими краями.
const ROW_CARD = {
    key: 'upgrade_row_card_1',
    left: 200, // слот иконки лежит в x 38..192 арта + запас до плоской заливки
    right: 30, // рамка справа (как врезка 9-slice из манифеста)
    flatY: 108 // строка внутри плоской заливки слота (арт 218 высотой, центр 109)
};

export function addRowCard(scene, w, h) {
    const card = scene.add.nineslice(
        0,
        0,
        ROW_CARD.key,
        null,
        1,
        1,
        ROW_CARD.left,
        ROW_CARD.right,
        ROW_CARD.flatY,
        ROW_CARD.flatY
    );
    card.setOrigin(0.5);
    fitRowCard(card, w, h);

    return card;
}

// Подгон карточки под ряд w x h: центр — в (w/2, h/2) родителя; hit-зона
// (если карточка интерактивна) — вся площадь в локальных единицах
export function fitRowCard(card, w, h) {
    const k = w / NS_SOURCE_SIZE[ROW_CARD.key].w;
    const innerH = Math.max(h / k, ROW_CARD.flatY * 2 + 2); // меньше суммы бордов 9-slice схлопывается
    card.setScale(k)
        .setSize(w / k, innerH)
        .setPosition(w / 2, h / 2);
    if (card.input) {
        applyHitArea(card, new Phaser.Geom.Rectangle(0, 0, w / k, innerH));
    }

    return card;
}

// Затемнение под модальным окном: прямоугольник базовой сетки 1280x720 по центру
// (в портрете сетка выше, но затемнение сохраняет прежнюю геометрию — кадр перекрывает
// видимую область модалок). alpha — плотность затемнения.
export const DIM_ALPHA = { screen: 0.6, alert: 0.65, tutorial: 0.45 };

export function addScreenDim(scene, alpha) {
    const { w, h } = LANDSCAPE_BASE;

    return scene.add.rectangle(w / 2, h / 2, w, h, 0x000000, alpha);
}

// Контейнер модального окна по центру базовой сетки
export function addModalContainer(scene) {
    return scene.add.container(LANDSCAPE_BASE.w / 2, LANDSCAPE_BASE.h / 2);
}

// Hit-area интерактивного объекта прямоугольником w x h в координатах кадра
// (у объектов с origin 0.5 и setDisplaySize локальные координаты ввода
// — это кадр текстуры, а не отображаемый размер). centered — прямоугольник
// вокруг (0,0) (контейнеры, центрированные объекты).
export function setHitRect(obj, w, h, centered = false) {
    const rect = centered ? new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h) : new Phaser.Geom.Rectangle(0, 0, w, h);

    return obj.setInteractive(rect, Phaser.Geom.Rectangle.Contains);
}

// Принудительная установка hit-зоны: GameObject.setInteractive на УЖЕ
// интерактивном объекте игнорирует новую зону (Phaser enable() «just enable
// it and return»), а InputPlugin.setHitArea у существующего InteractiveObject
// не перезаписывает hitArea (только флаги) — поэтому мутериуем io напрямую.
function applyHitArea(obj, rect) {
    if (obj.input) {
        obj.input.hitArea = rect;
        obj.input.hitAreaCallback = Phaser.Geom.Rectangle.Contains;
        obj.input.customHitArea = true;

        return obj;
    }

    if (obj.scene && obj.scene.input) {
        return obj.scene.input.setHitArea(obj, rect, Phaser.Geom.Rectangle.Contains);
    }

    return obj.setInteractive(rect, Phaser.Geom.Rectangle.Contains);
}

// Hit-зона w x h в МИРОВЫХ px по центру объекта — может быть больше видимых
// границ (план раздела 4: «расширить интерактивную зону без увеличения
// картинки»). Для displaySize-картинок setInteractive живёт в единицах кадра
// (HIT.* — размеры исходников): мировые px делятся на scale; у scale-1
// объектов (9-slice, контейнеры) локальные единицы = мировые.
export function setHitWorld(obj, w, h) {
    let rect;
    if (obj.type === 'Container') {
        rect = new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h);
    } else {
        const sx = Math.max(1e-6, Math.abs(obj.scaleX || 1));
        const sy = Math.max(1e-6, Math.abs(obj.scaleY || 1));
        // центр видимой области в единицах локального пространства
        const cx = (obj.displayWidth || obj.width || 0) / 2;
        const cy = (obj.displayHeight || obj.height || 0) / 2;
        rect = new Phaser.Geom.Rectangle((cx - w / 2) / sx, (cy - h / 2) / sy, w / sx, h / sy);
    }

    return applyHitArea(obj, rect);
}

// Допуск тапа до классификации как драг, в игровых px: ~9 CSS px дрожания
// пальца на любом экране (на FIT 0.5 телефона это 18 игровых px — прежний
// порог 6 (=3 CSS px) глотал половину тапов по кнопкам списков на телефоне).
// baseW — ширина игровой сетки (L.W), scale берётся из ScaleManager.
export function tapSlopPx(scene, baseW) {
    const parent = scene.scale ? scene.scale.parentSize : null;
    const fit = parent && parent.width ? Math.max(0.35, parent.width / baseW) : 1;

    return Math.max(6, Math.round(9 / fit));
}

// Hit-зона из прямоугольника (rx, ry, rw, rh) в КООРДИНАТАХ РОДИТЕЛЯ объекта
// (мировых px): для асимметричных зон — кнопка на всю высоту ряда, колонка
// кнопки в стеке. Учтены origin и displaySize (units кадра для картинок).
export function setHitWorldRect(obj, rx, ry, rw, rh) {
    const sx = Math.max(1e-6, Math.abs(obj.scaleX || 1));
    const sy = Math.max(1e-6, Math.abs(obj.scaleY || 1));
    const dx = obj.x - (obj.originX ?? 0.5) * (obj.displayWidth || 0);
    const dy = obj.y - (obj.originY ?? 0.5) * (obj.displayHeight || 0);
    const rect = new Phaser.Geom.Rectangle((rx - dx) / sx, (ry - dy) / sy, rw / sx, rh / sy);

    return applyHitArea(obj, rect);
}

export function makeLabel(scene, x, y, text, size, color, style = {}) {
    // Monocraft — пиксельный шрифт без жирных начертаний: синтетический bold его «замыливает»
    const rest = { ...style };
    delete rest.fontStyle;

    return scene.add.text(x, y, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        color,
        resolution: TEXT_RESOLUTION,
        ...rest
    });
}

// Адаптивный кегль: ставит целевой размер (уже умноженный на масштаб) и ужимает
// шагом по 1px, пока текст не впишется в maxW (прецедент ужина имён рядов).
export function fitFontSize(t, target, maxW, min = DEFAULT_FONT_MIN) {
    let size = Math.max(min, Math.round(target));
    t.setFontSize(size);
    while (size > min && t.width > maxW) {
        size -= 1;
        t.setFontSize(size);
    }

    return size;
}

// Ужимает кегль, пока текст занимает больше одной строки (перенос не допускается).
export function fitOneLine(t, target, min = DEFAULT_FONT_MIN) {
    let size = Math.max(min, Math.round(target));
    t.setFontSize(size);
    while (size > min && t.height > size * ONE_LINE_HEIGHT_FACTOR) {
        size -= 1;
        t.setFontSize(size);
    }

    return size;
}
