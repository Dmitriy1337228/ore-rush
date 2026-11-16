// Оценка прироста дохода от улучшений: матрица выбора «бесплатного улучшения»
// и общий инструмент баланса (та же математика, что в scripts/balance-sim.mjs).

import { UPGRADES } from './catalog/upgrades.js';
import { TIER_INCOME_MULT } from './catalog/tiers.js';
import {
    CLICK_MULT_STEPS,
    PASSIVE_ORE_STEPS,
    PASSIVE_MULT_STEPS,
    MANUAL_CPS_ASSUME,
    SYNERGY_PER_LEVEL,
    FOCUSLENS_GAIN_ESTIMATE
} from './catalog/balance.js';
import { gameState } from './gameState.js';
import { getUpgradeLevel, getUpgradeCost, isMaxed, isUpgradeAvailable } from './upgrades.js';
import {
    getClickDamage,
    getClickChainMult,
    getPassiveTechMult,
    getOrePerSecond,
    getSynergyGain,
    getAutoClicksPerSecond,
    getCritChance,
    getLuckyChance,
    getCritMult,
    getVeinMult,
    getCritFactor,
    getVeinFactor,
    getPrestigeMult,
    critChanceForLevel,
    luckyChanceForLevel
} from './income.js';

// Прирост дохода/сек от +1 уровня улучшения id при manualCps ручных кликах/сек.
export function upgradeIncomeDelta(id, manualCps = MANUAL_CPS_ASSUME) {
    const dmg = getClickDamage();
    const syn = getSynergyGain();
    const cps = getAutoClicksPerSecond() + manualCps;
    const critF = getCritFactor();
    const veinF = getVeinFactor();
    const tierPrestige = (chain) => chain * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult();

    if (id === 'pickaxe') return tierPrestige(getClickChainMult()) * critF * veinF * cps;

    const clickStep = CLICK_MULT_STEPS.find((s) => s.id === id);
    if (clickStep) return dmg * clickStep.gain * critF * veinF * cps;

    const passiveOre = PASSIVE_ORE_STEPS.find((s) => s.id === id);
    if (passiveOre) return passiveOre.perLevel * tierPrestige(getPassiveTechMult());

    const passiveMult = PASSIVE_MULT_STEPS.find((s) => s.id === id);
    if (passiveMult) return getOrePerSecond() * passiveMult.gain;

    switch (id) {
        case 'dynamite': {
            const c = critChanceForLevel(getUpgradeLevel('dynamite') + 1) - getCritChance();
            return (dmg + syn) * c * (getCritMult() - 1) * veinF * cps;
        }
        case 'lucky': {
            const v = luckyChanceForLevel(getUpgradeLevel('lucky') + 1) - getLuckyChance();
            return (dmg + syn) * v * (getVeinMult() - 1) * critF * cps;
        }
        case 'resonance':
            return getOrePerSecond() * SYNERGY_PER_LEVEL * critF * veinF * cps;
        case 'focuslens':
            return (dmg + syn) * getCritChance() * FOCUSLENS_GAIN_ESTIMATE * veinF * cps;
        case 'magnet':
            return (dmg + syn) * getLuckyChance() * critF * cps;
        // lantern/warehouse (офлайн) и каска (живучесть) на онлайн-доход не влияют
        default:
            return 0;
    }
}

// Лучшее доступное улучшение для «Бесплатного улучшения»: максимум прироста
// дохода на единицу цены среди доступных (гейты/цепочки/капы соблюдены) —
// полезно на любом тире по построению.
export function pickFreeUpgrade() {
    let best = null,
        bestRoi = 0;
    for (const def of UPGRADES) {
        if (isMaxed(def.id) || !isUpgradeAvailable(def.id)) continue;
        const d = upgradeIncomeDelta(def.id);
        if (d <= 0) continue;
        const roi = d / getUpgradeCost(def.id);
        if (roi > bestRoi) {
            bestRoi = roi;
            best = def;
        }
    }
    return best;
}
