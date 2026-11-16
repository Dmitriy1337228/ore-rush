// CHARACTERIZATION-ТЕСТЫ: src/layout.js — адаптивная раскладка (golden).
// Значения сняты tools/capture_goldens.mjs на текущем продовом коде.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importLayout } from './helpers/globals.mjs';

const L = await importLayout();

describe('baseForOrientation: выбор базовой сетки', () => {
    it('ландшафт 1280x720 -> 1280x720', () => {
        assert.deepEqual(L.baseForOrientation(1280, 720), { w: 1280, h: 720 });
    });
    it('портрет 390x844 -> 720x1558 (высота по пропорциям окна)', () => {
        assert.deepEqual(L.baseForOrientation(390, 844), { w: 720, h: 1558 });
    });
    it('клампы высоты портрета: 1280..1680', () => {
        assert.deepEqual(L.baseForOrientation(360, 2000), { w: 720, h: 1680 });
        assert.deepEqual(L.baseForOrientation(360, 640), { w: 720, h: 1280 });
    });
    it('квадрат считается ландшафтом', () => {
        assert.deepEqual(L.baseForOrientation(720, 720), { w: 1280, h: 720 });
    });
    it('константы', () => {
        assert.deepEqual(L.LANDSCAPE_BASE, { w: 1280, h: 720 });
        assert.equal(L.PORTRAIT_H_MIN, 1280);
        assert.equal(L.PORTRAIT_H_MAX, 1680);
    });
});

describe('computeLayout(1280, 720): ландшафт (golden)', () => {
    it('полный объект раскладки', () => {
        assert.deepEqual(L.computeLayout(1280, 720), {
            portrait: false, W: 1280, H: 720,
            hud: {
                barX: 16, barY: 10, barW: 1250, barH: 112, centerY: 62,
                iconX: 78, counterX: 112, counterY: 76, iconSize: 48,
                gpsIconX: 420, gpsIconY: 62, gpsTextX: 450, gpsTextY: 74, gpsSize: 20,
                gpsIconSize: 26,
                statsVisible: true, statsXBase: 450, statsY: 74, statsSize: 14,
                starsRight: 818, starsY: 62,
                btnW: 160, btnH: 48, btnX: 1066, gearDx: 29, labelDx: 52,
                mapBtn: { x: 830, y: 38, w: 110, h: 48 },
                craftBtn: { x: 952, y: 38, w: 110, h: 48 }
            },
            panel: {
                px: 900, py: 124, pw: 364, ph: 582, titleDy: 47, titleSize: 24,
                tabsCY: 84, tabH: 32, tabLabelSize: 14,
                tabW: 145, tierInset: 2,
                tierCY: 125, tierLabelSize: 13,
                amountW: 76, amountH: 24, amountSize: 14, amountPadRight: 0
            },
            viewport: { x: 934, y: 270, w: 296, h: 392 },
            gear: {
                rowH: 114, rowGap: 10, startDy: 30, titleDy: 16,
                iconInset: 30, iconSize: 44, iconDy: 38, textGap: 12,
                nameDy: 16, descDy: 37,
                sideInset: 14, btnH: 28, btnHMin: 44, btnHMax: 88, btnInset: 10, hitPad: 5,
                cardInset: 4
            },
            unlock: { cx: 400, y: 604, w: 520, h: 52, hintY: 676, textSize: 18, hintSize: 14 },
            modal: { cx: 640, cy: 360 },
            block: { x: 400, y: 400 },
            bgCoverToY: 720,
            tutorial: { finalY: 320, btnY: 400, tabBubble: 'left' }
        });
    });
});

describe('computeLayout(720, 1558): портрет для 390x844 (golden)', () => {
    it('полный объект раскладки (панель-лист, док, модалки)', () => {
        assert.deepEqual(L.computeLayout(720, 1558), {
            portrait: true, W: 720, H: 1558,
            hud: {
                barX: 8, barY: 10, barW: 704, barH: 112, centerY: 62,
                iconX: 54, counterX: 88, counterY: 66, iconSize: 48,
                row1Y: 66, row2Y: 92,
                gapR: 12, nameGap: 10, midGap: 16,
                gpsIconSize: 24, gpsIconGap: 6,
                gpsIconX: 0, gpsIconY: 54, gpsTextX: 0, gpsTextY: 66, gpsSize: 20,
                statsVisible: true, statsXBase: 88, statsY: 92, statsSize: 16,
                starsRight: 644, starsY: 731,
                btnW: 160, btnH: 48, btnX: 534, gearDx: 29, labelDx: 52,
                mapBtn: { x: 51, y: 1405, w: 150, h: 92 },
                craftBtn: { x: 525, y: 1405, w: 150, h: 92 }
            },
            panel: {
                px: 0, py: 658, pw: 720, ph: 900, titleDy: 73, titleSize: 26,
                recessTop: 167, recessBot: 851,
                tabsCY: 211, tabH: 68, tabLabelSize: 20,
                tabW: 309, tierInset: 14,
                tierCY: 277, tierLabelSize: 22,
                amountW: 120, amountH: 48, amountSize: 20, amountPadRight: 16
            },
            viewport: { x: 51, y: 967, w: 624, h: 428 },
            dock: { y: 1405, h: 92, x: 51, w: 624, sideW: 150, gap: 12, unlockX: 213, unlockW: 300, bossSideW: 306 },
            unlock: { cx: 363, y: 1405, w: 300, h: 92, hintY: 622, textSize: 20, hintSize: 14 },
            modal: { cx: 360, cy: 851, zoneTop: 160, zoneBot: 1542 },
            fight: { by: 404 },
            gear: {
                rowH: 0, rowGap: 8, startDy: 4, titleDy: 16,
                iconInset: 40, iconSize: 48, iconDy: 34, textGap: 14,
                nameDy: 34, descDy: 66,
                sideInset: 14, btnH: 0, btnHMin: 44, btnHMax: 88, btnInset: 12, hitPad: 5,
                cardInset: 4
            },
            block: { x: 360, y: 399 },
            bgCoverToY: 658,
            tutorial: { finalY: 289, btnY: 369, tabBubble: 'below' }
        });
    });
});

describe('computeLayout(720, 720): квадрат идёт в ландшафтную ветку', () => {
    it('portrait=false, W=H=720, сетка ландшафтных констант', () => {
        const l = L.computeLayout(720, 720);
        assert.equal(l.portrait, false);
        assert.equal(l.W, 720);
        assert.equal(l.H, 720);
        assert.deepEqual(l.panel, L.computeLayout(1280, 720).panel); // те же литералы
    });
});
