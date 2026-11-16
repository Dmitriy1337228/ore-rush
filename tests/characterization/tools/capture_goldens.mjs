// Снимает значения РЕАЛЬНОГО кода для golden-констант characterization-тестов.
// Запуск: node tests/characterization/tools/capture_goldens.mjs
// Вывод — JSON в stdout. Регенерировать ТОЛЬКО при намеренном изменении поведения:
// после регенерации руками перенести значения в тесты (см. README.md).
// Шим localStorage ДО импорта src/state.js (в Node глобального localStorage нет).
if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null,
        get length() {
            return store.size;
        }
    };
}

const S = await import('../../../src/state.js');
const L = await import('../../../src/layout.js');
const SDK = await import('../../../src/sdk-stub.js');

const out = {};

// ---------- Каталоги (снапшоты) ----------
out.tiers = S.TIERS;
out.upgrades = S.UPGRADES;
out.artifacts = S.ARTIFACTS;
out.items = S.ITEMS;
out.craftRecipes = S.CRAFT_RECIPES;
out.dailyRewards = S.DAILY_REWARDS;
out.bosses = S.BOSSES;
out.components = S.COMPONENTS;
out.mutations = S.MUTATIONS;
out.constants = {
    SAVE_VERSION: S.SAVE_VERSION,
    SAVE_KEY: S.SAVE_KEY,
    LAST_EXIT_KEY: S.LAST_EXIT_KEY,
    LEGACY_LAST_EXIT_KEY: S.LEGACY_LAST_EXIT_KEY,
    TIER_STEP: S.TIER_STEP,
    UNLOCK_BASE_SECONDS: S.UNLOCK_BASE_SECONDS,
    UNLOCK_SECONDS_GROWTH: S.UNLOCK_SECONDS_GROWTH,
    UNLOCK_FLOOR: S.UNLOCK_FLOOR,
    MANUAL_CPS_ASSUME: S.MANUAL_CPS_ASSUME,
    OFFLINE_CAP_HOURS: S.OFFLINE_CAP_HOURS,
    OFFLINE_BASE_RATE: S.OFFLINE_BASE_RATE,
    OFFLINE_RATE_PER_LANTERN: S.OFFLINE_RATE_PER_LANTERN,
    OFFLINE_MIN_SECONDS: S.OFFLINE_MIN_SECONDS,
    PRESTIGE_REQUIREMENT: S.PRESTIGE_REQUIREMENT,
    STAR_BONUS: S.STAR_BONUS,
    DIAMOND_INDEX: S.DIAMOND_INDEX,
    MUTATION_DURATION_MS: S.MUTATION_DURATION_MS,
    MUTATION_CHECK_MS: S.MUTATION_CHECK_MS,
    MUTATION_CHANCE: S.MUTATION_CHANCE,
    BOSS_HP_BASE: S.BOSS_HP_BASE,
    BOSS_FIGHT_SECONDS: S.BOSS_FIGHT_SECONDS,
    BOSS_BOUNTY_SECONDS: S.BOSS_BOUNTY_SECONDS,
    BOSS_ATTACK_PERIOD_MS: S.BOSS_ATTACK_PERIOD_MS,
    BOSS_ATTACK_WINDUP_MS: S.BOSS_ATTACK_WINDUP_MS,
    PLAYER_BASE_HP: S.PLAYER_BASE_HP,
    PLAYER_HP_PER_HELMET: S.PLAYER_HP_PER_HELMET,
    BOSS_SPEED_TIERS: S.BOSS_SPEED_TIERS,
    BOSS_SPEED_SLOW: S.BOSS_SPEED_SLOW,
    DAY_MS: S.DAY_MS,
    DAILY_CRIT_BONUS: S.DAILY_CRIT_BONUS,
    DAILY_INSTANT_SECONDS: S.DAILY_INSTANT_SECONDS
};

// ---------- fmt / fmtDuration ----------
out.fmt = {};
for (const [k, v] of Object.entries({
    zero: 0,
    frac: 0.5,
    small: 9999,
    tenK: 10000,
    oneK: 1500,
    big: 123456,
    million: 1e6,
    billion: 1.234e9,
    trillion: 1.5e12,
    qa: 1e15,
    qi: 1e16,
    hundredQa: 1e17,
    sx: 1e18,
    overflow: 1e45,
    inf: Infinity,
    neg: -5,
    negFrac: -0.5,
    nan: NaN,
    hundredMill: 123456789
}))
    out.fmt[k] = S.fmt(v);
out.fmtDuration = {};
for (const [k, v] of Object.entries({
    zero: 0,
    seconds: 59,
    minute: 60,
    hm: 3661,
    hour: 3600,
    hours: 7200,
    neg: -10,
    day: 90000,
    hOnly: 3660
}))
    out.fmtDuration[k] = S.fmtDuration(v);

// ---------- Экономика: цены/доходы (свежее состояние) ----------
S.resetGame();
out.economy = {};
out.economy.costPickaxeL0 = S.getUpgradeCost('pickaxe');
out.economy.costMinerL0 = S.getUpgradeCost('miner');
out.economy.costMinerL5 = (() => {
    S.gameState.levels.miner = 5;
    const c = S.getUpgradeCost('miner');
    S.gameState.levels.miner = 0;
    return c;
})();
out.economy.clickDamageFresh = S.getClickDamage();
out.economy.orePerSecondFresh = S.getOrePerSecond();
out.economy.autoClicksFresh = S.getAutoClicksPerSecond();
out.economy.expectedClickGainFresh = S.getExpectedClickGain();
out.economy.earningRateFresh = S.getEarningRate();
out.economy.synergyFresh = S.getSynergyGain();
out.economy.critChanceFresh = S.getCritChance();
out.economy.luckyChanceFresh = S.getLuckyChance();
out.economy.prestigeMultFresh = S.getPrestigeMult();
out.economy.unlockSeconds = {};
for (let t = 0; t <= 11; t++) out.economy.unlockSeconds[t] = S.unlockSecondsFor(t);
out.economy.nextUnlockPriceFresh = S.getNextUnlockPrice(); // пол UNLOCK_FLOOR на тире 0
out.economy.unlockEtaFresh = S.getUnlockEtaSeconds();
out.economy.tierIncomeMult = {};
for (let t = 0; t <= 5; t++) out.economy.tierIncomeMult[t] = S.TIER_INCOME_MULT(t);
out.economy.tierCostMult = {};
for (let t = 0; t <= 5; t++) out.economy.tierCostMult[t] = S.TIER_COST_MULT(t);

// Цены улучшений на тире 2 (x9) с уровнями кирки/шахтёра
S.resetGame();
S.gameState.tier = 2;
S.gameState.levels.pickaxe = 3;
S.gameState.levels.miner = 2;
out.economy.costPickaxeT2L3 = S.getUpgradeCost('pickaxe');
out.economy.costMinerT2L2 = S.getUpgradeCost('miner');
out.economy.clickDamageT2 = S.getClickDamage();
out.economy.orePerSecondT2 = S.getOrePerSecond();
out.economy.expectedClickGainT2 = S.getExpectedClickGain();
out.economy.unlockPriceT2 = S.getNextUnlockPrice(); // лениво фиксирует якорь
out.economy.anchorT2 = S.gameState.tierAnchorRate;

// Якорь уже зафиксирован: цена и ETA
S.resetGame();
S.gameState.tierAnchorRate = 100;
out.economy.priceT0Anchor100 = S.getNextUnlockPrice();
out.economy.priceT2Anchor100 = (() => {
    S.gameState.tier = 2;
    return S.getNextUnlockPrice();
})();
out.economy.priceT11Anchor100 = (() => {
    S.gameState.tier = 11;
    return S.getNextUnlockPrice();
})();
out.economy.lastTierPrice = (() => {
    S.gameState.tier = 11;
    return S.computeNextUnlockPrice(11);
})();

// ---------- Мультипокупка ----------
S.resetGame();
out.bulk = {};
out.bulk.costPickaxe10 = S.getBulkCost('pickaxe', 10);
out.bulk.costDrill5T0 = (() => {
    return S.getBulkCost('drill', 5);
})();
out.bulk.affordablePickaxe10With10000 = (() => {
    S.gameState.ore = 10000;
    return S.getAffordableBulk('pickaxe', 10);
})();
out.bulk.buyStrictFail = (() => {
    return S.buyBulk('pickaxe', 10);
})();
out.bulk.levelAfterStrictFail = S.gameState.levels.pickaxe;
out.bulk.oreAfterStrictFail = S.gameState.ore;
out.bulk.buyMax = (() => {
    return S.buyBulk('pickaxe', 'max');
})();
out.bulk.levelAfterMax = S.gameState.levels.pickaxe;
out.bulk.oreAfterMax = S.gameState.ore;
out.bulk.buyExact = (() => {
    S.gameState.ore = 7665 + 2335;
    return S.buyBulk('pickaxe', 3);
})();
// (уровень 9: следующие 3 уровня стоят 15360+30720+61440=107520; бюджет 10000 -> отказ)
out.bulk.levelAfterExactTry = S.gameState.levels.pickaxe;
S.resetGame();
S.gameState.ore = 1e9;
out.bulk.buy10Cheap = (() => {
    return S.buyBulk('pickaxe', 10);
})();
out.bulk.levelAfter10Cheap = S.gameState.levels.pickaxe;
out.bulk.oreAfter10Cheap = S.gameState.ore;

// ---------- Видимость/доступность ----------
S.resetGame();
out.visibility = {
    pickaxeFresh: S.isUpgradeVisible('pickaxe'),
    sledgeFresh: S.isUpgradeVisible('sledge'), // цепочка кирки: анонс
    hydraulicFresh: S.isUpgradeVisible('hydraulic'), // не первое в цепочке — скрыто
    drillFresh: S.isUpgradeVisible('drill'), // tier 1 гейт + requires
    equipmentTabFresh: S.getVisibleUpgrades('equipment').map((u) => u.id),
    enhanceTabFresh: S.getVisibleUpgrades('enhance').map((u) => u.id),
    availableSledge: S.isUpgradeAvailable('sledge'),
    availableDrill: S.isUpgradeAvailable('drill'),
    canBuySledge: S.canBuy('sledge'),
    maxedPickaxe: (() => {
        S.gameState.levels.pickaxe = 30;
        return S.isMaxed('pickaxe');
    })()
};
S.resetGame();
out.visibility.equipmentT6 = (() => {
    S.gameState.tier = 6;
    return S.getVisibleUpgrades('equipment').map((u) => u.id);
})();

// ---------- rollClickGain (Math.random стаб) ----------
S.resetGame();
const realRandom = Math.random;
Math.random = () => 0.999;
out.rollNoCritNoLucky = S.rollClickGain(null);
Math.random = () => 0;
out.rollCritLucky = S.rollClickGain(null);
S.gameState.levels.dynamite = 10; // крит 0.05+0.30=0.35
S.gameState.levels.focuslens = 2; // critMult 6
S.gameState.levels.lucky = 4; // жила 0.08, veinMult 14
Math.random = () => 0.999;
out.rollHighNoProcs = S.rollClickGain(null);
Math.random = () => 0.5; // 0.5 < 0.35 false; 0.5 < 0.08 false
out.rollHighBorderline = S.rollClickGain(null);
S.gameState.dailyVeinUntil = Date.now() + 60000; // дневная жила форсит lucky
out.rollHighDailyVein = S.rollClickGain(null);
S.gameState.dailyVeinUntil = 0;
S.gameState.miningBuffUntil = Date.now() + 60000;
S.gameState.miningBuffMult = 3; // предметный баф множит итог
out.rollHighItemBuff = S.rollClickGain(null);
Math.random = () => 0;
out.rollRainbow = S.rollClickGain('rainbow');
out.rollFrozen = S.rollClickGain('frozen');
Math.random = realRandom;
S.resetGame();

// rollClickGain при крит-шансе > порога: фиксированный roll 0.4
Math.random = () => 0.4;
S.gameState.levels.dynamite = 23; // 0.05+0.69=0.74 (кап)
out.rollCap74With04 = S.rollClickGain(null);
Math.random = realRandom;
S.resetGame();

// ---------- rollBossHit / боссы ----------
S.resetGame();
out.boss = {};
out.boss.hpForCopper = S.bossHpFor(S.BOSSES[0]);
out.boss.hpForDiamond = S.bossHpFor(S.BOSSES[5]);
out.boss.playerMaxHpFresh = S.getPlayerMaxHp();
out.boss.playerMaxHpHelmet5T2 = (() => {
    S.gameState.levels.helmet = 5;
    S.gameState.tier = 2;
    const v = S.getPlayerMaxHp();
    S.gameState.tier = 0;
    S.gameState.levels.helmet = 0;
    return v;
})();
out.boss.attackPowerCopper = S.bossAttackPower(S.BOSSES[0]);
out.boss.speedMult5s = S.bossSpeedMult(5000);
out.boss.speedMult45s = S.bossSpeedMult(45000);
out.boss.speedMult46s = S.bossSpeedMult(46000);
out.boss.speedMult90s = S.bossSpeedMult(90000);
out.boss.speedMult181s = S.bossSpeedMult(181000);
out.boss.speedMult301s = S.bossSpeedMult(301000);
out.boss.speedMult1s = S.bossSpeedMult(0); // max(1, round(0)) = 1
out.boss.recordFirst = S.updateBossRecord('boss_copper', 42.7);
out.boss.recordValue = S.getBossRecord('boss_copper');
out.boss.recordWorse = S.updateBossRecord('boss_copper', 50);
out.boss.recordAfterWorse = S.getBossRecord('boss_copper');
out.boss.recordBetter = S.updateBossRecord('boss_copper', 30);
out.boss.recordAfterBetter = S.getBossRecord('boss_copper');
out.boss.recordUnknownBoss = S.updateBossRecord('boss_xxx', 10);
out.boss.recordClamp = S.updateBossRecord('boss_copper', 999999);
out.boss.recordAfterClamp = S.getBossRecord('boss_copper');

// grantBossKill со стабом random: медный страж, дроп scrap[2,4]
S.resetGame();
S.gameState.levels.miner = 1; // gps > 0, чтобы баунти > 0
Math.random = () => 0;
out.boss.killCopper10s = S.grantBossKill('boss_copper', 10000);
out.boss.componentsAfterKill = { ...S.gameState.components };
out.boss.artifactsAfterKill = [...S.gameState.artifacts];
out.boss.defeatedAfterKill = { ...S.gameState.bossesDefeated };
Math.random = realRandom;
S.resetGame();

// ---------- Крафт ----------
S.resetGame();
out.craft = {};
out.craft.canCraftNoComponents = S.canCraft('r_bomb');
S.gameState.components.scrap = 4;
out.craft.canCraftWithComponents = S.canCraft('r_bomb');
out.craft.startCraft = S.startCraft('r_bomb');
out.craft.craftingState = {
    recipeId: S.gameState.crafting.recipeId,
    endsAtDelta: S.gameState.crafting.endsAt - Date.now()
};
out.craft.canClaimImmediate = S.canClaimCraft(); // craftMs=0: endsAt=now
out.craft.claim = S.claimCraft();
out.craft.itemsAfterClaim = { ...S.gameState.items };
out.craft.componentsAfter = { ...S.gameState.components };
out.craft.canCraftAgainEmpty = S.canCraft('r_bomb'); // scrap потрачен
// верстак занят: длинный рецепт
S.gameState.components.scrap = 100;
S.gameState.components.crystal = 100;
S.gameState.components.core = 100;
out.craft.startHardpick = S.startCraft('r_hardpick');
out.craft.hardpickEndsAtDelta = S.gameState.crafting.endsAt - Date.now();
out.craft.canCraftWhileBusy = S.canCraft('r_bomb');
out.craft.claimNotReady = S.claimCraft();
// место в стаки: item_ration n=2, stackMax 10, в стаке 9
S.gameState.crafting = null;
S.gameState.items.item_ration = 9;
out.craft.canCraftRation9 = S.canCraft('r_ration');
S.gameState.items.item_ration = 10;
out.craft.canCraftRation10 = S.canCraft('r_ration');
S.resetGame();

// ---------- Предметы ----------
S.resetGame();
out.items = {};
out.items.priceBombNoIncome = S.getItemPrice('item_bomb'); // earningRate 3.6 * 60 = 216
S.gameState.levels.miner = 1;
out.items.priceBombMiner1 = S.getItemPrice('item_bomb');
out.items.canBuyItemNoOre = S.canBuyItem('item_bomb');
S.gameState.ore = 1e9;
out.items.canBuyItemYes = S.canBuyItem('item_bomb');
out.items.buyBomb = S.buyItem('item_bomb');
out.items.itemsAfterBuy = { ...S.gameState.items };
out.items.useBombOutsideBoss = S.useItem('item_bomb');
out.items.useCoffee = S.useItem('item_coffee');
out.items.miningBuffAfter = { mult: S.gameState.miningBuffMult, untilDelta: S.gameState.miningBuffUntil - Date.now() };
out.items.itemBuffMult = S.getItemBuffMult();
out.items.useCoffeeAgainReslot = S.useItem('item_coffee'); // остаток 300с > 30с — отказ
out.items.useBombInBoss = S.useItem('item_bomb', true);
out.items.bossBuffAfter = { mult: S.gameState.bossBuffMult, untilDelta: S.gameState.bossBuffUntil - Date.now() };
out.items.bossDamageMult = S.getBossDamageMult();
out.items.buyStackMax = (() => {
    S.gameState.items.item_bomb = 5;
    return S.canBuyItem('item_bomb');
})();
S.resetGame();

// ---------- Дейли ----------
S.resetGame();
out.daily = {};
out.daily.canClaimFresh = S.canClaimDaily(); // lastDailyDay 0 < today
out.daily.claimFirst = S.claimDailyReward(); // streak 1 -> boost2
out.daily.canClaimSameDay = S.canClaimDaily();
out.daily.buffAfterBoost2 = {
    mult: S.gameState.dailyBuffMult,
    untilDelta: Math.round((S.gameState.dailyBuffUntil - Date.now()) / 60000)
};
out.daily.dailyMult = S.getDailyMult();
// серия: имитируем 8 дней подряд (claim ставит lastDailyDay=today; для следующего
// дня откатываем lastDailyDay на вчера) -> 7 наград по кругу, 8-й день = снова первая
S.resetGame();
const day = S.getDailyDay();
out.daily.claimsWeek = [];
for (let i = 0; i < 8; i++) {
    S.gameState.lastDailyDay = day - 1; // «вчера» — claim считает серию продолжающейся
    const r = S.claimDailyReward();
    out.daily.claimsWeek.push({
        i,
        streak: r && r.streak,
        rewardId: r && r.reward.id,
        extra: r && r.extra,
        instantOre: i === 1 ? S.gameState.ore : undefined
    });
}
// пропуск дня — сброс серии
S.resetGame();
S.gameState.lastDailyDay = day - 5;
out.daily.claimAfterGap = S.claimDailyReward();
S.resetGame();

// ---------- Престиж ----------
S.resetGame();
out.prestige = {};
out.prestige.starsGainZero = S.getStarsGain();
out.prestige.canPrestige = S.canPrestige();
S.gameState.tierEarned[S.DIAMOND_INDEX] = S.PRESTIGE_REQUIREMENT; // sqrt(1)=1 звезда
out.prestige.starsGain1 = S.getStarsGain();
S.gameState.tierEarned[S.DIAMOND_INDEX] = 4 * S.PRESTIGE_REQUIREMENT; // sqrt(4)=2
out.prestige.starsGain2 = S.getStarsGain();
S.gameState.ore = 12345;
S.gameState.tier = 7;
S.gameState.levels.pickaxe = 9;
S.gameState.bossesDefeated = { boss_copper: true };
out.prestige.doPrestige = S.doPrestige();
out.prestige.stateAfter = {
    ore: S.gameState.ore,
    tier: S.gameState.tier,
    stars: S.gameState.stars,
    levelsPickaxe: S.gameState.levels.pickaxe,
    bossesDefeated: S.gameState.bossesDefeated,
    tierEarned: S.gameState.tierEarned,
    tierAnchorRate: S.gameState.tierAnchorRate
};
S.resetGame();

// ---------- Офлайн ----------
S.resetGame();
out.offline = {};
out.offline.rateFresh = S.getOfflineRate();
out.offline.capFresh = S.getOfflineCapSeconds();
S.gameState.levels.lantern = 3;
S.gameState.levels.warehouse = 2;
out.offline.rateLantern3 = S.getOfflineRate();
out.offline.capWarehouse2 = S.getOfflineCapSeconds();
S.gameState.levels.warehouse = 9; // кламп к последнему элементу [.., 24]
out.offline.capWarehouse9 = S.getOfflineCapSeconds();
S.resetGame();
S.gameState.levels.miner = 1; // gps 1
const NOW = 1700000000000;
out.offline.short = S.computeOfflineReward(NOW - 299000, NOW);
out.offline.exact300 = S.computeOfflineReward(NOW - 300000, NOW);
out.offline.twoHours = S.computeOfflineReward(NOW - 7200000, NOW);
out.offline.overCap = S.computeOfflineReward(NOW - 100 * 3600000, NOW);
out.offline.noGps = (() => {
    S.gameState.levels.miner = 0;
    return S.computeOfflineReward(NOW - 7200000, NOW);
})();
S.resetGame();

// ---------- saveLastExit / readLastExit ----------
S.resetGame();
out.lastExit = {};
out.lastExit.readEmpty = await S.readLastExit();
S.saveLastExit(1234567890);
out.lastExit.localStorageAfter = localStorage.getItem(S.LAST_EXIT_KEY);
out.lastExit.mockStatsAfter = localStorage.getItem('mockStats');
out.lastExit.readBack = await S.readLastExit();
// фолбэки по цепочке
localStorage.removeItem('mockStats');
out.lastExit.readFallsToLocalStorage = await S.readLastExit();
localStorage.removeItem(S.LAST_EXIT_KEY);
localStorage.setItem(S.LEGACY_LAST_EXIT_KEY, '555555');
out.lastExit.readFallsToLegacy = await S.readLastExit();
localStorage.removeItem(S.LEGACY_LAST_EXIT_KEY);
localStorage.setItem(S.LAST_EXIT_KEY, 'garbage');
out.lastExit.readGarbage = await S.readLastExit();
localStorage.removeItem(S.LAST_EXIT_KEY);
out.lastExit.readAllGone = await S.readLastExit();

// ---------- Сейв: формат и миграции ----------
S.resetGame();
S.gameState.ore = 1500;
S.gameState.levels.pickaxe = 3;
S.gameState.levels.miner = 2;
S.saveGame();
out.saveJson = JSON.parse(localStorage.getItem(S.SAVE_KEY));

const migrationResults = {};
migrationResults.v1 = (() => {
    S.resetGame();
    S.applySave({
        version: 1,
        coal: 100,
        clicks: 5,
        totalMined: 150,
        levels: { pickaxe: 3, dynamite: 2, miner: 1, sledge: 7 }
    });
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v2 = (() => {
    S.resetGame();
    S.applySave({
        version: 2,
        tier: 4,
        ore: 1000,
        stars: 3,
        clicks: 44,
        lifetimeMined: 999,
        tierEarned: [10, 20, 30, 40, 50],
        levels: { pickaxe: 4, miner: 3 }
    });
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v3 = (() => {
    S.resetGame();
    S.applySave({
        version: 3,
        ore: 500,
        tier: 2,
        stars: 1,
        clicks: 10,
        lifetimeMined: 700,
        tierEarned: [700],
        levels: { pickaxe: 2 }
    });
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v4 = (() => {
    S.resetGame();
    S.applySave({
        version: 4,
        ore: 500,
        tier: 2,
        stars: 1,
        clicks: 10,
        lifetimeMined: 700,
        tierEarned: [700],
        levels: { pickaxe: 2 }
    });
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v5unknownVersion = (() => {
    S.resetGame();
    S.applySave({ version: 99, ore: 777 });
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v5garbage = (() => {
    S.resetGame();
    S.applySave(null);
    S.applySave('str');
    S.applySave(42);
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v5oreInfinity = (() => {
    S.resetGame();
    S.applySave({
        version: 5,
        ore: 1e999,
        tier: 99,
        stars: -5,
        clicks: -3,
        lifetimeMined: -1,
        tierEarned: [-2, 'x'],
        tierAnchorRate: -9
    });
    return JSON.parse(JSON.stringify(S.gameState));
})();
migrationResults.v5expiredBuffs = (() => {
    S.resetGame();
    S.applySave({
        version: 5,
        ore: 100,
        dailyBuffUntil: Date.now() - 1000,
        dailyBuffMult: 2,
        dailyCritUntil: Date.now() - 1000,
        dailyVeinUntil: Date.now() - 1000,
        miningBuffUntil: Date.now() - 1000,
        miningBuffMult: 3,
        bossBuffUntil: Date.now() - 1000,
        bossBuffMult: 3,
        itemVeinUntil: Date.now() - 1000,
        rigBuffUntil: Date.now() - 1000,
        rigBuffMult: 3,
        oilBuffUntil: Date.now() - 1000,
        oilBuffAdd: 0.25
    });
    return JSON.parse(
        JSON.stringify({
            dailyBuffUntil: S.gameState.dailyBuffUntil,
            dailyBuffMult: S.gameState.dailyBuffMult,
            dailyCritUntil: S.gameState.dailyCritUntil,
            dailyVeinUntil: S.gameState.dailyVeinUntil,
            miningBuffUntil: S.gameState.miningBuffUntil,
            miningBuffMult: S.gameState.miningBuffMult,
            bossBuffUntil: S.gameState.bossBuffUntil,
            bossBuffMult: S.gameState.bossBuffMult,
            itemVeinUntil: S.gameState.itemVeinUntil,
            rigBuffUntil: S.gameState.rigBuffUntil,
            rigBuffMult: S.gameState.rigBuffMult,
            oilBuffUntil: S.gameState.oilBuffUntil,
            oilBuffAdd: S.gameState.oilBuffAdd
        })
    );
})();
migrationResults.v5bossFightValid = (() => {
    S.resetGame();
    S.applySave({
        version: 5,
        ore: 100,
        tier: 1,
        levels: { helmet: 2 },
        bossFight: { bossId: 'boss_copper', hp: 74000, playerHp: 999999, elapsedMs: 5000 }
    });
    return JSON.parse(JSON.stringify(S.gameState.bossFight));
})();
migrationResults.v5bossFightInvalid = (() => {
    S.resetGame();
    S.applySave({ version: 5, bossFight: { bossId: 'boss_unknown', hp: 74000, playerHp: 100, elapsedMs: 5000 } });
    const unknown = JSON.parse(JSON.stringify(S.gameState.bossFight));
    S.applySave({ version: 5, bossFight: { bossId: 'boss_copper', hp: 0, playerHp: 100, elapsedMs: 5000 } });
    const hpZero = JSON.parse(JSON.stringify(S.gameState.bossFight));
    S.applySave({ version: 5, bossFight: { bossId: 'boss_copper', hp: 1e9, playerHp: 100, elapsedMs: 5000 } });
    const hpTooBig = JSON.parse(JSON.stringify(S.gameState.bossFight));
    return { unknown, hpZero, hpTooBig };
})();
migrationResults.v5metaFiltering = (() => {
    S.resetGame();
    S.applySave({
        version: 5,
        ore: 100,
        components: { scrap: 5.7, crystal: -3, unknown: 4, core: '2' },
        items: { item_bomb: 2.9, item_coffee: -1, unknown_item: 5 },
        artifacts: ['art_miner_totem', 'art_miner_totem', 'art_unknown', 'art_glove'],
        bossesDefeated: { boss_copper: true, boss_xxx: true },
        bestBossTimes: { boss_copper: 55.9, boss_xxx: 10, boss_silver: 0, boss_amethyst: -4, boss_ruby: 360000 },
        crafting: { recipeId: 'r_hardpick', endsAt: Date.now() + 60000 },
        levels: { pickaxe: 99999, miner: -4, sledge: 3.7, unknown: 5 }
    });
    return JSON.parse(
        JSON.stringify({
            components: S.gameState.components,
            items: S.gameState.items,
            artifacts: S.gameState.artifacts,
            bossesDefeated: S.gameState.bossesDefeated,
            bestBossTimes: S.gameState.bestBossTimes,
            crafting: S.gameState.crafting,
            levels: S.gameState.levels
        })
    );
})();
migrationResults.v5prefs = (() => {
    S.resetGame();
    S.applySave({
        version: 5,
        ore: 100,
        tutorialDone: false,
        soundOn: false,
        musicOn: false,
        musicVolume: 0,
        dailyStreak: 4.9,
        lastDailyDay: 123.7
    });
    return JSON.parse(
        JSON.stringify({
            tutorialDone: S.gameState.tutorialDone,
            soundOn: S.gameState.soundOn,
            musicOn: S.gameState.musicOn,
            musicVolume: S.gameState.musicVolume,
            dailyStreak: S.gameState.dailyStreak,
            lastDailyDay: S.gameState.lastDailyDay
        })
    );
})();
out.migrations = migrationResults;

// loadGame roundtrip: сохраняем, сбрасываем, восстанавливаем сырой JSON, читаем
S.resetGame();
S.gameState.ore = 4242;
S.gameState.levels.miner = 3;
S.saveGame();
const rawSave = localStorage.getItem(S.SAVE_KEY);
S.resetGame();
localStorage.setItem(S.SAVE_KEY, rawSave);
await S.loadGame();
out.loadRoundtrip = { ore: S.gameState.ore, miner: S.gameState.levels.miner };
// loadGame с мусором в сейве — старт с нуля без броска
localStorage.setItem(S.SAVE_KEY, 'not json');
await S.loadGame();
out.loadGarbageOre = S.gameState.ore;
S.resetGame();

// resetGame сохраняет настройки звука
S.gameState.soundOn = false;
S.gameState.musicVolume = 0.25;
S.gameState.ore = 100;
S.resetGame();
out.resetKeepsPrefs = { soundOn: S.gameState.soundOn, musicVolume: S.gameState.musicVolume, ore: S.gameState.ore };
S.gameState.soundOn = true;
S.gameState.musicVolume = 0.5;

// ---------- sdk-stub ----------
out.sdkStub = {};
S.resetGame();
SDK.YandexSDKStub.player.setData('{"a":1}');
out.sdkStub.setDataString = localStorage.getItem(SDK.SAVE_STORAGE_KEY);
out.sdkStub.getDataString = SDK.YandexSDKStub.player.getData();
// legacy-миграция ключа
localStorage.removeItem(SDK.SAVE_STORAGE_KEY);
localStorage.setItem(SDK.LEGACY_SAVE_KEY, '{"legacy":true}');
out.sdkStub.getDataLegacy = SDK.YandexSDKStub.player.getData();
out.sdkStub.migratedKey = localStorage.getItem(SDK.SAVE_STORAGE_KEY);
out.sdkStub.legacyKeyStillThere = localStorage.getItem(SDK.LEGACY_SAVE_KEY);
// getStats фильтрация
S.resetGame();
await SDK.YandexSDKStub.player.setStats({ a: 1, b: 2 });
out.sdkStub.getStatsAll = await SDK.YandexSDKStub.player.getStats();
out.sdkStub.getStatsFiltered = await SDK.YandexSDKStub.player.getStats(['b']);
out.sdkStub.setStatsReturns = await SDK.YandexSDKStub.player.setStats({});

// ---------- unlockTier / forceNextTier / canUnlockTier ----------
S.resetGame();
out.tiers_flow = {};
out.tiers_flow.canUnlockFresh = S.canUnlockTier();
S.gameState.ore = 3000;
out.tiers_flow.canUnlockWithOre = S.canUnlockTier();
out.tiers_flow.unlock = S.unlockTier();
out.tiers_flow.tierAfter = S.gameState.tier;
out.tiers_flow.oreAfter = S.gameState.ore;
out.tiers_flow.forceNext = S.forceNextTier();
out.tiers_flow.tierAfterForce = S.gameState.tier;
out.tiers_flow.oreAfterForce = S.gameState.ore;
out.tiers_flow.forceLastTier = (() => {
    S.gameState.tier = 11;
    return S.forceNextTier();
})();
out.tiers_flow.tierAfterLastForce = S.gameState.tier;
S.resetGame();

// ---------- upgradeIncomeDelta / pickFreeUpgrade ----------
S.resetGame();
out.delta = {};
for (const id of [
    'pickaxe',
    'sledge',
    'miner',
    'drill',
    'tech',
    'dynamite',
    'lucky',
    'resonance',
    'lantern',
    'warehouse'
]) {
    out.delta[id] = S.upgradeIncomeDelta(id);
}
S.gameState.levels.pickaxe = 10;
out.delta.pickaxeL10 = S.upgradeIncomeDelta('pickaxe');
S.resetGame();
out.pickFreeFresh = S.pickFreeUpgrade()?.id ?? null;
S.gameState.ore = 0;
out.pickFreeNoOre = S.pickFreeUpgrade()?.id ?? null;

// ---------- layout ----------
out.layout = {};
out.layout.landscape720 = L.computeLayout(1280, 720);
out.layout.portrait390x844Base = L.baseForOrientation(390, 844);
out.layout.portrait390x844 = L.computeLayout(720, 1558);
out.layout.square = L.computeLayout(720, 720);
out.layout.landscape900x506 = L.computeLayout(1280, 720); // FIT: внутренняя сетка не меняется
out.layout.baseLandscape = L.baseForOrientation(1280, 720);
out.layout.basePortraitTall = L.baseForOrientation(360, 2000); // h клампится к 1680
out.layout.basePortraitShort = L.baseForOrientation(360, 640); // h клампится к 1280
out.layout.constants = {
    LANDSCAPE_BASE: L.LANDSCAPE_BASE,
    PORTRAIT_H_MIN: L.PORTRAIT_H_MIN,
    PORTRAIT_H_MAX: L.PORTRAIT_H_MAX
};

// ---------- createInitialState (полнота дефолтов) ----------
S.resetGame();
out.initialState = JSON.parse(JSON.stringify(S.createInitialState()));

console.log(JSON.stringify(out, null, 2));
