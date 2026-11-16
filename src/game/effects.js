// Визуальные эффекты игрового мира: всплывающие подписи и обратная связь удара.

import { TIERS, gameState, fmt } from '../state.js';
import { makeLabel } from '../ui/uiKit.js';
import { TEXT } from '../ui/theme.js';

const HIT_BURST = { normal: { ore: 8, debris: 4 }, special: { ore: 16, debris: 8 } }; // обычный удар / крит или жила
const FLOAT_RISE_PX = 60;
const FLOAT_DURATION_MS = 750;
const FLOAT_OFFSET_Y = 30; // подпись удара поднята над точкой клика
const HIT_FLOAT_SIZE = { special: 30, manual: 22, auto: 16 }; // авто-клики мельче, чтобы не забивать ручные
const VEIN_COLOR = '#ffec8a';

// Всплывающая подпись: появляется в (x, y), поднимается на rise и гаснет.
// opts: { style, depth, startAlpha, rise, duration, ease }
export function floatText(scene, x, y, text, size, color, opts = {}) {
    const { style, depth, startAlpha, rise = FLOAT_RISE_PX, duration = FLOAT_DURATION_MS, ease } = opts;
    const float = makeLabel(scene, x, y, text, size, color, style);
    float.setOrigin(0.5);
    if (depth !== undefined) {
        float.setDepth(depth);
    }

    if (startAlpha !== undefined) {
        float.setAlpha(startAlpha);
    }

    const tween = { targets: float, y: float.y - rise, alpha: 0, duration, onComplete: () => float.destroy() };
    if (ease) {
        tween.ease = ease;
    }

    scene.tweens.add(tween);

    return float;
}

// Реакция на удар (блок или босс): частицы руды/осколков + подпись урона.
// Подпись: «КРИТ!»/«ЖИЛА!» — крупнее и ярче; авто-клики мельче ручных.
export function showHitFeedback(scene, px, py, amount, { crit, lucky, isAuto }, depth) {
    const special = crit || lucky;
    const burst = special ? HIT_BURST.special : HIT_BURST.normal;
    scene.oreEmitter.explode(burst.ore, px, py);
    scene.debrisEmitter.explode(burst.debris, px, py);
    let label = `+${fmt(amount)}`;
    let color = TIERS[gameState.tier].floatColor;
    if (lucky) {
        label = `ЖИЛА! +${fmt(amount)}`;
        color = VEIN_COLOR;
    } else if (crit) {
        label = `КРИТ! +${fmt(amount)}`;
        color = TEXT.gold;
    }

    const size = special ? HIT_FLOAT_SIZE.special : isAuto ? HIT_FLOAT_SIZE.auto : HIT_FLOAT_SIZE.manual;
    floatText(scene, px, py - FLOAT_OFFSET_Y, label, size, color, { depth, ease: 'Cubic.easeOut' });
}
