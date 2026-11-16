// Артефакты и временные бафы (дневные и предметные): геттеры текущих множителей.
// Все бафы — таймеры WALL-CLOCK (ms): переживают перезагрузку, истекают сами.

import { gameState } from './gameState.js';
import { ARTIFACTS, ARTIFACT_MULT_FIELDS } from './catalog/meta.js';

// Суммарный бонус артефактов по полю: мультипликаторы перемножаются (старт 1),
// плоские прибавки суммируются (старт 0).
export function getArtifactBonus(field) {
    const isMult = ARTIFACT_MULT_FIELDS.includes(field);
    let acc = isMult ? 1 : 0;
    for (const def of ARTIFACTS) {
        if (!gameState.artifacts.includes(def.id)) {
            continue;
        }

        const v = def.bonuses[field];
        if (v) {
            acc = isMult ? acc * v : acc + v;
        }
    }

    return acc;
}

// Баф активен, пока wall-clock не достиг метки until.
const isActive = (until) => Date.now() < until;

// Активный дневной множитель добычи (1 = бафа нет)
export function getDailyMult() {
    return isActive(gameState.dailyBuffUntil) ? gameState.dailyBuffMult : 1;
}

// Бафы «Критический импульс» / «Золотая жила»
export function isDailyCritActive() {
    return isActive(gameState.dailyCritUntil);
}

export function isDailyVeinActive() {
    return isActive(gameState.dailyVeinUntil);
}

export function getItemBuffMult() {
    return isActive(gameState.miningBuffUntil) ? gameState.miningBuffMult : 1;
}

export function isItemVeinActive() {
    return isActive(gameState.itemVeinUntil);
}

// Итоговый множитель урона боссу: артефакты x предметный баф «Шахтёрская бомба».
export function getBossDamageMult() {
    return getArtifactBonus('bossDamageMult') * (isActive(gameState.bossBuffUntil) ? gameState.bossBuffMult : 1);
}

// Множитель АВТО-урона в бою («Робо-рама»): усиливает только удары робо-руки —
// ручные клики не трогает, чтобы ручной и авто-бой оставались разными осями.
export function getRigBuffMult() {
    return isActive(gameState.rigBuffUntil) ? gameState.rigBuffMult : 1;
}

// Плоский +крит-шанс в бою («Точильный камень»).
export function getOilBuffAdd() {
    return isActive(gameState.oilBuffUntil) ? gameState.oilBuffAdd : 0;
}
