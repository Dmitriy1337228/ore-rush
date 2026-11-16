// Формулы дохода: урон клика, пассивная добыча, крит/жила, синергия, престиж-множитель.
// Чистые геттеры от gameState — без побочных эффектов.

import { gameState } from './gameState.js';
import { TIER_INCOME_MULT } from './catalog/tiers.js';
import { DAILY_CRIT_BONUS } from './catalog/daily.js';
import {
    CLICK_MULT_STEPS,
    PICKAXE_BASE_DAMAGE,
    PASSIVE_ORE_STEPS,
    PASSIVE_MULT_STEPS,
    AUTO_CLICKS_PER_ROBOARM,
    SYNERGY_PER_LEVEL,
    MANUAL_CPS_ASSUME,
    CRIT_BASE_CHANCE,
    CRIT_CHANCE_PER_DYNAMITE,
    CRIT_CHANCE_CAP,
    CRIT_CHANCE_CAP_WITH_DAILY,
    CRIT_BASE_MULT,
    CRIT_MULT_PER_FOCUSLENS,
    LUCKY_CHANCE_PER_LEVEL,
    LUCKY_CHANCE_CAP,
    VEIN_BASE_MULT,
    VEIN_MULT_PER_MAGNET,
    STAR_BONUS
} from './catalog/balance.js';
import { getUpgradeLevel } from './upgrades.js';
import { getArtifactBonus, getDailyMult, getItemBuffMult, isDailyCritActive } from './buffs.js';

// Произведение степеней mult^уровень по цепочке шагов (кувалда→…, техника→…).
function chainProduct(steps) {
    return steps.reduce((acc, step) => acc * Math.pow(step.mult, getUpgradeLevel(step.id)), 1);
}

// Множитель цепочки клика (кувалда·гидропресс·плазма·расщепитель), без тира/престижа.
export function getClickChainMult() {
    return chainProduct(CLICK_MULT_STEPS);
}

// Множитель пассива техники/ИИ-ядра, без тира/престижа.
export function getPassiveTechMult() {
    return chainProduct(PASSIVE_MULT_STEPS);
}

// Плоская добыча машин (руда/сек), без множителей.
export function getPassiveFlatOre() {
    return PASSIVE_ORE_STEPS.reduce((acc, step) => acc + getUpgradeLevel(step.id) * step.perLevel, 0);
}

export function getPrestigeMult() {
    return 1 + STAR_BONUS * gameState.stars;
}

export function getClickDamage() {
    // в единицах текущего тира
    const base = PICKAXE_BASE_DAMAGE + getUpgradeLevel('pickaxe');
    // артефактный множитель клика — как престиж: входит и в якорь (симметрия)
    return (
        base *
        getClickChainMult() *
        TIER_INCOME_MULT(gameState.tier) *
        getPrestigeMult() *
        getArtifactBonus('clickMult')
    );
}

export function getOrePerSecond() {
    // дневной и предметный бафы («Ускорение»/пояс/кофе) применяются к фактической
    // добыче; в якорь цены спуска (getExpectedClickGain) они сознательно не входят
    return (
        getPassiveFlatOre() *
        getPassiveTechMult() *
        TIER_INCOME_MULT(gameState.tier) *
        getPrestigeMult() *
        getDailyMult() *
        getArtifactBonus('passiveMult') *
        getItemBuffMult()
    );
}

// Робо-рука: +0.5 авто-кликов в секунду за уровень; артефакт добавляет сверху.
// Авто-клик наносит полный урон клика (крит/жила), но без тряски камеры.
export function getAutoClicksPerSecond() {
    return AUTO_CLICKS_PER_ROBOARM * getUpgradeLevel('robotarm') + getArtifactBonus('autoCpsAdd');
}

// ---------- Крит и жила ----------

// Шанс крита при уровне «Динамита» (+bonusAdd), с потолком.
export function critChanceForLevel(dynamiteLevel, bonusAdd = 0) {
    return Math.min(CRIT_BASE_CHANCE + CRIT_CHANCE_PER_DYNAMITE * dynamiteLevel + bonusAdd, CRIT_CHANCE_CAP);
}

// Шанс жилы при уровне «Золотой жилы», с потолком.
export function luckyChanceForLevel(luckyLevel) {
    return Math.min(LUCKY_CHANCE_PER_LEVEL * luckyLevel, LUCKY_CHANCE_CAP);
}

export function getCritChance() {
    const base = critChanceForLevel(getUpgradeLevel('dynamite'), getArtifactBonus('critAdd'));
    // «Критический импульс» (дневная награда): потолок 95% — всегда остаётся шанс промаха по шансу
    if (isDailyCritActive()) return Math.min(base + DAILY_CRIT_BONUS, CRIT_CHANCE_CAP_WITH_DAILY);
    return base;
}

export function getLuckyChance() {
    return luckyChanceForLevel(getUpgradeLevel('lucky'));
}

// Фокус-линза: +0.5 к силе крита за уровень (x5 -> x5.5...)
export function getCritMult() {
    return CRIT_BASE_MULT + CRIT_MULT_PER_FOCUSLENS * getUpgradeLevel('focuslens');
}

// Рудный магнит: +1 к множителю жилы за уровень (x10 -> x11...)
export function getVeinMult() {
    return VEIN_BASE_MULT + VEIN_MULT_PER_MAGNET * getUpgradeLevel('magnet');
}

// Матожидание множителя от крита/жилы: 1 + p*(m-1)
export function getCritFactor() {
    return 1 + getCritChance() * (getCritMult() - 1);
}

export function getVeinFactor() {
    return 1 + getLuckyChance() * (getVeinMult() - 1);
}

// ---------- Синергия и ожидаемый доход ----------

// Синергия: прибавка к каждому клику = 1% пассивного дохода за уровень.
// Без пассива не даёт ничего — это мост между пассивными и кликовыми билдами.
export function getSynergyGain() {
    return getOrePerSecond() * SYNERGY_PER_LEVEL * getUpgradeLevel('resonance');
}

// Матожидание одного клика (крит/жила/синергия — ожидания, без рандома);
// синергия добавляется всегда.
// ВНИМАНИЕ: синергия СОЗНАТЕЛЬНО считается без множителей крита/жилы — оценка
// расходится с реальным роллом rollClickGain (там крит/жила множат весь гейн):
// на синергия-билдах реальный доход клика выше оценки до x critF*veinF (~x83 на
// максимальных вкладках). Это часть откалиброванного пейса: якорь цены спуска
// (getEarningRate) занижен, спуск наступает быстрее расчётного N(tier). «Честная»
// формула ((D+S)*critF*veinF, проверено Монте-Карло ratio 0.998) поднимает якорь
// глубоких тиров до x25 и растягивает забег с 3.7ч до 60ч+ (balance-sim) — менять
// только вместе с ребалансом UNLOCK_SECONDS_GROWTH и решением игрока
// (REVIEW_2026-11-13.md, находка [11], отложено).
export function getExpectedClickGain() {
    return getClickDamage() * getCritFactor() * getVeinFactor() + getSynergyGain();
}

// Общая скорость добычи: пассив + авто-клики + оценка ручных кликов.
// Без ручной составляющей цена спуска на клико-доминантных билдах занижается
// в сотни раз (кликовый доход доминирует с появлением кувалды-цепочки).
export function getEarningRate() {
    return getOrePerSecond() + (getAutoClicksPerSecond() + MANUAL_CPS_ASSUME) * getExpectedClickGain();
}
