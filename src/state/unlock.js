// Тиры: цена спуска (снапшот при входе), переходы между уровнями шахты.
//
// Цена = N секунд дохода-якоря, зафиксированного ПРИ ВХОДЕ В ТИР
// (gameState.tierAnchorRate), и НЕ меняется до следующего спуска.
// Пока прокачка не купила всё, доступное на тире, каждая покупка строго
// приближает спуск (цена константна, дефицит тает) — и покупка никогда не
// «отбрасывает» накопления. «Переход неизбежен» возникает сам: каталог тира
// ограничен гейтами tier (см. UPGRADES), внутри-тировой разгон ограничен
// десятками раз, после выкупа доступного спуск наступает за минуты.
// Заморозки/догона нет; углубление тиров — ростом N (UNLOCK_SECONDS_GROWTH 2.95 за тир).

import { gameState } from './gameState.js';
import { TIERS, LAST_TIER_INDEX } from './catalog/tiers.js';
import { getEarningRate, getPrestigeMult } from './income.js';

export const UNLOCK_BASE_SECONDS = 180; // спуск из тира 0 стоит 180 сек дохода
export const UNLOCK_SECONDS_GROWTH = 2.95; // требования растут за каждый тир
export const UNLOCK_FLOOR = 2500; // минимум (старт с нулевым доходом)
// Нижняя граница ставки: защита от деления на ноль и нулевого якоря
const MIN_RATE = 1e-9;

export function unlockSecondsFor(tier) {
    return UNLOCK_BASE_SECONDS * Math.pow(UNLOCK_SECONDS_GROWTH, tier);
}

const isLastTier = (tier) => tier >= LAST_TIER_INDEX;

// Якорь дохода текущего тира: фиксируется при входе (unlockTier / forceNextTier /
// doPrestige) либо лениво при первом обращении (новая игра, сейв старой версии).
// 0/NaN = «ещё не зафиксирован».
export function resetTierAnchor() {
    gameState.tierAnchorRate = 0;
}

function getTierAnchorRate() {
    const a = Number(gameState.tierAnchorRate);
    if (!(a > 0) || !isFinite(a)) {
        gameState.tierAnchorRate = Math.max(getEarningRate(), MIN_RATE);
    }
    return gameState.tierAnchorRate;
}

// Цена спуска из тира `tier` в `tier + 1`; null для последнего тира.
// Снапшот от якоря (доход при входе): см. описание модуля.
export function computeNextUnlockPrice(tier) {
    if (isLastTier(tier)) return null;
    const anchor = getTierAnchorRate();
    const byRate = unlockSecondsFor(tier) * anchor;
    return Math.ceil(Math.max(UNLOCK_FLOOR * getPrestigeMult(), byRate));
}

// Текущая цена спуска.
export function getNextUnlockPrice() {
    return computeNextUnlockPrice(gameState.tier);
}

// Время до спуска при текущей ставке добычи, сек (оценка для активного игрока).
// Используется для ETA на кнопке спуска и фильтра «окупаемость» в симуляторе.
export function getUnlockEtaSeconds() {
    if (isLastTier(gameState.tier)) return null;
    const price = getNextUnlockPrice();
    const deficit = Math.max(0, price - gameState.ore);
    return deficit / Math.max(getEarningRate(), MIN_RATE);
}

export function getNextTier() {
    return isLastTier(gameState.tier) ? null : TIERS[gameState.tier + 1];
}

export function canUnlockTier() {
    return !isLastTier(gameState.tier) && gameState.ore >= getNextUnlockPrice();
}

export function unlockTier() {
    if (!canUnlockTier()) return false;
    gameState.ore -= getNextUnlockPrice();
    gameState.tier += 1;
    resetTierAnchor(); // якорь нового тира зафиксируется от дохода уже с множителем x3
    return true;
}

// Принудительный переход без оплаты (DevPanel).
export function forceNextTier() {
    if (isLastTier(gameState.tier)) return false;
    gameState.tier += 1;
    gameState.ore = 0;
    resetTierAnchor();
    return true;
}
