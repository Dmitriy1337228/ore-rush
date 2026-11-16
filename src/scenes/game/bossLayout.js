// Геометрия оверлея босса по ориентации. Все смещения — от центра блока (bx) и
// опорной линии боя (by): portrait.by задаёт L.fight.by (спека мобильного
// редизайна), landscape.by = Y блока. Размеры кегля: size — базовый, scaleMax —
// потолок портретного масштаба UIScene (_adaptiveScale), min — нижняя граница.

import Phaser from 'phaser';

export const BOSS_UI = {
    portrait: {
        sprite: { size: 190, dy: 10 },
        hpBar: { w: 380, h: 24, dy: -156 },
        playerBar: { w: 380, h: 12, dy: -128 },
        playerText: { dy: -100, size: 11, scaleMax: 1.4, min: 24 },
        name: { dy: -176, size: 20, scaleMax: 1.4 },
        hpText: { dy: -144, size: 20, stroke: true },
        time: { dx: 190, dy: -176, size: 16, scaleMax: 1.3, originX: 1 },
        // Слоты предметов: шаг 130 при кнопках 120/132
        slot: {
            step: 130,
            dy: 142,
            activeW: 120,
            emptyW: 132,
            h: 60,
            iconDx: -28,
            iconSize: 34,
            cntDx: 20,
            cnt: { size: 14, scaleMax: 1.3 },
            buy: { size: 13, scaleMax: 1.3 }
        },
        hint: null // описания предметов читаются в панели «Снаряжение»
    },
    landscape: {
        sprite: { size: 240, dy: 0 },
        hpBar: { w: 340, h: 20, dy: -190 },
        playerBar: { w: 340, h: 12, dy: -166 },
        playerText: { dy: -128, size: 11 },
        name: { dy: -212, size: 20 },
        hpText: { dy: -180, size: 13 },
        time: { dx: 0, dy: -146, size: 16, originX: 0.5 },
        // Шаг 110: пустой слот (100) шире активного (84) — при 92 наезжали
        slot: {
            step: 110,
            dy: 172,
            activeW: 84,
            emptyW: 100,
            h: 44,
            iconDx: -20,
            iconSize: 26,
            cntDx: 14,
            cnt: { size: 14 },
            buy: { size: 11 }
        },
        hint: { dy: 204, size: 12 }
    }
};

export const BOSS_BAR = {
    border: 2, // рамка полос HP
    playerFill: 8, // высота заливки полосы шахтёра (h 12 - 2*border)
    background: 0x1a1c1f,
    playerColor: 0xff8a4a,
    // Цвет полосы босса: от зелёного (полное HP) к красному (пусто)
    healthy: { r: 0x7e, g: 0xe7, b: 0x87 },
    critical: { r: 0xf0, g: 0x63, b: 0x8c }
};
export const PLAYER_TEXT_COLOR = '#ffb38a';
export const BOSS_HP_STROKE = { color: '#14161a', width: 3 };
export const BOSS_SPRITE_PULSE = 0.03; // пульсация спрайта босса, доля масштаба
export const BOSS_WINDUP_SHAKE_PX = 6; // амплитуда дрожи при замахе
export const BOSS_WINDUP_SHAKE_STEP_MS = 55;
export const BOSS_WINDUP_TINT = 0xff5a5a;
export const BOSS_STRIKE_FLASH = { color: 0xff3b3b, alpha: 0.22, durationMs: 280 };
export const BOSS_DEFEAT_MS = 600;
export const BOSS_SAVE_THROTTLE_MS = 3000;
export const MIN_SLOT_FONT = 8;
export const SLOT_LABEL_PADDING = 12;

// Кегль подписи с учётом портретного масштаба UIScene
export function bossFontSize(spec, uiScale) {
    let size = spec.scaleMax ? Math.round(spec.size * Phaser.Math.Clamp(uiScale, 1, spec.scaleMax)) : spec.size;
    if (spec.min !== undefined) size = Math.max(spec.min, size);
    return size;
}

// Интерполяция цвета полосы босса по доле оставшегося HP (frac 1 -> healthy, 0 -> critical)
export function bossHealthColor(frac) {
    const t = 1 - frac;
    const { healthy: a, critical: z } = BOSS_BAR;
    return Phaser.Display.Color.GetColor(
        Math.round(a.r + (z.r - a.r) * t),
        Math.round(a.g + (z.g - a.g) * t),
        Math.round(a.b + (z.b - a.b) * t)
    );
}
