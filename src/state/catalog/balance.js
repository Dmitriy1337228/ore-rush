// Числовая настройка эффектов улучшений (баланс): единый источник для
// формул дохода, оценки прироста («бесплатное улучшение») и симулятора.
// Лист-модуль.

// ---------- Клик: цепочка множителей урона ----------
// mult — множитель за уровень; gain — прирост доли дохода от +1 уровня
// (mult - 1, записан явно: 1.6 - 1 даёт 0.6000000000000001 и сдвинул бы оценку).
export const CLICK_MULT_STEPS = [
    { id: 'sledge', mult: 1.5, gain: 0.5 },
    { id: 'hydraulic', mult: 1.6, gain: 0.6 },
    { id: 'plasma', mult: 1.7, gain: 0.7 },
    { id: 'disintegrator', mult: 1.8, gain: 0.8 }
];
export const PICKAXE_BASE_DAMAGE = 1;

// ---------- Пассив: плоская добыча машин (руда/сек за уровень) ----------
export const PASSIVE_ORE_STEPS = [
    { id: 'miner', perLevel: 1 },
    { id: 'drill', perLevel: 10 },
    { id: 'excavator', perLevel: 100 },
    { id: 'factory', perLevel: 1000 },
    { id: 'quarry', perLevel: 1e4 },
    { id: 'megafactory', perLevel: 1e5 },
    { id: 'orbital', perLevel: 1e6 },
    { id: 'quantumlab', perLevel: 1e7 },
    { id: 'wormhole', perLevel: 1e8 },
    { id: 'singularity', perLevel: 1e9 },
    { id: 'dyson', perLevel: 1e10 }
];

// ---------- Пассив: множители (техника, ИИ-ядро) ----------
export const PASSIVE_MULT_STEPS = [
    { id: 'tech', mult: 1.25, gain: 0.25 },
    { id: 'aicore', mult: 1.3, gain: 0.3 }
];

// ---------- Авто-клик, синергия ----------
export const AUTO_CLICKS_PER_ROBOARM = 0.5;
export const SYNERGY_PER_LEVEL = 0.01; // клик +1% от пассива за уровень
// Активный игрок для оценки цены спуска: ~3 ручных клика/сек (константа дизайна —
// state не измеряет реальный темп кликов, но цена должна покрывать кликовый доход).
export const MANUAL_CPS_ASSUME = 3;

// ---------- Крит и жила ----------
export const CRIT_BASE_CHANCE = 0.05;
export const CRIT_CHANCE_PER_DYNAMITE = 0.03;
export const CRIT_CHANCE_CAP = 0.74;
export const CRIT_CHANCE_CAP_WITH_DAILY = 0.95; // «Критический импульс»: всегда остаётся шанс промаха
export const CRIT_BASE_MULT = 5;
export const CRIT_MULT_PER_FOCUSLENS = 0.5;
// Оценка прироста «Фокус-линзы» в upgradeIncomeDelta: исторически 0.25, а не
// реальные 0.5 за уровень (занижено сознательно — не менять без ребаланса)
export const FOCUSLENS_GAIN_ESTIMATE = 0.25;

export const LUCKY_CHANCE_PER_LEVEL = 0.02;
export const LUCKY_CHANCE_CAP = 0.5;
export const VEIN_BASE_MULT = 10;
export const VEIN_MULT_PER_MAGNET = 1;

// ---------- Престиж ----------
export const PRESTIGE_REQUIREMENT = 1e12; // алмазов за забег (масштаб 12 тиров x3 дохода)
export const STAR_BONUS = 0.1; // +10% ко всему доходу за звезду
