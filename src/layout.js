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
export const PORTRAIT_H_MIN = 1280;
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
                starsRight: 818, starsY: 62,
                btnW: 160, btnH: 48, btnX: 1066, gearDx: 29, labelDx: 52,
                mapBtn: { x: 830, y: 38, w: 110, h: 48 },
                craftBtn: { x: 952, y: 38, w: 110, h: 48 }
            },
            panel: {
                px: 900, py: 124, pw: 364, ph: 582, titleDy: 47, titleSize: 24,
                tabsCY: 84, tabH: 32, tabLabelSize: 14,
                // tabW — ширина вкладки (две по 145 + зазор 6 = ширина списка);
                // tierInset — отступ строки тира от левого края вьюпорта
                tabW: 145, tierInset: 2,
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

    // Портрет. Панель-«лист» (~60% высоты) от края до края, прижата к низу;
    // внутри — планка с заголовком, тёмная врезка (вкладки, строка тира,
    // список) и НИЖНИЙ ДОК с главными действиями (Карта / Спуск / Крафт).
    // Модалки занимают всю свободную зону над панелью. Пропорции текстуры
    // upgrades_panel_wood: face y208..1058 из 1119 -> rT/rB.
    const pw = W;
    const ph = Math.min(900, Math.max(700, Math.round(H * 0.60)));
    const px = 0;
    const py = H - ph;
    const vpX = Math.round(73 * pw / 1029);
    const vpR = pw - Math.round(65 * pw / 1029);
    const recessTop = Math.round(0.186 * ph);
    const recessBot = Math.round(0.945 * ph);
    const dockY = py + recessBot - 12 - 92;
    const dockSideW = 150;
    const dockGap = 12;
    const unlockW = 300;
    return {
        portrait: true,
        W, H,
        hud: {
            barX: 8, barY: 10, barW: W - 16, barH: 112, centerY: 62,
            // Сетка текстов во врезке (y30..95): общий левый край counterX.
            // Строка 1 (низ бокса row1Y): счётчик + имя руды слева, ставка справа
            // до «Настроек». Строка 2 (низ бокса row2Y): клик · крит слева.
            iconX: 54, counterX: 88, counterY: 66,
            row1Y: 66, row2Y: 92,
            gapR: 12,          // зазор правого края ставки до кнопки «Настройки»
            nameGap: 10,       // счётчик -> имя руды
            midGap: 16,        // имя руды -> блок ставки
            gpsIconSize: 24, gpsIconGap: 6,
            gpsIconX: 0, gpsIconY: 54, gpsTextX: 0, gpsTextY: 66, gpsSize: 20,
            statsVisible: true, statsXBase: 88, statsY: 92, statsSize: 16,
            starsRight: W - 76, starsY: py + Math.round(0.081 * ph),
            btnW: 160, btnH: 48, btnX: W - 8 - 18 - 160, gearDx: 29, labelDx: 52,
            mapBtn: { x: vpX, y: dockY, w: dockSideW, h: 92 },
            craftBtn: { x: vpX + 624 - dockSideW, y: dockY, w: dockSideW, h: 92 }
        },
        panel: {
            px, py, pw, ph, titleDy: Math.round(0.081 * ph), titleSize: 26,
            recessTop, recessBot,
            tabsCY: recessTop + 44, tabH: 68, tabLabelSize: 20,
            // tabW — половина ширины списка минус зазор 6 (SPACE.sm): вкладки
            // растягиваются на врезку; tierInset — отступ строки тира слева
            tabW: Math.floor((vpR - vpX - 6) / 2), tierInset: 14,
            tierCY: recessTop + 110, tierLabelSize: 22,
            amountW: 120, amountH: 48, amountSize: 20, amountPadRight: 16
        },
        viewport: { x: vpX, y: py + recessTop + 142, w: vpR - vpX, h: recessBot - recessTop - 142 - 114 },
        dock: { y: dockY, h: 92, x: vpX, w: vpR - vpX, sideW: dockSideW, gap: dockGap, unlockX: vpX + dockSideW + dockGap, unlockW, bossSideW: 306 },
        unlock: { cx: vpX + dockSideW + dockGap + unlockW / 2, y: dockY, w: unlockW, h: 92, hintY: py - 36, textSize: 20, hintSize: 14 },
        modal: { cx: Math.round(W / 2), cy: Math.round((160 + (H - 16)) / 2), zoneTop: 160, zoneBot: H - 16 },
        fight: { by: Math.max(Math.round((150 + py) / 2), 340) },
        block: { x: Math.round(W / 2), y: Math.round((156 + (py - 16)) / 2) },
        bgCoverToY: py,
        tutorial: { finalY: Math.round((156 + (py - 16)) / 2) - 110, btnY: Math.round((156 + (py - 16)) / 2) - 30, tabBubble: 'below' }
    };
}
