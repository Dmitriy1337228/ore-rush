// Ролл клика: крит, золотая жила, синергия, мутации блока и бафы.

import { MUTATIONS } from './catalog/meta.js';
import { getClickDamage, getSynergyGain, getCritChance, getLuckyChance, getCritMult, getVeinMult } from './income.js';
import { getDailyMult, getItemBuffMult, isDailyVeinActive, isItemVeinActive } from './buffs.js';

// Один клик: базовый урон + крит x5(+линза) + золотая жила x10(+магнит) + синергия (% от пассива).
// mutationId — активная мутация блока: замороженная форсирует крит, радужная множит весь доход.
// Дневные бафы: «Золотая жила» форсирует жилу, множитель бафа применяется к итогу.
// Предметные бафы так же: стимулятор форсирует жилу, множитель бафа к итогу (как dailyMult).
// extraCrit — плоская прибавка к шансу крита (боевой баф «Точильный камень»).
export function rollClickGain(mutationId, extraCrit = 0) {
    let gain = getClickDamage() + getSynergyGain();
    const mut = mutationId ? MUTATIONS[mutationId] : null;
    const crit = (mut && mut.forceCrit) || Math.random() < Math.min(1, getCritChance() + extraCrit);
    const lucky = isDailyVeinActive() || isItemVeinActive() || Math.random() < getLuckyChance();
    if (crit) gain *= getCritMult();
    if (lucky) gain *= getVeinMult();
    if (mut && mut.clickGainMult) gain *= mut.clickGainMult;
    gain *= getDailyMult();
    gain *= getItemBuffMult();
    return { gain, crit, lucky };
}

// Бонус взрывной мутации при разрушении блока: N урона клика
export function getMutationBreakBonus(mutationId) {
    const mut = mutationId ? MUTATIONS[mutationId] : null;
    return mut && mut.breakBonusMult ? getClickDamage() * mut.breakBonusMult : 0;
}
