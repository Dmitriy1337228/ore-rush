// Адаптивная раскладка: одна сетка формул, ориентация окна — коэффициенты
// (раздел 3 TODO). Phaser Scale.FIT вписывает canvas в окно; main.js вызывает
// scale.setGameSize при смене ориентации и эмитит 'layout-changed' — сцены
// перечитывают раскладку через computeLayout.
//
// Ландшафт (1280x720) — историческая статичная сетка, координаты выверены
// итерациями вёрстки, FIT масштабирует канвас целиком (значения = константы
// UIScene/GameScene 1:1). Портрет: высота сетки повторяет пропорции окна
// (canvas = весь экран телефона, без серых полос), HUD на всю ширину,
// панель улучшений — «нижний лист» на всю ширину с широкими рядами,
// кнопка спуска над панелью, модалки — в свободной зоне над панелью.
// Форма результата прежняя (портретные секции dock/fight, поля врезки,
// зазоры HUD-сетки) — контракт: tests/characterization/layout.test.mjs.

export const LANDSCAPE_BASE = { w: 1280, h: 720 };
// Минимальная высота портретной сетки: блок + спуск + панель (592) не влезают ниже.
// Максимум — потолок качества фона (сильный зум мылит). 1680 покрывает 375x844
// (H=1620) без серых полос FIT, зум остается <=2.1x.
export const PORTRAIT_H_MIN = 1280;
export const PORTRAIT_H_MAX = 1680;

export function baseForOrientation(pw, ph) {
    if (ph > pw) {
        // Высота = пропорции окна: canvas заполняет экран целиком (390x844 -> 720x1558)
        const h = Math.min(PORTRAIT_H_MAX, Math.max(PORTRAIT_H_MIN, Math.round((720 * ph) / pw)));

        return { w: 720, h };
    }

    return LANDSCAPE_BASE;
}

export function computeLayout(W, H) {
    // Единая сборка: промежуточные величины (панель, врезка, вьюпорт, док)
    // считаются один раз, различия ориентаций — коэффициенты в тернарниках и
    // условные секции. Ландшафт всегда получает базу 1280x720 (FIT), портрет —
    // формулы от окна. Значения — бывшие константы двух веток 1:1.
    const portrait = H > W;

    // --- Панель улучшений ---
    // Ландшафт: правая колонка фиксированной сетки. Портрет: «лист» (~60%
    // высоты, клампы 700..900) от края до края, прижат к низу; внутри планка
    // с заголовком, тёмная врезка и нижний док.
    const pw = portrait ? W : 364;
    const ph = portrait ? Math.min(900, Math.max(700, Math.round(H * 0.6))) : 582;
    const px = portrait ? 0 : 900;
    const py = portrait ? H - ph : 124;
    // Врезка (тёмная зона: вкладки, строка тира, список) — только портрет;
    // пропорции текстуры upgrades_panel_wood: face y208..1058 из 1119 -> rT/rB.
    const recessTop = portrait ? Math.round(0.186 * ph) : 0;
    const recessBot = portrait ? Math.round(0.945 * ph) : 0;

    // --- Вьюпорт списка: панель минус врезки (инсеты от краёв панели) ---
    // Ландшафт: поля 34/34/146/44. Портрет: бока по пропорциям текстуры
    // (face x73..964 из 1029), сверху врезка + планка 142, снизу док 114.
    const vpInsetL = portrait ? Math.round((73 * pw) / 1029) : 34;
    const vpInsetR = portrait ? Math.round((65 * pw) / 1029) : 34;
    const vpInsetT = portrait ? recessTop + 142 : 146;
    const vpInsetB = portrait ? ph - recessBot + 114 : 44;
    const viewport = {
        x: px + vpInsetL,
        y: py + vpInsetT,
        w: pw - vpInsetL - vpInsetR,
        h: ph - vpInsetT - vpInsetB
    };

    // --- Док (портрет): планка действий Карта | Спуск | Крафт под врезкой ---
    const dockY = py + recessBot - 12 - 92;
    const dockSideW = 150;
    const dockGap = 12;
    const unlockW = 300;

    return {
        portrait,
        W,
        H,
        hud: {
            barX: portrait ? 8 : 16,
            barY: 10,
            barW: portrait ? W - 16 : 1250,
            barH: 112,
            centerY: 62,
            iconX: portrait ? 54 : 78,
            counterX: portrait ? 88 : 112,
            counterY: portrait ? 66 : 76,
            iconSize: 48,
            gpsIconSize: portrait ? 24 : 26,
            // Сетка текстов во врезке (y30..95): общий левый край counterX.
            // Строка 1 (низ бокса row1Y): счётчик + имя руды слева, ставка справа
            // до «Настроек». Строка 2 (низ бокса row2Y): клик · крит слева.
            ...(portrait
                ? {
                      row1Y: 66,
                      row2Y: 92,
                      gapR: 12, // зазор правого края ставки до кнопки «Настройки»
                      nameGap: 10, // счётчик -> имя руды
                      midGap: 16, // имя руды -> блок ставки
                      gpsIconGap: 6
                  }
                : {}),
            gpsIconX: portrait ? 0 : 420,
            gpsIconY: portrait ? 54 : 62,
            gpsTextX: portrait ? 0 : 450,
            gpsTextY: portrait ? 66 : 74,
            gpsSize: 20,
            statsVisible: true,
            statsXBase: portrait ? 88 : 450,
            statsY: portrait ? 92 : 74,
            statsSize: portrait ? 16 : 14,
            starsRight: portrait ? W - 76 : 818,
            starsY: portrait ? py + Math.round(0.081 * ph) : 62,
            btnW: 160,
            btnH: 48,
            btnX: portrait ? W - 8 - 18 - 160 : 1066,
            gearDx: 29,
            labelDx: 52,
            mapBtn: portrait ? { x: px + vpInsetL, y: dockY, w: dockSideW, h: 92 } : { x: 830, y: 38, w: 110, h: 48 },
            craftBtn: portrait
                ? { x: px + pw - vpInsetR - dockSideW, y: dockY, w: dockSideW, h: 92 }
                : { x: 952, y: 38, w: 110, h: 48 }
        },
        panel: {
            px,
            py,
            pw,
            ph,
            titleDy: portrait ? Math.round(0.081 * ph) : 47,
            titleSize: portrait ? 26 : 24,
            tabsCY: portrait ? recessTop + 44 : 84,
            tabH: portrait ? 68 : 32,
            tabLabelSize: portrait ? 20 : 14,
            // tabW — ширина вкладки (в ландшафте две по 145 + зазор 6 = ширина
            // списка; в портрете вкладки растягиваются на врезку);
            // tierInset — отступ строки тира от левого края вьюпорта
            tabW: portrait ? Math.floor((viewport.w - 6) / 2) : 145,
            tierInset: portrait ? 14 : 2,
            tierCY: portrait ? recessTop + 110 : 125,
            tierLabelSize: portrait ? 22 : 13,
            amountW: portrait ? 120 : 76,
            amountH: portrait ? 48 : 24,
            amountSize: portrait ? 20 : 14,
            amountPadRight: portrait ? 16 : 0,
            ...(portrait ? { recessTop, recessBot } : {})
        },
        viewport,
        ...(portrait
            ? {
                  dock: {
                      y: dockY,
                      h: 92,
                      x: px + vpInsetL,
                      w: viewport.w,
                      sideW: dockSideW,
                      gap: dockGap,
                      unlockX: px + vpInsetL + dockSideW + dockGap,
                      unlockW,
                      bossSideW: 306
                  }
              }
            : {}),
        unlock: portrait
            ? {
                  cx: px + vpInsetL + dockSideW + dockGap + unlockW / 2,
                  y: dockY,
                  w: unlockW,
                  h: 92,
                  hintY: py - 36,
                  textSize: 20,
                  hintSize: 14
              }
            : { cx: 400, y: 604, w: 520, h: 52, hintY: 676, textSize: 18, hintSize: 14 },
        modal: portrait
            ? {
                  cx: Math.round(W / 2),
                  cy: Math.round((160 + (H - 16)) / 2),
                  zoneTop: 160,
                  zoneBot: H - 16
              }
            : { cx: 640, cy: 360 },
        ...(portrait ? { fight: { by: Math.max(Math.round((150 + py) / 2), 340) } } : {}),
        gear: {
            // Секция «Снаряжение» в бою (панель вместо списка улучшений).
            // Ландшафт: три ряда 114 + зазоры 10 + планка 30 = ровно врезка 392.
            // Портрет: высота ряда считается в layoutGearSection от ЖИВОГО
            // вьюпорта (босс-режим его поджимает — computeLayout этого не знает).
            rowH: portrait ? 0 : 114,
            rowGap: portrait ? 8 : 10,
            startDy: portrait ? 4 : 30,
            titleDy: 16,
            iconInset: portrait ? 40 : 30,
            iconSize: portrait ? 48 : 44,
            iconDy: portrait ? 34 : 38,
            textGap: portrait ? 14 : 12,
            nameDy: portrait ? 34 : 16,
            descDy: portrait ? 66 : 37,
            sideInset: 14,
            btnH: portrait ? 0 : 28,
            btnHMin: 44,
            btnHMax: 88,
            btnInset: portrait ? 12 : 10,
            hitPad: 5,
            // cardInset — отступ с ОДНОЙ стороны (в коде умножается на 2)
            cardInset: 4
        },
        block: portrait ? { x: Math.round(W / 2), y: Math.round((156 + (py - 16)) / 2) } : { x: 400, y: 400 },
        bgCoverToY: portrait ? py : 720,
        tutorial: portrait
            ? {
                  finalY: Math.round((156 + (py - 16)) / 2) - 110,
                  btnY: Math.round((156 + (py - 16)) / 2) - 30,
                  tabBubble: 'below'
              }
            : { finalY: 320, btnY: 400, tabBubble: 'left' }
    };
}
