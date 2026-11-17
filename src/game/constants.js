// Константы игрового мира (GameScene): фоны, стадии блока, слои, тайминги.

import { TIERS } from '../state.js';

export const BLOCK_STAGES = [1, 2, 3, 4];
export const BLOCK_STAGE_COUNT = BLOCK_STAGES.length;

// Фоны локаций (пиксель-арт конверсия voxel-рендеров ComfyUI): один фон на тир руды.
// При смене тира — плавный кроссфейд; фон обязан закрыть видимую зону (ландшафт —
// весь экран, портрет — полоса до верхней кромки панели) с запасом 8% (страховка
// от тряски камеры при крите).
export const BG_KEYS = [
    'bg_01_coal',
    'bg_02_copper',
    'bg_03_iron',
    'bg_04_silver',
    'bg_05_gold',
    'bg_06_amethyst',
    'bg_07_emerald',
    'bg_08_ruby',
    'bg_09_sapphire',
    'bg_10_platinum',
    'bg_11_uranium',
    'bg_12_diamond'
];
export const BG_FADE_MS = 800;
export const BG_SHADE_ALPHA = 0.32;
export const BG_OVERSIZE = 1.08;

// Тайминги игровых циклов
export const PASSIVE_TICK_MS = 1000; // пассивный доход начисляется раз в секунду
export const AUTO_TICK_MS = 200; // робо-рука копит доли кликов каждые 200 мс
export const AUTO_BUDGET_CAP = 20; // кап накопленных кликов (залп на время простоя)
export const AUTO_CLICKS_PER_TICK_GUARD = 100; // защита от бесконечного цикла за тик
export const AUTOSAVE_MS = 5000; // автосохранение

// Боевые предметы: у каждого свой баф (поле until в gameState)
export const BOSS_ITEM_BUFF_FIELD = {
    item_bomb: 'bossBuffUntil',
    item_rig: 'rigBuffUntil',
    item_oil: 'oilBuffUntil'
};

// Слои мира (UIScene живёт в своей шкале — см. ui/shared/theme.js DEPTH)
export const GAME_DEPTH = {
    floatText: 20, // подписи урона/дохода
    floatBurst: 25, // подписи мутаций и взрыва
    bossOverlay: 27,
    bossFloat: 28,
    bossFlash: 29
};

export function tierBgKey(tier) {
    return BG_KEYS[Math.min(tier, BG_KEYS.length - 1)];
}

const BASE_BLOCK_STAGE_KEYS = [
    'block_stage_1_intact',
    'block_stage_2_cracked',
    'block_stage_3_heavy_cracks',
    'block_stage_4_shattered'
];

export function blockStageKey(tier, stage) {
    const prefix = TIERS[tier].blockPrefix;
    if (prefix === 'block') {
        return BASE_BLOCK_STAGE_KEYS[stage - 1];
    }

    return `${prefix}_stage_${stage}`;
}
