// Игровое состояние, экономика тиров, улучшения, престиж, офлайн-доход, сохранение.
// Сохранение — через YandexSDKStub.player.setData/getData (физически localStorage
// 'ore-rush-save', миграция со старого ключа — в стабе), время выхода — через
// YandexSDKStub (player.setStats/getStats, localStorage-mock) + ключ 'ore-rush-lastExit'.

import { YandexSDKStub, SAVE_STORAGE_KEY } from './sdk-stub.js';

// Ключ сейва теперь принадлежит стабу (основной слот — player.setData/getData);
// SAVE_KEY оставлен как алиас для тестов/DevPanel, чтобы не менять контракт.
export const SAVE_KEY = SAVE_STORAGE_KEY;
export const LAST_EXIT_KEY = 'ore-rush-lastExit';
// Фолбэк старого имени игры (переименование 2026-11-13): офлайн-время игроков
// с прошлым ключом не должно пропасть
export const LEGACY_LAST_EXIT_KEY = 'minecraft-clicker-lastExit';
export const SAVE_VERSION = 4;

// ---------- Тиры руды ----------

export const TIERS = [
    // Спуск стоит руду текущего тира; после спуска добывается только новая руда.
    // Цена спуска НЕ статична: она фиксируется при входе в тир как N секунд
    // текущего дохода (см. UNLOCK_* ниже) — статические кривые при внутренней
    // прокачке либо пролетаются (цены отстают от богатства), либо становятся
    // стеной (цены убегают).
    { key: 'coal',     name: 'Уголь',     gen: 'угля',       adj: 'угольным',      iconKey: 'coal_nugget',     blockPrefix: 'block',      floatColor: '#ffffff'  },
    { key: 'copper',   name: 'Медь',      gen: 'меди',       adj: 'медным',        iconKey: 'copper_nugget',   blockPrefix: 'copper',     floatColor: '#f0985e'  },
    { key: 'iron',     name: 'Железо',    gen: 'железа',     adj: 'железным',      iconKey: 'iron_nugget',     blockPrefix: 'iron',       floatColor: '#cfd8e3'  },
    { key: 'silver',   name: 'Серебро',   gen: 'серебра',    adj: 'серебряным',    iconKey: 'silver_nugget',   blockPrefix: 'silver',     floatColor: '#eeeded'  },
    { key: 'gold',     name: 'Золото',    gen: 'золота',     adj: 'золотым',       iconKey: 'gold_nugget',     blockPrefix: 'gold',       floatColor: '#ffd75e'  },
    { key: 'amethyst', name: 'Аметист',   gen: 'аметиста',   adj: 'аметистовым',   iconKey: 'amethyst_nugget', blockPrefix: 'amethyst',   floatColor: '#d9a2ff'  },
    { key: 'emerald',  name: 'Изумруд',   gen: 'изумруда',   adj: 'изумрудным',    iconKey: 'emerald_nugget',  blockPrefix: 'emerald',    floatColor: '#7ee787'  },
    { key: 'ruby',     name: 'Рубин',     gen: 'рубина',     adj: 'рубиновым',     iconKey: 'ruby_nugget',     blockPrefix: 'ruby',       floatColor: '#f0638c'  },
    { key: 'sapphire', name: 'Сапфир',    gen: 'сапфира',    adj: 'сапфировым',    iconKey: 'sapphire_nugget', blockPrefix: 'sapphire',   floatColor: '#63b4ff'  },
    { key: 'platinum', name: 'Платина',   gen: 'платины',    adj: 'платиновым',    iconKey: 'platinum_nugget', blockPrefix: 'platinum',   floatColor: '#eae6d9'  },
    { key: 'uranium',  name: 'Уранит',    gen: 'уранита',    adj: 'урановым',      iconKey: 'uranium_nugget',  blockPrefix: 'uranium',    floatColor: '#b7ff47'  },
    { key: 'diamond',  name: 'Алмаз',     gen: 'алмаза',     adj: 'алмазным',      iconKey: 'diamond_nugget',  blockPrefix: 'diamond',    floatColor: '#7ee7ff'  }
];

// Цены улучшений ×3 за тир (TIER_COST_MULT), доход ×3 (TIER_INCOME_MULT):
// окупаемость улучшений инвариантна тиру — покупки одинаково выгодны на всей
// лестнице; темп прогрессии задаёт рост требований спуска (UNLOCK_SECONDS_GROWTH).
export const TIER_STEP = {
    // cost = income (3.0): окупаемость улучшений инвариантна тиру. Раньше цены
    // росли медленнее дохода (2.5 vs 3) — на глубине всё становилось на 17x/тир
    // дешевле относительно дохода, и накопленный каталог взрывал внутр-тировой
    // разгон (блиц спуска даже с гейтами глубины).
    cost: 3.0,
    income: 3
};
export const TIER_COST_MULT = (tier) => Math.pow(TIER_STEP.cost, tier);
export const TIER_INCOME_MULT = (tier) => Math.pow(TIER_STEP.income, tier);

// ---------- Цена спуска (снапшот при входе) ----------
// Цена = N секунд дохода-якоря, зафиксированного ПРИ ВХОДЕ В ТИР
// (gameState.tierAnchorRate), и НЕ меняется до следующего спуска.
// Пока прокачка не купила всё, доступное на тире, каждая покупка строго
// приближает спуск (цена константна, дефицит тает) — и покупка никогда не
// «отбрасывает» накопления. «Переход неизбежен» возникает сам: каталог тира
// ограничен гейтами tier (см. UPGRADES), внутри-тировой разгон ограничен
// десятками раз, после выкупа доступного спуск наступает за минуты.
// Заморозки/догона нет; углубление тиров — ростом N (UNLOCK_SECONDS_GROWTH 2.95 за тир).
export const UNLOCK_BASE_SECONDS = 180;    // спуск из тира 0 стоит 180 сек дохода
export const UNLOCK_SECONDS_GROWTH = 2.95; // требования растут за каждый тир
export const UNLOCK_FLOOR = 2500;          // минимум (старт с нулевым доходом)

export function unlockSecondsFor(tier) {
    return UNLOCK_BASE_SECONDS * Math.pow(UNLOCK_SECONDS_GROWTH, tier);
}

// Синергия: прибавка к каждому клику = 1% пассивного дохода за уровень.
// Без пассива не даёт ничего — это мост между пассивными и кликовыми билдами.
export function getSynergyGain() {
    return getOrePerSecond() * 0.01 * getUpgradeLevel('resonance');
}

// Матожидание одного клика (крит/жила/синергия — ожидания, без рандома):
// E-множитель крита = 1 + p*(m-1), жилы так же; синергия добавляется всегда.
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
    const critMult = 5 + 0.5 * getUpgradeLevel('focuslens');
    const veinMult = 10 + 1 * getUpgradeLevel('magnet');
    const critF = 1 + getCritChance() * (critMult - 1);
    const veinF = 1 + getLuckyChance() * (veinMult - 1);
    return getClickDamage() * critF * veinF + getSynergyGain();
}

// Активный игрок для оценки цены спуска: ~3 ручных клика/сек (константа дизайна —
// state.js не измеряет реальный темп кликов, но цена должна покрывать кликовый доход).
export const MANUAL_CPS_ASSUME = 3;

// Общая скорость добычи: пассив + авто-клики + оценка ручных кликов.
// Без ручной составляющей цена спуска на клико-доминантных билдах занижается
// в сотни раз (кликовый доход доминирует с появлением кувалды-цепочки).
export function getEarningRate() {
    return getOrePerSecond() + (getAutoClicksPerSecond() + MANUAL_CPS_ASSUME) * getExpectedClickGain();
}

// Якорь дохода текущего тира: фиксируется при входе (unlockTier / forceNextTier /
// doPrestige) либо лениво при первом обращении (новая игра, сейв старой версии).
// 0/NaN = «ещё не зафиксирован».
export function resetTierAnchor() {
    gameState.tierAnchorRate = 0;
}

function getTierAnchorRate() {
    const a = Number(gameState.tierAnchorRate);
    if (!(a > 0) || !isFinite(a)) {
        gameState.tierAnchorRate = Math.max(getEarningRate(), 1e-9);
    }
    return gameState.tierAnchorRate;
}

// Время до спуска при текущей ставке добычи, сек (оценка для активного игрока).
// Используется для ETA на кнопке спуска и фильтра «окупаемость» в симуляторе.
export function getUnlockEtaSeconds() {
    if (gameState.tier >= TIERS.length - 1) return null;
    const price = getNextUnlockPrice();
    const deficit = Math.max(0, price - gameState.ore);
    return deficit / Math.max(getEarningRate(), 1e-9);
}

// Цена спуска из тира `tier` в `tier + 1`; null для последнего тира.
// Снапшот от якоря (доход при входе): см. блок UNLOCK_* выше.
export function computeNextUnlockPrice(tier) {
    if (tier >= TIERS.length - 1) return null;
    const anchor = getTierAnchorRate();
    const byRate = unlockSecondsFor(tier) * anchor;
    return Math.ceil(Math.max(UNLOCK_FLOOR * getPrestigeMult(), byRate));
}

// Текущая цена спуска.
export function getNextUnlockPrice() {
    return computeNextUnlockPrice(gameState.tier);
}

// ---------- Улучшения ----------
// tier — минимальный уровень шахты для покупки (гейт глубины). Глубокие машины
// и множители открываются по мере спуска: каждый тир даёт следующую ступень
// машинной цепочки, внутри-тировой разгон дохода ограничен (~десятки раз),
// поэтому цена спуска может быть чистым снапшотом — без догона и без заморозки.

export const UPGRADES = [
    // --- ОБОРУДОВАНИЕ (Оборудование): урон клика ---
    // Капы на кликовой цепочке: ко-петля «кирка (+1 flat) ↔ множители» без капов
    // даёт бесконечный ROI на любом тире (накопленная кирка умножается всей
    // цепочкой) и взрывает внутр-тировой разгон. Конечный потолок клика ->
    // поздняя игра опирается на машины. Гейты tier размазаны по лестнице:
    // каждый спуск открывает ступень машин и/или звено цепочки — сопоставимый
    // прирост инструмента на каждом тире (без «тонких» тиров-стен).
    { id: 'pickaxe',   name: 'Кирка',              icon: null,               tab: 'equipment', baseCost: 15,      growth: 2.0, maxLevel: 30, effect: '+1 руда за клик' },
    { id: 'sledge',    name: 'Кувалда',            icon: 'icon_hammer',      tab: 'equipment', baseCost: 500,     growth: 2.5,  maxLevel: 10, effect: 'урон клика x1.5' },
    { id: 'hydraulic', name: 'Гидропресс',         icon: 'icon_hydraulic',   tab: 'equipment', baseCost: 8000,    growth: 3.5,  maxLevel: 8, tier: 2, requires: { id: 'sledge', level: 5 }, effect: 'урон клика x1.6' },
    { id: 'plasma',    name: 'Плазменный резак',   icon: 'icon_plasma',      tab: 'equipment', baseCost: 120000,  growth: 4.5,  maxLevel: 6, tier: 6, requires: { id: 'hydraulic', level: 5 }, effect: 'урон клика x1.7' },
    { id: 'disintegrator', name: 'Расщепитель',    icon: 'icon_disintegrator', tab: 'equipment', baseCost: 1.5e6, growth: 5.5, maxLevel: 5, tier: 8, requires: { id: 'plasma', level: 5 }, effect: 'урон клика x1.8' },

    // --- ОБОРУДОВАНИЕ (Оборудование): пассивная добыча ---
    { id: 'miner',     name: 'Шахтёр',             icon: 'miner_portrait',   tab: 'equipment', baseCost: 60,      growth: 2.0, maxLevel: null, effect: '+1 руда/сек' },
    { id: 'robotarm',  name: 'Робо-рука',          icon: 'icon_robot_arm',   tab: 'equipment', baseCost: 5000,    growth: 1.8,  maxLevel: null, effect: 'Авто-клик: 0.5/сек' },
    { id: 'drill',     name: 'Бур',                icon: 'icon_drill',       tab: 'equipment', baseCost: 600,     growth: 1.6,  maxLevel: null, tier: 1, requires: { id: 'miner', level: 5 }, effect: '+10 руды/сек' },
    { id: 'excavator', name: 'Экскаватор',         icon: 'icon_excavator',   tab: 'equipment', baseCost: 6000,    growth: 1.7,  maxLevel: null, tier: 2, requires: { id: 'drill', level: 5 }, effect: '+100 руды/сек' },
    { id: 'factory',   name: 'Фабрика',            icon: 'icon_factory',     tab: 'equipment', baseCost: 60000,   growth: 1.8,  maxLevel: null, tier: 3, requires: { id: 'excavator', level: 5 }, effect: '+1000 руды/сек' },
    { id: 'quarry',    name: 'Карьер',             icon: 'icon_quarry',      tab: 'equipment', baseCost: 6e5,     growth: 1.85, maxLevel: null, tier: 4, requires: { id: 'factory', level: 5 }, effect: '+10K руды/сек' },
    { id: 'megafactory', name: 'Мега-фабрика',     icon: 'icon_megafactory', tab: 'equipment', baseCost: 6e6,     growth: 1.9,  maxLevel: null, tier: 5, requires: { id: 'quarry', level: 5 }, effect: '+100K руды/сек' },
    { id: 'orbital',   name: 'Орбитальная станция', icon: 'icon_orbital',   tab: 'equipment', baseCost: 6e7,     growth: 1.95, maxLevel: null, tier: 6, requires: { id: 'megafactory', level: 5 }, effect: '+1M руды/сек' },
    { id: 'quantumlab', name: 'Квантовая лаборатория', icon: 'icon_quantumlab', tab: 'equipment', baseCost: 6e8,  growth: 2.0,  maxLevel: null, tier: 7, requires: { id: 'orbital', level: 5 }, effect: '+10M руды/сек' },
    { id: 'wormhole',  name: 'Червоточина',        icon: 'icon_wormhole', tab: 'equipment', baseCost: 6e9,   growth: 2.1,  maxLevel: null, tier: 8, requires: { id: 'quantumlab', level: 5 }, effect: '+100M руды/сек' },
    { id: 'singularity', name: 'Гравитационный резак', icon: 'icon_singularity', tab: 'equipment', baseCost: 6e10, growth: 2.2, maxLevel: null, tier: 9, requires: { id: 'wormhole', level: 5 }, effect: '+1B руды/сек' },
    { id: 'dyson',     name: 'Сфера Дайсона',      icon: 'icon_dyson',       tab: 'equipment', baseCost: 6e11,    growth: 2.3,  maxLevel: null, tier: 10, requires: { id: 'singularity', level: 5 }, effect: '+10B руды/сек' },
    { id: 'tech',      name: 'Техника',            icon: 'gear_icon',        tab: 'equipment', baseCost: 8000,    growth: 5,    maxLevel: null, effect: 'пассив x1.25' },
    { id: 'aicore',    name: 'ИИ-ядро',            icon: 'icon_aicore',      tab: 'equipment', baseCost: 5e5,     growth: 7,    maxLevel: null, tier: 5, requires: { id: 'tech', level: 5 }, effect: 'пассив x1.3' },

    // --- УСИЛЕНИЯ (Усиления) ---
    { id: 'dynamite',  name: 'Динамит',            icon: 'dynamite_bundle',  tab: 'enhance',   baseCost: 100,     growth: 2.2,  maxLevel: 23,   effect: '+3% крит x5 (до 74%)' },
    { id: 'lucky',     name: 'Золотая жила',       icon: 'icon_vein',        tab: 'enhance',   baseCost: 1500,    growth: 3,    maxLevel: 25,   effect: '+2% шанс x10 (до 50%)' },
    { id: 'resonance', name: 'Синергия',           icon: 'hand_cursor',      tab: 'enhance',   baseCost: 2500,    growth: 2,    maxLevel: 25,   effect: 'клик +1% от пассива' },
    { id: 'focuslens', name: 'Фокус-линза',        icon: 'icon_focuslens',   tab: 'enhance',   baseCost: 50000,   growth: 4,    maxLevel: 10,   tier: 3, requires: { id: 'dynamite', level: 15 }, effect: '+0.5 к силе крита' },
    { id: 'magnet',    name: 'Рудный магнит',      icon: 'icon_magnet',      tab: 'enhance',   baseCost: 150000,  growth: 4,    maxLevel: 5,    tier: 4, requires: { id: 'lucky', level: 15 }, effect: '+1 к множителю жилы' },
    { id: 'lantern',   name: 'Фонарь',             icon: 'icon_lantern',     tab: 'enhance',   baseCost: 300,     growth: 2.5,  maxLevel: 10,   effect: '+8% фонового дохода' },
    { id: 'warehouse', name: 'Склад',              icon: 'icon_warehouse',   tab: 'enhance',   baseCost: 1000,    growth: 10,   maxLevel: 3,    effect: 'запас: до 24 ч' }
];

export const OFFLINE_CAP_HOURS = [4, 8, 12, 24];
export const OFFLINE_BASE_RATE = 0.2;
export const OFFLINE_RATE_PER_LANTERN = 0.08;
export const OFFLINE_MIN_SECONDS = 300; // меньше 5 минут — не показываем окно

// ---------- Престиж ----------

export const PRESTIGE_REQUIREMENT = 1e12; // алмазов за забег (масштаб 12 тиров x3 дохода)
export const STAR_BONUS = 0.1;           // +10% ко всему доходу за звезду

// Индекс алмазного тира (валюта престижа) — вычисляется, а не хардкодится,
// чтобы порядок руд можно было менять без правки логики.
export const DIAMOND_INDEX = TIERS.findIndex((t) => t.key === 'diamond');
// ---------- Состояние ----------

export function createInitialState() {
    // Уровни собираются из каталога автоматически — новые улучшения не нужно
    // отдельно добавлять в состояние.
    const levels = {};
    for (const def of UPGRADES) levels[def.id] = 0;
    return {
        version: SAVE_VERSION,
        ore: 0,
        tier: 0,
        stars: 0,
        clicks: 0,
        lifetimeMined: 0,
        tierEarned: TIERS.map(() => 0),
        tierAnchorRate: 0, // доход при входе в тир; 0 = зафиксируется лениво
        tutorialDone: false,
        soundOn: true, // тумблер звука в настройках (эффекты)
        musicOn: true, // тумблер фоновой музыки
        musicVolume: 0.5, // громкость фоновой музыки 0..1
        dailyStreak: 0,    // серия дней с наградой (пропуск дня — сброс)
        lastDailyDay: 0,   // номер последнего дня с полученной наградой (Date.now()/DAY_MS)
        dailyBuffUntil: 0, // дневной баф множителя добычи (wall-clock ms)
        dailyBuffMult: 1,
        dailyCritUntil: 0, // баф «Критический импульс»
        dailyVeinUntil: 0, // баф «Золотая жила»
        levels
    };
}

export const gameState = createInitialState();

// ---------- Форматирование чисел ----------

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + fmt(-n);
    if (n < 10000) {
        const r = Math.floor(n);
        return String(r);
    }
    let idx = Math.floor(Math.log10(n) / 3);
    if (idx >= SUFFIXES.length) return n.toExponential(1).replace('e+', 'e');
    const scaled = n / Math.pow(1000, idx);
    const str = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
    return str + SUFFIXES[idx];
}

export function fmtDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h} ч ${m} мин`;
    if (h > 0) return `${h} ч`;
    return `${m} мин`;
}

// ---------- Экономика ----------

export function getUpgradeDef(id) {
    return UPGRADES.find((u) => u.id === id);
}

export function getUpgradeLevel(id) {
    return gameState.levels[id] || 0;
}

export function getUpgradeCost(id) {
    const def = getUpgradeDef(id);
    const level = getUpgradeLevel(id);
    return Math.ceil(def.baseCost * Math.pow(def.growth, level) * TIER_COST_MULT(gameState.tier));
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
    const def = getUpgradeDef(id);
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

export function getBulkCost(id, want) {
    const def = getUpgradeDef(id);
    const tier = TIER_COST_MULT(gameState.tier);
    const start = getUpgradeLevel(id);
    const n = def.maxLevel === null ? want : Math.min(want, def.maxLevel - start);
    let total = 0;
    for (let i = 0; i < n; i++) {
        total += Math.ceil(def.baseCost * Math.pow(def.growth, start + i) * tier);
    }
    return { n, total };
}

export function getAffordableBulk(id, want) {
    const def = getUpgradeDef(id);
    const tier = TIER_COST_MULT(gameState.tier);
    const start = getUpgradeLevel(id);
    const cap = def.maxLevel === null ? want : Math.min(want, def.maxLevel - start);
    let budget = gameState.ore;
    let n = 0, total = 0;
    while (n < cap) {
        const cost = Math.ceil(def.baseCost * Math.pow(def.growth, start + n) * tier);
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
    const r = getAffordableBulk(id, want === 'max' ? Infinity : want);
    if (r.n <= 0) return false;
    if (want !== 'max') {
        // Строгий пакет: нужно купить ровно min(want, остаток до лимита)
        if (r.n < Math.min(want, remaining)) return false;
    }
    gameState.ore -= r.total;
    gameState.levels[id] = getUpgradeLevel(id) + r.n;
    return true;
}

export function getClickDamage() {
    // в единицах текущего тира
    const base = 1 + getUpgradeLevel('pickaxe');
    let mult = Math.pow(1.5, getUpgradeLevel('sledge'));
    mult *= Math.pow(1.6, getUpgradeLevel('hydraulic'));
    mult *= Math.pow(1.7, getUpgradeLevel('plasma'));
    mult *= Math.pow(1.8, getUpgradeLevel('disintegrator'));
    return base * mult * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult();
}

export function getOrePerSecond() {
    const flat = getUpgradeLevel('miner') * 1
        + getUpgradeLevel('drill') * 10
        + getUpgradeLevel('excavator') * 100
        + getUpgradeLevel('factory') * 1000
        + getUpgradeLevel('quarry') * 1e4
        + getUpgradeLevel('megafactory') * 1e5
        + getUpgradeLevel('orbital') * 1e6
        + getUpgradeLevel('quantumlab') * 1e7
        + getUpgradeLevel('wormhole') * 1e8
        + getUpgradeLevel('singularity') * 1e9
        + getUpgradeLevel('dyson') * 1e10;
    let mult = Math.pow(1.25, getUpgradeLevel('tech'));
    mult *= Math.pow(1.3, getUpgradeLevel('aicore'));
    // дневной баф («Ускорение»/«Мощный буст») применяется к фактической добыче;
    // в якорь цены спуска (getExpectedClickGain) он сознательно не входит
    return flat * mult * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult() * getDailyMult();
}

// Робо-рука: +0.5 авто-кликов в секунду за уровень.
// Авто-клик наносит полный урон клика (крит/жила/синергия), но без тряски камеры.
export function getAutoClicksPerSecond() {
    return 0.5 * getUpgradeLevel('robotarm');
}

export function getCritChance() {
    const base = Math.min(0.05 + 0.03 * getUpgradeLevel('dynamite'), 0.74);
    // «Критический импульс» (дневная награда): потолок 95% — всегда остаётся шанс промаха по шансу
    if (Date.now() < gameState.dailyCritUntil) return Math.min(base + DAILY_CRIT_BONUS, 0.95);
    return base;
}

export function getLuckyChance() {
    return Math.min(0.02 * getUpgradeLevel('lucky'), 0.5);
}

export function getPrestigeMult() {
    return 1 + STAR_BONUS * gameState.stars;
}

// ---------- Мутации блока (Этап 3) ----------
// Временные события на блоке: триггер раз в 300с с шансом 30%, длительность ровно 10с.
// Единственный терминатор — таймер: мутация переживает разрушение блока и смену тира
// (новый блок наследует активную мутацию). Управление в GameScene.
// tints — палитра tint: 1 цвет = статичный tint, 2 цвета = пульс/мерцание, 6+ = перебор (радуга).
export const MUTATIONS = {
    rainbow:   { name: 'Радужный блок',    desc: 'доход за клик x10',               clickGainMult: 10,
                 tints: [0xff5050, 0xffa030, 0xffe840, 0x50e050, 0x40a0ff, 0xb050ff] },
    frozen:    { name: 'Замороженный блок', desc: 'x3 кликов, каждый удар — крит',   hitsPerStage: 3, forceCrit: true,
                 tints: [0xbfe8ff, 0x7fc4ff] },
    explosive: { name: 'Взрывной блок',    desc: 'x2 кликов, взрыв при разрушении', hitsPerStage: 2, breakBonusMult: 25,
                 tints: [0xffb060, 0xff5030] },
    charged:   { name: 'Заряженный блок',  desc: 'фоновая добыча x3',               passiveMult: 3,
                 tints: [0xd8a8ff, 0x9a50ff] }
};
export const MUTATION_DURATION_MS = 10000;
export const MUTATION_CHECK_MS = 300000;
export const MUTATION_CHANCE = 0.3;

// Бонус взрывной мутации при разрушении блока: N урона клика
export function getMutationBreakBonus(mutationId) {
    const mut = mutationId ? MUTATIONS[mutationId] : null;
    return mut && mut.breakBonusMult ? getClickDamage() * mut.breakBonusMult : 0;
}

// ---------- Ежедневные награды (Этап 6, расширенный) ----------
// Модалка при первом заходе за день; награды = 7-дневный цикл, день серии
// выбирает награду. Пропуск дня (lastDailyDay < вчера) обнуляет серию.
// Бафы — таймеры WALL-CLOCK (ms): переживают перезагрузку страницы, истекают сами.
// Якорь цены спуска (getExpectedClickGain) считается БЕЗ дневного бафа — баф
// временный и не должен сдвигать лестницу цен.
export const DAY_MS = 86400e3;
export const DAILY_CRIT_BONUS = 0.25;   // «Критический импульс»: +25% к шансу крита
export const DAILY_INSTANT_SECONDS = 300; // «Накопитель»: 5 минут полного дохода сразу
export const DAILY_REWARDS = [
    { id: 'boost2',  name: 'Ускорение',           kind: 'mult', mult: 2,  durMs: 10 * 60e3, icon: 'pickaxe_iron',    desc: 'x2 к скорости добычи\nна 10 минут' },
    { id: 'stash',   name: 'Накопитель',          kind: 'instant', icon: 'gold_nugget',            desc: 'мгновенно 5 минут\nполного дохода' },
    { id: 'crit',    name: 'Критический импульс', kind: 'crit', icon: 'dynamite_bundle',          desc: `+${Math.round(DAILY_CRIT_BONUS * 100)}% к шансу крита\nна 5 минут` },
    { id: 'upgrade', name: 'Бесплатное улучшение', kind: 'upgrade', icon: 'icon_hammer',           desc: '+1 уровень лучшему\nдоступному улучшению' },
    { id: 'boost3',  name: 'Мощное ускорение',    kind: 'mult', mult: 3,  durMs: 10 * 60e3, icon: 'pickaxe_diamond', desc: 'x3 к скорости добычи\nна 10 минут' },
    { id: 'boost10', name: 'Мощный буст',         kind: 'mult', mult: 10, durMs: 2 * 60e3,  icon: 'icon_dyson',      desc: 'x10 к скорости добычи\nна 2 минуты' },
    { id: 'vein',    name: 'Золотая жила',        kind: 'vein', durMs: 2 * 60e3,  icon: 'icon_vein',       desc: 'каждый удар — жила\nна 2 минуты' }
];

export function getDailyDay() {
    return Math.floor(Date.now() / DAY_MS);
}

// Активный дневной множитель добычи (1 = бафа нет)
export function getDailyMult() {
    return Date.now() < gameState.dailyBuffUntil ? gameState.dailyBuffMult : 1;
}

// Бафы «Критический импульс» / «Золотая жила»
export function isDailyCritActive() {
    return Date.now() < gameState.dailyCritUntil;
}

export function isDailyVeinActive() {
    return Date.now() < gameState.dailyVeinUntil;
}

export function canClaimDaily() {
    return getDailyDay() > gameState.lastDailyDay;
}

// Прирост дохода/сек от +1 уровня улучшения id — матрица выбора «бесплатного
// улучшения» и общий инструмент баланса (свернута с balance-sim.mjs: та же математика).
export function upgradeIncomeDelta(id) {
    const dmg = getClickDamage();
    const syn = getSynergyGain();
    const cps = getAutoClicksPerSecond() + 3; // MANUAL_CPS_ASSUME
    const critMult = 5 + 0.5 * getUpgradeLevel('focuslens');
    const veinMult = 10 + 1 * getUpgradeLevel('magnet');
    const critF = 1 + getCritChance() * (critMult - 1);
    const veinF = 1 + getLuckyChance() * (veinMult - 1);
    const clickChain = () => Math.pow(1.5, getUpgradeLevel('sledge'))
        * Math.pow(1.6, getUpgradeLevel('hydraulic'))
        * Math.pow(1.7, getUpgradeLevel('plasma'))
        * Math.pow(1.8, getUpgradeLevel('disintegrator'))
        * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult();
    const passiveMults = () => Math.pow(1.25, getUpgradeLevel('tech'))
        * Math.pow(1.3, getUpgradeLevel('aicore'))
        * TIER_INCOME_MULT(gameState.tier) * getPrestigeMult();
    switch (id) {
        case 'pickaxe':   return clickChain() * critF * veinF * cps;
        case 'sledge':    return dmg * 0.5 * critF * veinF * cps;
        case 'hydraulic': return dmg * 0.6 * critF * veinF * cps;
        case 'plasma':    return dmg * 0.7 * critF * veinF * cps;
        case 'disintegrator': return dmg * 0.8 * critF * veinF * cps;
        case 'miner':     return 1 * passiveMults();
        case 'drill':     return 10 * passiveMults();
        case 'excavator': return 100 * passiveMults();
        case 'factory':   return 1000 * passiveMults();
        case 'quarry':    return 1e4 * passiveMults();
        case 'megafactory': return 1e5 * passiveMults();
        case 'orbital':   return 1e6 * passiveMults();
        case 'quantumlab': return 1e7 * passiveMults();
        case 'wormhole':  return 1e8 * passiveMults();
        case 'singularity': return 1e9 * passiveMults();
        case 'dyson':     return 1e10 * passiveMults();
        case 'tech':      return getOrePerSecond() * 0.25;
        case 'aicore':    return getOrePerSecond() * 0.3;
        case 'dynamite':  { const c = Math.min(0.05 + 0.03 * (getUpgradeLevel('dynamite') + 1), 0.74) - getCritChance(); return (dmg + syn) * c * (critMult - 1) * veinF * cps; }
        case 'lucky':     { const v = Math.min(0.02 * (getUpgradeLevel('lucky') + 1), 0.5) - getLuckyChance(); return (dmg + syn) * v * (veinMult - 1) * critF * cps; }
        case 'resonance': return getOrePerSecond() * 0.01 * critF * veinF * cps;
        case 'focuslens': return (dmg + syn) * getCritChance() * 0.25 * veinF * cps;
        case 'magnet':    return (dmg + syn) * getLuckyChance() * critF * cps;
        case 'lantern':
        case 'warehouse': return 0;
    }
    return 0;
}

// Лучшее доступное улучшение для «Бесплатного улучшения»: максимум прироста
// дохода на единицу цены среди доступных (гейты/цепочки/капы соблюдены) —
// полезно на любом тире по построению.
export function pickFreeUpgrade() {
    let best = null, bestRoi = 0;
    for (const def of UPGRADES) {
        if (isMaxed(def.id) || !isUpgradeAvailable(def.id)) continue;
        const d = upgradeIncomeDelta(def.id);
        if (d <= 0) continue;
        const roi = d / getUpgradeCost(def.id);
        if (roi > bestRoi) { bestRoi = roi; best = def; }
    }
    return best;
}

function applyDailyReward(reward) {
    switch (reward.kind) {
        case 'mult':
            gameState.dailyBuffMult = reward.mult;
            gameState.dailyBuffUntil = Date.now() + reward.durMs;
            return null;
        case 'instant': {
            // несколько минут ПОЛНОГО дохода (пассив + клики/авто) — по построению
            // масштабируется с прогрессом и не раздаёт слишком много
            const amount = DAILY_INSTANT_SECONDS * getEarningRate();
            addOre(amount);
            return amount;
        }
        case 'crit':
            gameState.dailyCritUntil = Date.now() + 5 * 60e3;
            return null;
        case 'vein':
            gameState.dailyVeinUntil = Date.now() + reward.durMs;
            return null;
        case 'upgrade': {
            const def = pickFreeUpgrade();
            if (!def) return null;
            gameState.levels[def.id] = getUpgradeLevel(def.id) + 1;
            return { id: def.id, name: def.name };
        }
    }
    return null;
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

// Один клик: базовый урон + крит x5(+линза) + золотая жила x10(+магнит) + синергия (% от пассива).
// mutationId — активная мутация блока: замороженная форсирует крит, радужная множит весь доход.
// Дневные бафы: «Золотая жила» форсирует жилу, множитель бафа применяется к итогу.
export function rollClickGain(mutationId) {
    let gain = getClickDamage() + getSynergyGain();
    const mut = mutationId ? MUTATIONS[mutationId] : null;
    const crit = (mut && mut.forceCrit) || Math.random() < getCritChance();
    const lucky = isDailyVeinActive() || Math.random() < getLuckyChance();
    // Фокус-линза: +0.5 к силе крита за уровень (x5 -> x5.5...)
    const critMult = 5 + 0.5 * getUpgradeLevel('focuslens');
    // Рудный магнит: +1 к множителю жилы за уровень (x10 -> x11...)
    const veinMult = 10 + 1 * getUpgradeLevel('magnet');
    if (crit) gain *= critMult;
    if (lucky) gain *= veinMult;
    if (mut && mut.clickGainMult) gain *= mut.clickGainMult;
    gain *= getDailyMult();
    return { gain, crit, lucky };
}

export function addOre(amount) {
    gameState.ore += amount;
    gameState.tierEarned[gameState.tier] += amount;
    gameState.lifetimeMined += amount;
}

// ---------- Тиры: переход на новый уровень шахты ----------

export function getNextTier() {
    return gameState.tier < TIERS.length - 1 ? TIERS[gameState.tier + 1] : null;
}

export function canUnlockTier() {
    return gameState.tier < TIERS.length - 1 && gameState.ore >= getNextUnlockPrice();
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
    if (gameState.tier >= TIERS.length - 1) return false;
    gameState.tier += 1;
    gameState.ore = 0;
    resetTierAnchor();
    return true;
}

// ---------- Престиж ----------

export function getStarsGain() {
    return Math.floor(Math.sqrt(gameState.tierEarned[DIAMOND_INDEX] / PRESTIGE_REQUIREMENT));
}

export function canPrestige() {
    return getStarsGain() >= 1;
}

export function doPrestige() {
    const gain = getStarsGain();
    if (gain < 1) return false;
    gameState.stars += gain;
    gameState.ore = 0;
    gameState.tier = 0;
    gameState.tierEarned = TIERS.map(() => 0);
    gameState.tierAnchorRate = 0;
    gameState.levels = createInitialState().levels;
    return gain;
}

// ---------- Офлайн-доход ----------

export function getOfflineRate() {
    return OFFLINE_BASE_RATE + OFFLINE_RATE_PER_LANTERN * getUpgradeLevel('lantern');
}

export function getOfflineCapSeconds() {
    return OFFLINE_CAP_HOURS[Math.min(getUpgradeLevel('warehouse'), OFFLINE_CAP_HOURS.length - 1)] * 3600;
}

// Возвращает {seconds, reward} или null (мало времени / нет пассивного дохода)
export function computeOfflineReward(lastExitMs, nowMs = Date.now()) {
    const diffSec = (nowMs - lastExitMs) / 1000;
    if (!isFinite(diffSec) || diffSec < OFFLINE_MIN_SECONDS) return null;
    const gps = getOrePerSecond();
    if (gps <= 0) return null;
    const counted = Math.min(diffSec, getOfflineCapSeconds());
    const reward = counted * gps * getOfflineRate();
    if (reward <= 0) return null;
    return { seconds: diffSec, counted, reward };
}

export function saveLastExit(nowMs = Date.now()) {
    try {
        localStorage.setItem(LAST_EXIT_KEY, String(nowMs));
    } catch (err) { /* приватный режим и т.п. */ }
    YandexSDKStub.player.setStats({ lastExit: nowMs });
}

export async function readLastExit() {
    // try вокруг getStats обязателен: на этапе 2 реальный SDK отклоняет промис
    // при сетевой ошибке / неавторизованном игроке — без отката к фолбэку
    // обрывался бы loadSaveThenStart (чёрный экран) или терялось начисление
    try {
        const stats = await YandexSDKStub.player.getStats(['lastExit']);
        if (typeof stats?.lastExit === 'number' && stats.lastExit > 0) return stats.lastExit;
    } catch (err) { /* идём к фолбэку */ }
    try {
        const raw = localStorage.getItem(LAST_EXIT_KEY);
        if (raw) {
            const n = Number(raw);
            // как в getStats-пути: мусор/отрицательное не превращается в кап-начисление
            if (Number.isFinite(n) && n > 0) return n;
        }
    } catch (err) { /* ignore */ }
    try {
        const legacy = localStorage.getItem(LEGACY_LAST_EXIT_KEY);
        if (legacy) {
            const n = Number(legacy);
            if (Number.isFinite(n) && n > 0) return n;
        }
    } catch (err) { /* ignore */ }
    return null;
}

// ---------- Сохранение / загрузка ----------

export function saveGame() {
    // Основной слот сейва — через стаб: на этапе 2 заменяется содержимое
    // sdk-stub.js (player.setData реального SDK), игровой код не меняется.
    // Стаб пишет синхронно в localStorage под прежним ключом/форматом.
    YandexSDKStub.player.setData(JSON.stringify(gameState));
}

export function applySave(data) {
    if (!data || typeof data !== 'object') return;
    const init = createInitialState();

    // Миграция сохранений версии 1 (уголь, 3 улучшения)
    if (data.version === 1) {
        gameState.ore = Number(data.coal) || 0;
        gameState.tier = 0;
        gameState.stars = 0;
        gameState.clicks = Number(data.clicks) || 0;
        gameState.lifetimeMined = Number(data.totalMined) || 0;
        gameState.tierEarned[0] = gameState.lifetimeMined;
        gameState.levels = {
            ...init.levels,
            pickaxe: Math.max(0, Number(data.levels && data.levels.pickaxe) || 0),
            dynamite: Math.max(0, Number(data.levels && data.levels.dynamite) || 0),
            miner: Math.max(0, Number(data.levels && data.levels.miner) || 0)
        };
        // верхний кламп до капов — как в основной ветке applySave
        for (const def of UPGRADES) {
            if (def.maxLevel === null) continue;
            gameState.levels[def.id] = Math.min(gameState.levels[def.id], def.maxLevel);
        }
        gameState.version = SAVE_VERSION;
        gameState.tutorialDone = true; // старые игроки — обучение не показываем
        gameState.soundOn = true;
        gameState.musicOn = true;
        gameState.musicVolume = 0.5;
        return;
    }

    // Миграция версии 2 (5 тиров: уголь/железо/золото/изумруд/алмаз) -> v3 (12 тиров):
    // порядок руд изменился, старый индекс тира переводится по ключу руды,
    // баланс руды и уровни улучшений сохраняются; добыча по тирам переносится так же.
    if (data.version === 2) {
        const legacyTierKeys = ['coal', 'iron', 'gold', 'emerald', 'diamond'];
        const oldTier = Math.min(Math.max(0, Number(data.tier) || 0), legacyTierKeys.length - 1);
        const legacyEarned = Array.isArray(data.tierEarned) ? data.tierEarned : [];
        const mappedTier = Math.max(0, TIERS.findIndex((t) => t.key === legacyTierKeys[oldTier]));
        const mappedEarned = TIERS.map(() => 0);
        legacyTierKeys.forEach((key, i) => {
            const idx = TIERS.findIndex((t) => t.key === key);
            if (idx >= 0) mappedEarned[idx] = Math.max(0, Number(legacyEarned[i]) || 0);
        });
        data = { ...data, version: SAVE_VERSION, tier: mappedTier, tierEarned: mappedEarned };
    }

    // Миграция v3 -> v4: добавлен якорь дохода тира (tierAnchorRate). Старые сейвы
    // принимаются как есть — якорь зафиксируется лениво от текущего дохода, что
    // непрерывно с прежним поведением (цена от текущей ставки на момент загрузки).
    if (data.version === 3) {
        data = { ...data, version: SAVE_VERSION };
    }

    if (data.version !== SAVE_VERSION) return;

    const o = Number(data.ore);
    // Infinity (битый сейв «ore: 1e999») / NaN / отрицательное → 0: иначе МАКС-покупка
    // вечным циклом вешает вкладку (getAffordableBulk против Infinity не завершается)
    gameState.ore = Number.isFinite(o) && o > 0 ? o : 0;
    gameState.tier = Math.min(Math.max(0, Number(data.tier) || 0), TIERS.length - 1);
    gameState.stars = Math.max(0, Number(data.stars) || 0);
    gameState.clicks = Math.max(0, Number(data.clicks) || 0);
    gameState.lifetimeMined = Math.max(0, Number(data.lifetimeMined) || 0);
    gameState.tierEarned = TIERS.map((_, i) => Math.max(0, Number(data.tierEarned && data.tierEarned[i]) || 0));
    gameState.tierAnchorRate = Math.max(0, Number(data.tierAnchorRate) || 0);
    // Сейвы без флага (старые игроки) — обучение пропускается; false = продолжить
    gameState.tutorialDone = data.tutorialDone !== false;
    gameState.soundOn = data.soundOn !== false; // отсутствие флага = звук включён
    gameState.musicOn = data.musicOn !== false; // отсутствие флага = музыка включена
    const mv = Number(data.musicVolume); // 0 должен сохраняться как 0 — не через ||
    gameState.musicVolume = Number.isFinite(mv) ? Math.min(1, Math.max(0, mv)) : 0.5;
    // Ежедневные награды: отсутствие полей в старых сейвах = чистая серия
    gameState.dailyStreak = Math.max(0, Math.floor(Number(data.dailyStreak) || 0));
    const ldd = Number(data.lastDailyDay);
    gameState.lastDailyDay = Number.isFinite(ldd) && ldd > 0 ? Math.floor(ldd) : 0;
    const dbu = Number(data.dailyBuffUntil), dbm = Number(data.dailyBuffMult);
    gameState.dailyBuffUntil = Number.isFinite(dbu) && dbu > Date.now() ? dbu : 0; // истёкший баф не resurrect
    gameState.dailyBuffMult = Number.isFinite(dbm) && dbm >= 1 ? Math.min(dbm, 1e6) : 1;
    const dcu = Number(data.dailyCritUntil), dvt = Number(data.dailyVeinUntil);
    gameState.dailyCritUntil = Number.isFinite(dcu) && dcu > Date.now() ? dcu : 0;
    gameState.dailyVeinUntil = Number.isFinite(dvt) && dvt > Date.now() ? dvt : 0;
    gameState.levels = { ...init.levels };
    if (data.levels && typeof data.levels === 'object') {
        for (const def of UPGRADES) {
            const n = Math.max(0, Number(data.levels[def.id]) || 0);
            // верхний кламп до капа: сейв с levels.pickaxe=99999 иначе проходит как есть
            gameState.levels[def.id] = def.maxLevel === null ? n : Math.min(n, def.maxLevel);
        }
    }
    gameState.version = SAVE_VERSION;
}

export async function loadGame() {
    const data = await YandexSDKStub.player.getData();
    if (data) {
        try {
            applySave(data);
        } catch (err) {
            console.warn('Повреждённое сохранение, старт с нуля:', err);
        }
    }
}

export function resetGame() {
    // Настройки звука/музыки — выбор игрока, сброс прогресса их не трогает
    const prefs = {
        soundOn: gameState.soundOn,
        musicOn: gameState.musicOn,
        musicVolume: gameState.musicVolume
    };
    Object.assign(gameState, createInitialState());
    Object.assign(gameState, prefs);
    saveGame();
}

