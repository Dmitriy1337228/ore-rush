// Геометрия списка улучшений, карты и рядов — общие константы UIScene.

import { computeLayout, LANDSCAPE_BASE } from '../../layout.js';
// Подписи вкладок и метки пакетов — из единого модуля текстов (D4 фазы 3): копий нет.
export { TABS, BUY_AMOUNTS } from '../../state/upgradesMessages.js';

// Вьюпорт списка: по внутренней зоне деревянной панели (панель 364x582 (image):
// face source x73..964, y208..1058 -> drawn x 926..1241, y 232..674). Заголовок
// на планке (143..200), вкладки и строка тира в одной ширине со списком
// (934..1230), вертикаль: вкладки 192..224 -> тир 237..261 -> список 270..662.
// Значения НЕ дублируются: выводятся из computeLayout() (ландшафтная сетка) —
// единый источник раскладки; applyLayout перезаписывает объект при смене
// ориентации (ряды строятся шириной с вьюпорт — она одинакова в обеих сетках).
export const VIEWPORT = { ...computeLayout(LANDSCAPE_BASE.w, LANDSCAPE_BASE.h).viewport };
export const ROW_H = 96;
export const ROW_GAP = 6;
// Карта шахты «как настольная»: фон-доска map_board, вертикальная тропа из
// кружков (Graphics), соединённых пунктиром со стрелками-шевронами; тексты —
// под кружком. Прокрутка камерой mapCam по внутренней зоне панели. Контент:
// отступ сверху 90, узлы шагом 132 (кружок r28/34 + подписи снизу; шаг держит
// зазор тропы «низ подписи + 4s + 6 <= верх следующего кружка − 9s» для ВСЕХ
// пар, включая босс → следующий тир, где подписи глубже), запас снизу 60.
export const MAP_NODE_H = 132;
export const MAP_HEAD = 90;
export const MAP_TAIL = 60;
export const MAP_R_TIER = 28;
export const MAP_R_BOSS = 34;

// Отступы ряда (карточка 296x96: face source x44..817, y16..202 -> drawn x16..290, y7..89)
export const ROW = {
    iconY: 50, // центр встроенной ниши карточки по Y (source y44..181 -> drawn 19.4..79.7)
    descSize: 11, // 11px: вместимость ~12+ символов на строку при вариативности метрик шрифта
    btnW: 84,
    btnH: 40,
    // Вертикальный стек ряда (y от верха карточки, зазоры заданы явно):
    // имя 8..25 (ужимается 15->10px под ширину) -> описание 30..58 ->
    // цена 68..84 (слева) + «ур. N» 68..84 (справа, под кнопкой). Кнопка 28..68.
    // face карточки 7..89: всё содержимое внутри с запасом >= 4px.
    nameY: 8,
    descY: 30,
    priceY: 76,
    btnY: 28
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Геометрия ряда по ориентации (единый источник для Phaser-ряда и DOM-ряда).
// s — портретный масштаб кеглей (UIScene._adaptiveScale: 720 / ширина canvas на экране,
// 1..1.8). В портрете карточки шире (624): кегли и кнопка крупнее (FIT-даунскейл ~0.52
// на телефонах), ряд выше под 2 строки. Ландшафтные значения = ROW (296x96) 1:1.
// Смещения цены от textX: центр монетки и начало текста (buildRow: textX + 6 / textX + 16)
export const PRICE_ICON_DX = 6;
export const PRICE_TEXT_DX = 16;

export function computeRowGeom(portrait, s = 1) {
    if (portrait) {
        // Спека редизайна мобильной панели: ряд 132 (тач-таргет «Купить» 148x88),
        // «ур. N» — в строке имени наверху, цена под описанием. Кегли по s с клампами.
        const nameSize = Math.round(18 * Math.min(s, 1.5));
        // Минимум 18: «Квантовая лаборатория» при 20px (13*1.5) давала 280px против
        // nameMaxW 277 — Monocraft advance ~0.667em (аудит NAME-TOO-LONG)
        const nameMin = Math.round(12 * Math.min(s, 1.5));
        const nameSizes = [];
        for (let v = nameSize; v >= nameMin; v--) {
            nameSizes.push(v);
        }

        return {
            h: 132,
            iconCY: 66,
            iconSize: clamp(Math.round(48 * s), 56, 64),
            nameY: 12,
            nameSizes,
            descY: Math.max(34, Math.round(10 + nameSize * 1.2 + 3)),
            descSize: Math.round(14 * Math.min(s, 1.5)),
            priceY: 102,
            priceSize: Math.round(15 * Math.min(s, 1.3)),
            priceIconSize: Math.round(18 * Math.min(s, 1.3)),
            levelY: 14,
            levelSize: Math.round(14 * Math.min(s, 1.3)),
            rightInset: 18,
            btnY: 26,
            btnW: 148,
            btnH: 88,
            btnSize: Math.round(15 * Math.min(s, 1.33)),
            lockSize: Math.round(13 * Math.min(s, 1.3))
        };
    }

    return {
        h: ROW_H,
        iconCY: ROW.iconY,
        iconSize: 40,
        nameY: ROW.nameY,
        nameSizes: [15, 14, 13, 12, 11, 10],
        descY: ROW.descY,
        descSize: ROW.descSize,
        priceY: ROW.priceY,
        priceSize: 13,
        priceIconSize: 16,
        levelSize: 12,
        levelY: ROW.priceY,
        rightInset: 12,
        btnY: ROW.btnY,
        btnW: ROW.btnW,
        btnH: ROW.btnH,
        btnSize: 14,
        lockSize: 11
    };
}

// Производные x-позиции ряда шириной w (портрет — широкие ряды): ниша иконки и текст
// привязаны к пропорциям текстуры карточки (source 835x218, ниша x36..193 центр 118).
// Ландшафт (296) даёт ровно прежние iconX=42 / textX=100 / nameMaxW=182.
export function computeRowMetrics(w, g, portrait) {
    const f = w / 835;
    const iconCX = Math.round(118 * f);
    const textX = Math.round(186 * f) + 34;
    const btnX = w - g.rightInset - g.btnW;

    return {
        iconCX,
        textX,
        btnX,
        // В портрете имя до 27px: его низ ниже верха кнопки — ограничение левой кромкой кнопки
        nameMaxW: portrait ? btnX - textX - 8 : w - textX - 14,
        descWrap: btnX - textX - 4
    };
}
