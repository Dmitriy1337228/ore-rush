// Ежедневные награды: серия дней, выдача награды, применение эффектов.

import { gameState } from './gameState.js';
import { DAY_MS } from './constants.js';
import { DAILY_REWARDS, DAILY_CRIT_DURATION_MS, DAILY_INSTANT_SECONDS } from './catalog/daily.js';
import { getUpgradeLevel } from './upgrades.js';
import { getEarningRate } from './income.js';
import { pickFreeUpgrade } from './upgradeRoi.js';
import { addOre, saveGame } from './ore.js';

export function getDailyDay() {
    return Math.floor(Date.now() / DAY_MS);
}

export function canClaimDaily() {
    return getDailyDay() > gameState.lastDailyDay;
}

// Применяет эффект награды; возвращает «extra» для окна награды
// (количество руды у 'instant', {id, name} улучшения у 'upgrade') либо null.
const REWARD_APPLIERS = {
    mult(reward) {
        gameState.dailyBuffMult = reward.mult;
        gameState.dailyBuffUntil = Date.now() + reward.durMs;
        return null;
    },
    instant() {
        // несколько минут ПОЛНОГО дохода (пассив + клики/авто) — по построению
        // масштабируется с прогрессом и не раздаёт слишком много
        const amount = DAILY_INSTANT_SECONDS * getEarningRate();
        addOre(amount);
        return amount;
    },
    crit() {
        gameState.dailyCritUntil = Date.now() + DAILY_CRIT_DURATION_MS;
        return null;
    },
    vein(reward) {
        gameState.dailyVeinUntil = Date.now() + reward.durMs;
        return null;
    },
    upgrade() {
        const def = pickFreeUpgrade();
        if (!def) return null;
        gameState.levels[def.id] = getUpgradeLevel(def.id) + 1;
        return { id: def.id, name: def.name };
    }
};

function applyDailyReward(reward) {
    const apply = REWARD_APPLIERS[reward.kind];
    return apply ? apply(reward) : null;
}

// Выдача награды дня: серия растёт только за подряд идущие дни, пропуск — сброс.
// Возвращает {reward, streak, extra} или null (уже получено сегодня).
export function claimDailyReward() {
    if (!canClaimDaily()) return null;
    const today = getDailyDay();
    const gap = today - gameState.lastDailyDay;
    gameState.dailyStreak = (gameState.lastDailyDay > 0 && gap === 1) ? gameState.dailyStreak + 1 : 1;
    gameState.lastDailyDay = today;
    const reward = DAILY_REWARDS[(gameState.dailyStreak - 1) % DAILY_REWARDS.length];
    const extra = applyDailyReward(reward);
    saveGame();
    return { reward, streak: gameState.dailyStreak, extra };
}
