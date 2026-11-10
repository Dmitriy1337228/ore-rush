// Симулятор баланса: импортирует РЕАЛЬНУЮ экономику из src/state.js.
// Жадная закупка (лучший ROI), спуск когда unlock дешевле любой осмысленной
// закупки или исчерпан лимит терпения (150 закупок на тир).
// Запуск: node scripts/balance-sim.mjs [cps] [maxHours]
import {
    gameState, UPGRADES, TIERS, addOre, resetGame,
    getUpgradeLevel, getUpgradeCost,
    canBuy, buyUpgrade,
    getClickDamage, getOrePerSecond, getAutoClicksPerSecond,
    getCritChance, getLuckyChance,
    unlockTier, TIER_INCOME_MULT, getPrestigeMult, getNextUnlockPrice, unlockSecondsFor
} from '../src/state.js';

const ARGS = process.argv.slice(2);
const CPS_MANUAL = Number(ARGS[0] || 3.5);
const MAX_H = Number(ARGS[1] || 60);
const DT = 1;
const PATIENCE = 150;

function techMult() { return Math.pow(1.25, getUpgradeLevel('tech')) * Math.pow(1.3, getUpgradeLevel('aicore')); }
function critMult() { return 5 + 0.5 * getUpgradeLevel('focuslens'); }
function veinMult() { return 10 + 1 * getUpgradeLevel('magnet'); }
function critF() { return 1 + getCritChance() * (critMult() - 1); }
function veinF() { return 1 + getLuckyChance() * (veinMult() - 1); }
function synergy() { return getOrePerSecond() * 0.01 * getUpgradeLevel('resonance'); }
function cpsTotal() { return CPS_MANUAL + getAutoClicksPerSecond(); }
function clickIncome() { return (getClickDamage() + synergy()) * critF() * veinF() * cpsTotal(); }
// множители пассива: техника+ИИ + тир + престиж
function passiveMult() { return techMult() * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult(); }
// множители клика: кувалда-цепочка * тир * престиж
function clickChain() {
    return Math.pow(1.5, getUpgradeLevel('sledge'))
        * Math.pow(1.6, getUpgradeLevel('hydraulic'))
        * Math.pow(1.7, getUpgradeLevel('plasma'))
        * Math.pow(1.8, getUpgradeLevel('disintegrator'))
        * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult();
}

// прирост дохода/сек от +1 уровня улучшения id (приближение для жадной закупки)
function deltaIncome(id) {
    const dmg = getClickDamage();
    const syn = synergy();
    switch (id) {
        case 'pickaxe':   return clickChain() * critF() * veinF() * cpsTotal();
        case 'sledge':    return dmg * 0.5 * critF() * veinF() * cpsTotal();
        case 'hydraulic': return dmg * 0.6 * critF() * veinF() * cpsTotal();
        case 'plasma':    return dmg * 0.7 * critF() * veinF() * cpsTotal();
        case 'disintegrator': return dmg * 0.8 * critF() * veinF() * cpsTotal();
        case 'miner':     return 1 * passiveMult();
        case 'drill':     return 10 * passiveMult();
        case 'excavator': return 100 * passiveMult();
        case 'factory':   return 1000 * passiveMult();
        case 'quarry':    return 1e4 * passiveMult();
        case 'megafactory': return 1e5 * passiveMult();
        case 'orbital':   return 1e6 * passiveMult();
        case 'quantumlab': return 1e7 * passiveMult();
        case 'wormhole':  return 1e8 * passiveMult();
        case 'singularity': return 1e9 * passiveMult();
        case 'dyson':     return 1e10 * passiveMult();
        case 'tech':      return getOrePerSecond() * 0.25;
        case 'aicore':    return getOrePerSecond() * 0.3;
        case 'dynamite':  { const c = Math.min(0.05 + 0.03 * (getUpgradeLevel('dynamite') + 1), 0.74) - getCritChance(); return (dmg + syn) * c * (critMult() - 1) * veinF() * cpsTotal(); }
        case 'lucky':     { const v = Math.min(0.02 * (getUpgradeLevel('lucky') + 1), 0.5) - getLuckyChance(); return (dmg + syn) * v * (veinMult() - 1) * critF() * cpsTotal(); }
        case 'resonance': return getOrePerSecond() * 0.01 * critF() * veinF() * cpsTotal();
        case 'focuslens': return (dmg + syn) * getCritChance() * 0.25 * veinF() * cpsTotal();
        case 'magnet':    return (dmg + syn) * getLuckyChance() * critF() * cpsTotal();
        case 'lantern':   return 0;
        case 'warehouse': return 0;
    }
    return 0;
}

let time = 0;
let tierStart = 0;
let buysThisTier = 0; // лимит терпения считается НА ТИР, не на шаг сима
const durations = [];
const buys = {};

resetGame();

while (gameState.tier < TIERS.length - 1 && time < MAX_H * 3600) {
    // доход за шаг: пассив + ожидание кликов + авто-клики
    addOre(getOrePerSecond() * DT);
    addOre(clickIncome() * DT);
    time += DT;

    // жадная закупка: лучший ROI из доступных. Спуск: unlock дешевле любой
    // осмысленной закупки ИЛИ лимит терпения исчерпан (иначе положительная
    // обратная связь «кирка <-> цепочка множителей» разгоняет доход до Infinity).
    for (let guard = 0; guard < 60; guard++) {
        // Рациональный игрок: покупает только улучшения с окупаемостью быстрее
        // ожидания спуска (payback <= N секунд текущего дохода)
        const maxPayback = unlockSecondsFor(gameState.tier);
        let best = null, bestRoi = 0;
        for (const def of UPGRADES) {
            if (!canBuy(def.id)) continue;
            const d = deltaIncome(def.id);
            const c = getUpgradeCost(def.id);
            if (d > 0 && c / d <= maxPayback) {
                const roi = d / c;
                if (roi > bestRoi) { bestRoi = roi; best = def.id; }
            }
        }
        const uc = getNextUnlockPrice();
        const canDescend = uc != null && gameState.ore >= uc;
        if (canDescend && (!best || buysThisTier >= PATIENCE)) {
            durations.push({ tier: gameState.tier, dur: time - tierStart });
            tierStart = time;
            unlockTier();
            buysThisTier = 0;
            break;
        }
        if (!best || buysThisTier >= PATIENCE) break; // лимит терпения: ко-петля
        // кликовой цепочки не даёт остановиться на фильтре окупаемости
        buyUpgrade(best);
        buys[best] = (buys[best] || 0) + 1;
        buysThisTier++;
    }
}

console.log('тир  руда       длительность');
const NAMES = TIERS.map((t) => t.name);
for (const d of durations) {
    console.log(`${String(d.tier).padStart(2)} ${NAMES[d.tier].padEnd(8)} ${((d.dur / 60).toFixed(1)).padStart(9)} мин`);
}
if (gameState.tier < TIERS.length - 1) console.log(`!! оборвалась на ${MAX_H}ч, тир ${gameState.tier} (${NAMES[gameState.tier]})`);
const totalBuys = Object.values(buys).reduce((a, b) => a + b, 0);
console.log(`Итого до алмазов: ${(time / 3600).toFixed(1)} ч активной игры, покупок: ${totalBuys}`);
