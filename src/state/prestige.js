// Престиж: звёзды за алмазы забега, сброс прогресса с сохранением меты.

import { gameState, createInitialState } from './gameState.js';
import { TIERS, DIAMOND_INDEX } from './catalog/tiers.js';
import { PRESTIGE_REQUIREMENT } from './catalog/balance.js';

export function getStarsGain() {
    return Math.floor(Math.sqrt(gameState.tierEarned[DIAMOND_INDEX] / PRESTIGE_REQUIREMENT));
}

export function canPrestige() {
    return getStarsGain() >= 1;
}

export function doPrestige() {
    const gain = getStarsGain();
    if (gain < 1) {
        return 0;
    }

    gameState.stars += gain;
    gameState.ore = 0;
    gameState.tier = 0;
    gameState.tierEarned = TIERS.map(() => 0);
    gameState.tierAnchorRate = 0;
    gameState.levels = createInitialState().levels;
    // мета-прогресс переживает престиж; боссы бьются заново (артефакты не дублируются)
    gameState.bossesDefeated = {};

    return gain;
}
