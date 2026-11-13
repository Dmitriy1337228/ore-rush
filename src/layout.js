// Адаптивная раскладка: две базовые сетки — ландшафт 1280x720 (историческая,
// координаты выверены итерациями вёрстки) и портрет (мобильная).
// Phaser Scale.FIT вписывает canvas в окно; ориентация окна выбирает сетку
// (main.js вызывает scale.setGameSize при смене ориентации и эмитит
// 'layout-changed' — сцены перечитывают раскладку через computeLayout).
//
// Ландшафтные значения = текущие константы UIScene/GameScene 1:1 (нулевой
// риск регрессии). Портрет: высота сетки повторяет пропорции окна
// (canvas = весь экран телефона, без серых полос), HUD на всю ширину,
// панель улучшений — «нижний лист» на всю ширину с широкими рядами,
// кнопка спуска над панелью, модалки — в свободной зоне над панелью.

export const LANDSCAPE_BASE = { w: 1280, h: 720 };
// Минимальная высота портретной сетки: блок + спуск + панель (592) не влезают ниже.
// Максимум — потолок качества фона (сильный зум мылит). 1680 покрывает 375x844
// (H=1620) без серых полос FIT, зум остается <=2.1x.
export const PORTRAIT_H_MIN = 1150;
export const PORTRAIT_H_MAX = 1680;

export function baseForOrientation(pw, ph) {
    if (ph > pw) {
        // Высота = пропорции окна: canvas заполняет экран целиком (390x844 -> 720x1558)
        const h = Math.min(PORTRAIT_H_MAX, Math.max(PORTRAIT_H_MIN, Math.round(720 * ph / pw)));
        return { w: 720, h };
    }
    return LANDSCAPE_BASE;
}

export function computeLayout(W, H) {
    if (H <= W) {
        return {
            portrait: false,
            W, H,
            hud: {
                barX: 16, barY: 10, barW: 1250, barH: 112, centerY: 62,
                iconX: 78, counterX: 112, counterY: 76,
                gpsIconX: 420, gpsIconY: 62, gpsTextX: 450, gpsTextY: 74, gpsSize: 20,
                statsVisible: true, statsXBase: 450, statsY: 74, statsSize: 14,
                starsRight: 1050, starsY: 62,
                btnW: 160, btnH: 48, btnX: 1066, gearDx: 29, labelDx: 52
            },
            panel: {
                px: 900, py: 124, pw: 364, ph: 582, titleDy: 47, titleSize: 24,
                tabsCY: 84, tabH: 32, tabLabelSize: 14,
                tierCY: 125, tierLabelSize: 13,
                amountW: 76, amountH: 24, amountSize: 14, amountPadRight: 0
            },
            viewport: { x: 934, y: 270, w: 296, h: 392 },
            unlock: { cx: 400, y: 604, w: 520, h: 52, hintY: 676, textSize: 18, hintSize: 14 },
            modal: { cx: 640, cy: 360 },
            block: { x: 400, y: 400 },
            bgCoverToY: 720,
            tutorial: { finalY: 320, btnY: 400, tabBubble: 'left' }
        };
    }

    // Портрет. Панель-«лист» от края до края (без серых полос по бокам), прижата
    // к низу экрана; ряды строятся шириной с вьюпорт (широкие карточки —
    // описания в одну строку). Внутренние зоны панели — из пропорций текстуры
    // (source 1029x1119, face x73..964, y208..1058). Шапка: планка (drawn 19..76),
    // дерево 76..108, тёмная врезка 108..550. Вкладки (32) висят на планке
    // (58..90, заголовок выше и мельче) — под ними ДЕРЕВО до врезки (18 мировых
    // px ~ 9 экранных), и только затем тёмная зона; строка тира/мультипокупка
    // (центр 128) — у её верхней кромки; список 156..550.
    const pw = W;
    const ph = 582;
    const px = 0;
    const py = H - ph;
    const vpX = Math.round(73 * pw / 1029);
    const vpR = pw - Math.round(65 * pw / 1029);
    const unlockY = py - 108;
    return {
        portrait: true,
        W, H,
        hud: {
            barX: 8, barY: 10, barW: W - 16, barH: 112, centerY: 62,
            iconX: 54, counterX: 88, counterY: 76,
            gpsIconX: 258, gpsIconY: 50, gpsTextX: 278, gpsTextY: 56, gpsSize: 16,
            statsVisible: true, statsXBase: 278, statsY: 86, statsSize: 14,
            starsRight: (W - 8 - 18 - 160) - 12, starsY: 62,
            btnW: 160, btnH: 48, btnX: W - 8 - 18 - 160, gearDx: 29, labelDx: 52
        },
        panel: {
            px, py, pw, ph, titleDy: 42, titleSize: 22,
            tabsCY: 74, tabH: 32, tabLabelSize: 17,
            tierCY: 128, tierLabelSize: 16,
            amountW: 92, amountH: 30, amountSize: 16, amountPadRight: 18
        },
        viewport: { x: vpX, y: py + 156, w: vpR - vpX, h: 394 },
        unlock: { cx: Math.round(W / 2), y: unlockY, w: 520, h: 52, hintY: py - 36, textSize: 20, hintSize: 14 },
        modal: { cx: Math.round(W / 2), cy: Math.max(Math.round(py / 2), 302) },
        block: { x: Math.round(W / 2), y: Math.round((140 + (unlockY - 16)) / 2) },
        bgCoverToY: py,
        tutorial: { finalY: Math.round((140 + (unlockY - 16)) / 2) - 110, btnY: Math.round((140 + (unlockY - 16)) / 2) - 30, tabBubble: 'below' }
    };
}
