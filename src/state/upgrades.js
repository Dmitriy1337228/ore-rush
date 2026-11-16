// Улучшения: уровни, цены, покупка (одиночная и пакетная), видимость в UI.

import { gameState } from './gameState.js';
import { UPGRADES } from './catalog/upgrades.js';
import { TIER_COST_MULT } from './catalog/tiers.js';
import { getUpgradeDef } from './catalog/lookup.js';

export function getUpgradeLevel(id) {
    return gameState.levels[id] || 0;
}

// Цена улучшения def на уровне level при множителе тира tierMult.
function costAtLevel(def, level, tierMult) {
    return Math.ceil(def.baseCost * Math.pow(def.growth, level) * tierMult);
}

// Сколько уровней улучшения ещё можно купить из запрошенных want (кап maxLevel).
function limitByMaxLevel(def, start, want) {
    return def.maxLevel === null ? want : Math.min(want, def.maxLevel - start);
}

export function getUpgradeCost(id) {
    const def = getUpgradeDef(id);
    return costAtLevel(def, getUpgradeLevel(id), TIER_COST_MULT(gameState.tier));
}

export function isUpgradeAvailable(id) {
    const def = getUpgradeDef(id);
    if (def.tier !== undefined && gameState.tier < def.tier) return false;
    if (!def.requires) return true;
    return getUpgradeLevel(def.requires.id) >= def.requires.level;
}

export function canAfford(id) {
    return gameState.ore >= getUpgradeCost(id);
}

export function isMaxed(id) {
    const def = getUpgradeDef(id);
    return def.maxLevel !== null && getUpgradeLevel(id) >= def.maxLevel;
}

export function canBuy(id) {
    return !isMaxed(id) && isUpgradeAvailable(id) && canAfford(id);
}

export function buyUpgrade(id) {
    if (!canBuy(id)) return false;
    gameState.ore -= getUpgradeCost(id);
    gameState.levels[id] = getUpgradeLevel(id) + 1;
    return true;
}

// ---------- Видимость улучшений ----------
// Игрок видит: доступные (требования выполнены) + уже купленные (ур. > 0) +
// первое недоступное в каждой цепочке требований («скоро можно будет купить»).
// Цепочки: кирка→кувалда→гидропресс→... и шахтёр→бур→экскаватор→... — линейные,
// корень цепочки = улучшение без `requires`.

function upgradeChainRoot(id) {
    let cur = id;
    let def = getUpgradeDef(cur);
    while (def && def.requires) {
        cur = def.requires.id;
        def = getUpgradeDef(cur);
    }
    return cur;
}

export function isUpgradeVisible(id) {
    if (isUpgradeAvailable(id)) return true;
    if (getUpgradeLevel(id) > 0) return true;
    // Первое недоступное в своей цепочке — «следующее», показываем как анонс
    const root = upgradeChainRoot(id);
    for (const u of UPGRADES) {
        if (upgradeChainRoot(u.id) !== root) continue;
        if (!isUpgradeAvailable(u.id)) return u.id === id;
    }
    return false;
}

export function getVisibleUpgrades(tab) {
    return UPGRADES.filter((u) => u.tab === tab && isUpgradeVisible(u.id));
}

// ---------- Мультипокупка ----------
// x1/x10/x100 — СТРОГИЕ пакеты: покупается ровно запрошенное количество уровней
// (ужимается только лимитом улучшения), иначе покупка не проходит вовсе.
// 'max' — покупает максимум уровней, на которые хватает руды.
// getBulkCost — стоимость полного пакета (для цены в UI независимо от баланса);
// getAffordableBulk — сколько реально купится; buyBulk исполняет покупку.

export const BULK_MAX = 'max';

export function getBulkCost(id, want) {
    const def = getUpgradeDef(id);
    const tier = TIER_COST_MULT(gameState.tier);
    const start = getUpgradeLevel(id);
    const n = limitByMaxLevel(def, start, want);
    let total = 0;
    for (let i = 0; i < n; i++) {
        total += costAtLevel(def, start + i, tier);
    }
    return { n, total };
}

export function getAffordableBulk(id, want) {
    const def = getUpgradeDef(id);
    const tier = TIER_COST_MULT(gameState.tier);
    const start = getUpgradeLevel(id);
    const cap = limitByMaxLevel(def, start, want);
    let budget = gameState.ore;
    let n = 0,
        total = 0;
    while (n < cap) {
        const cost = costAtLevel(def, start + n, tier);
        // Infinity-бюджет (битый сейв, ore: 1e999 -> Infinity) или Infinity-цена
        // (переполнение pow) ломают сравнения и вешают цикл навсегда — выходим
        if (!isFinite(budget) || !isFinite(cost) || budget < cost) break;
        budget -= cost;
        total += cost;
        n++;
    }
    return { n, total };
}

export function buyBulk(id, want) {
    if (!isUpgradeAvailable(id) || isMaxed(id)) return false;
    const def = getUpgradeDef(id);
    const remaining = def.maxLevel === null ? Infinity : def.maxLevel - getUpgradeLevel(id);
    const isMax = want === BULK_MAX;
    const r = getAffordableBulk(id, isMax ? Infinity : want);
    if (r.n <= 0) return false;
    // Строгий пакет: нужно купить ровно min(want, остаток до лимита)
    if (!isMax && r.n < Math.min(want, remaining)) return false;
    gameState.ore -= r.total;
    gameState.levels[id] = getUpgradeLevel(id) + r.n;
    return true;
}
