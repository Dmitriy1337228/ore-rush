// Node-проверки меты (П1 state.js): каталоги боссов/компонентов/артефактов/предметов
// и рецептов, сейв v5 + миграция v4->v5, истёкшие бафы предметов, якорь спуска не
// сдвигается бафами предметов, крафт/верстак/claim/useItem на подменённом Date.now,
// grantBossKill (баунти/дроп/артефакт), артефактные множители, мета переживает престиж.
// Запуск: node scripts/verify-mine-meta.mjs

let failures = 0;
function check(name, cond, detail = '') {
    const ok = Boolean(cond);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
}

const state = await import('../src/state.js');
const {
    SAVE_VERSION, TIERS, BOSSES, COMPONENTS, ARTIFACTS, ITEMS, CRAFT_RECIPES,
    BOSS_HP_BASE, BOSS_FIGHT_SECONDS, BOSS_BOUNTY_SECONDS, bossHpFor,
    createInitialState, gameState, applySave, resetGame, doPrestige, DIAMOND_INDEX,
    getArtifactBonus, getItemBuffMult, isItemVeinActive, getBossDamageMult,
    rollClickGain, rollBossHit, grantBossKill, addOre,
    canCraft, startCraft, canClaimCraft, claimCraft, useItem,
    updateBossFight, clearBossFight, saveGame,
    getClickDamage, getOrePerSecond, getExpectedClickGain, getEarningRate,
    getCritChance, getAutoClicksPerSecond, getOfflineRate
} = state;

// Подменяемое время: проверяем wall-clock бафы/верстак и подмотку вперёд.
const realNow = Date.now;
const realRandom = Math.random;
let now = realNow();
Date.now = () => now;
// сброс к «реальному now» с сохранением мока: Date.now остаётся подменённым до конца прогона
function restoreClock() {
    now = realNow();
    Math.random = realRandom;
}

// --- 1. Каталоги: состав и согласованность ---
check('SAVE_VERSION = 5', SAVE_VERSION === 5, `получено ${SAVE_VERSION}`);
check('BOSSES: 6', BOSSES.length === 6, `получено ${BOSSES.length}`);
check('COMPONENTS: 5', COMPONENTS.length === 5, `получено ${COMPONENTS.length}`);
check('ARTIFACTS: 9', ARTIFACTS.length === 9, `получено ${ARTIFACTS.length}`);
check('ITEMS: 5', ITEMS.length === 5, `получено ${ITEMS.length}`);
check('CRAFT_RECIPES: 8', CRAFT_RECIPES.length === 8, `получено ${CRAFT_RECIPES.length}`);
check('константы боссов', BOSS_HP_BASE === 25000 && BOSS_FIGHT_SECONDS === 60 && BOSS_BOUNTY_SECONDS === 90);

const compIds = COMPONENTS.map((c) => c.id);
const artIds = ARTIFACTS.map((a) => a.id);
const itemIds = ITEMS.map((i) => i.id);
const recipeIds = CRAFT_RECIPES.map((r) => r.id);
const bossIds = BOSSES.map((b) => b.id);
const uniq = (arr) => new Set(arr).size === arr.length;
check('ids каталогов уникальны', [bossIds, compIds, artIds, itemIds, recipeIds].every(uniq));
check('компоненты: имя и icon comp_<id>', COMPONENTS.every((c) => c.name && c.icon === 'comp_' + c.id));

check('боссы: поля/тиры/HP-множитель', BOSSES.every((b) =>
    b.name && TIERS[b.tier] !== undefined && b.hpMult > 0 && b.icon === b.id));
check('боссы: tiers совпадают с порядком [1,3,5,7,9,11]',
    JSON.stringify(BOSSES.map((b) => b.tier)) === JSON.stringify([1, 3, 5, 7, 9, 11]));
check('боссы: дропы ссылаются на компоненты, диапазон [min,max] корректен', BOSSES.every((b) =>
    Object.keys(b.drops).every((id) => compIds.includes(id)) &&
    Object.values(b.drops).every(([min, max]) => Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min)));
check('боссы: артефакт из каталога', BOSSES.every((b) => artIds.includes(b.artifact)));
check('боссы: hpFor = ceil(25000 x 3^tier x hpMult)', BOSSES.every((b) =>
    bossHpFor(b) === Math.ceil(BOSS_HP_BASE * Math.pow(3, b.tier) * b.hpMult)),
    BOSSES.map((b) => `${b.id}:${bossHpFor(b)}`).join(' '));

check('артефакты: имя/desc/бонусы, источники существуют', ARTIFACTS.every((a) =>
    a.name && a.desc && a.bonuses &&
    (bossIds.includes(a.source) || recipeIds.includes(a.source))));
const multFields = ['passiveMult', 'clickMult', 'bossDamageMult'];
const flatFields = ['critAdd', 'autoCpsAdd', 'offlineAdd', 'dropBonus'];
check('артефакты: только известные поля бонусов', ARTIFACTS.every((a) =>
    Object.keys(a.bonuses).every((f) => multFields.includes(f) || flatFields.includes(f))));
check('артефакты: множители >1, плоские >0', ARTIFACTS.every((a) =>
    multFields.every((f) => a.bonuses[f] === undefined || a.bonuses[f] > 1) &&
    flatFields.every((f) => a.bonuses[f] === undefined || a.bonuses[f] > 0)));
check('артефакты: каждый из 9 получаем (босс или рецепт)', ARTIFACTS.every((a) =>
    BOSSES.some((b) => b.artifact === a.id) || CRAFT_RECIPES.some((r) => r.result.kind === 'artifact' && r.result.id === a.id)));

check('предметы: имя/desc/effect/stackMax', ITEMS.every((i) =>
    i.name && i.desc && i.effect && Number.isInteger(i.stackMax) && i.stackMax > 0));
check('предметы: эффекты из известного набора', ITEMS.every((i) =>
    Object.keys(i.effect).every((f) => ['bossMult', 'miningMult', 'veinForce', 'instantSec', 'durMs'].includes(f))));
check('предметы: только item_bomb — bossUse', ITEMS.every((i) =>
    i.bossUse === undefined ? true : i.id === 'item_bomb'));
check('предметы: временные эффекты с durMs, instantSec без durMs', ITEMS.every((i) => {
    const e = i.effect;
    if (e.durMs !== undefined && e.durMs > 0 && (e.bossMult || e.miningMult || e.veinForce)) return true;
    return e.instantSec !== undefined && e.durMs === undefined;
}));
check('предметы: cost ссылаются на компоненты', ITEMS.every((i) =>
    Object.keys(i.cost).every((id) => compIds.includes(id)) && Object.values(i.cost).every((v) => v > 0)));

check('рецепты: результат item|artifact существует', CRAFT_RECIPES.every((r) =>
    r.result.kind === 'item' ? itemIds.includes(r.result.id) && Number.isInteger(r.result.n) && r.result.n > 0
    : r.result.kind === 'artifact' && artIds.includes(r.result.id)));
check('рецепты: costs ссылаются на компоненты', CRAFT_RECIPES.every((r) =>
    Object.keys(r.cost).every((id) => compIds.includes(id)) && Object.values(r.cost).every((v) => v > 0)));
check('рецепты: craftMs 0 для предметов, >0 для артефактов', CRAFT_RECIPES.every((r) =>
    r.result.kind === 'item' ? r.craftMs === 0 : r.craftMs > 0));
check('рецепты: cost предмета совпадает с ITEMS.cost', CRAFT_RECIPES.filter((r) => r.result.kind === 'item').every((r) => {
    const def = ITEMS.find((i) => i.id === r.result.id);
    return JSON.stringify(def.cost) === JSON.stringify(r.cost);
}));

// --- 2. createInitialState: мета-поля с дефолтов ---
{
    const init = createInitialState();
    check('initial: компоненты/предметы пустые объекты, артефакты/боссы пустые',
        JSON.stringify(init.components) === '{}' && JSON.stringify(init.items) === '{}' &&
        JSON.stringify(init.artifacts) === '[]' && JSON.stringify(init.bossesDefeated) === '{}');
    check('initial: crafting null, бафы предметов нейтральны',
        init.crafting === null && init.miningBuffUntil === 0 && init.miningBuffMult === 1 &&
        init.bossBuffUntil === 0 && init.bossBuffMult === 1 && init.itemVeinUntil === 0);
}

// --- 3. Миграция v4 -> v5 и валидация сейва ---
{
    restoreClock();
    resetGame();
    applySave({
        version: 4, ore: 1234, tier: 5, stars: 2, clicks: 10, lifetimeMined: 9999,
        tierEarned: TIERS.map(() => 0), tierAnchorRate: 4321, levels: { miner: 3 },
        dailyStreak: 3, lastDailyDay: Math.floor(realNow() / 86400e3) - 1
    });
    check('миграция v4->v5: сейв принят, версия 5', gameState.version === 5 && gameState.ore === 1234 && gameState.tier === 5 && gameState.tierAnchorRate === 4321);
    check('миграция v4->v5: прогресс сохранён', gameState.levels.miner === 3 && gameState.stars === 2 && gameState.dailyStreak === 3);
    check('миграция v4->v5: мета-поля с дефолтов',
        JSON.stringify(gameState.components) === '{}' &&
        gameState.artifacts.length === 0 && gameState.crafting === null &&
        Object.keys(gameState.bossesDefeated).length === 0 &&
        gameState.miningBuffUntil === 0 && gameState.miningBuffMult === 1 &&
        gameState.bossBuffUntil === 0 && gameState.bossBuffMult === 1 && gameState.itemVeinUntil === 0);

    applySave({
        version: 5, ore: 777, tier: 2, stars: 1, tierEarned: TIERS.map(() => 0), levels: {},
        components: { scrap: 7, crystal: -3, core: 2.9, essence: 1, relic: 0, comp_unknown: 5 },
        items: { item_bomb: 4, item_coffee: 1.9, item_nope: 3 },
        artifacts: ['art_glove', 'art_bogus', 'art_miner_totem', 'art_glove'],
        bossesDefeated: { boss_copper: true, boss_bogus: true },
        crafting: { recipeId: 'r_hardpick', endsAt: now + 600e3 },
        miningBuffUntil: now + 60e3, miningBuffMult: 10,
        bossBuffUntil: now - 1000, bossBuffMult: 2,
        itemVeinUntil: now + 1000
    });
    check('валидация v5: счётчики целые >= 0, чужие ключи отброшены',
        gameState.components.scrap === 7 && gameState.components.crystal === 0 &&
        gameState.components.core === 2 && gameState.components.essence === 1 && gameState.components.relic === 0 &&
        gameState.components.comp_unknown === undefined);
    check('валидация v5: предметы клампятся, чужие ключи отброшены',
        gameState.items.item_bomb === 4 && gameState.items.item_coffee === 1 && gameState.items.item_nope === undefined);
    check('валидация v5: артефакты — только существующие id, дубли схлопнуты',
        JSON.stringify(gameState.artifacts) === JSON.stringify(['art_glove', 'art_miner_totem']));
    check('валидация v5: bossesDefeated — только известные id',
        gameState.bossesDefeated.boss_copper === true && gameState.bossesDefeated.boss_bogus === undefined &&
        Object.keys(gameState.bossesDefeated).length === 1);
    check('валидация v5: верстак — валидный рецепт с endsAt > 0 принят',
        gameState.crafting && gameState.crafting.recipeId === 'r_hardpick' && gameState.crafting.endsAt === now + 600e3);
    check('валидация v5: активные бафы предметов приняты', gameState.miningBuffUntil === now + 60e3 && gameState.miningBuffMult === 10 && gameState.itemVeinUntil === now + 1000);
    check('валидация v5: истёкший bossBuff не resurrect', gameState.bossBuffUntil === 0);

    // битый верстак и истёкшие бафы — сброс, не выброс
    applySave({
        version: 5, ore: 0, tier: 0, stars: 0, tierEarned: TIERS.map(() => 0), levels: {},
        components: {}, items: {}, artifacts: [], bossesDefeated: {},
        crafting: { recipeId: 'r_no_such', endsAt: now + 600e3 },
        miningBuffUntil: now - 60e3, miningBuffMult: 3,
        bossBuffUntil: now - 1, bossBuffMult: 2, itemVeinUntil: now - 1
    });
    check('валидация v5: crafting c неизвестным рецептом -> null', gameState.crafting === null);
    check('валидация v5: истёкшие бафы не resurrect (все три слота)',
        gameState.miningBuffUntil === 0 && gameState.miningBuffMult === 1 &&
        gameState.bossBuffUntil === 0 && gameState.bossBuffMult === 1 && gameState.itemVeinUntil === 0);
}

// --- 4. Бафы предметов: факт добычи множится, якорь спуска не сдвигается ---
{
    restoreClock();
    resetGame();
    Object.assign(gameState.levels, { miner: 100, pickaxe: 10, dynamite: 3, lucky: 5 });
    const gps0 = getOrePerSecond();
    const anchor0 = getExpectedClickGain();
    check('якорь: нейтральный баф getItemBuffMult()=1', getItemBuffMult() === 1 && !isItemVeinActive());
    gameState.miningBuffUntil = now + 60e3;
    gameState.miningBuffMult = 10;
    check('баф x10 множит фактическую пассивную добычу', Math.abs(getOrePerSecond() - gps0 * 10) < 1e-6);
    check('ЯКОРЬ: miningBuffMult x10 не сдвигает getExpectedClickGain',
        Math.abs(getExpectedClickGain() - anchor0) < 1e-9,
        `delta=${Math.abs(getExpectedClickGain() - anchor0)}`);
    gameState.itemVeinUntil = now + 60e3;
    check('ЯКОРЬ: форс жилы предметом не сдвигает getExpectedClickGain',
        Math.abs(getExpectedClickGain() - anchor0) < 1e-9 && isItemVeinActive());
    // форс жилы идёт в фактический клик (как дневная жила)
    Math.random = () => 0.99;
    check('жила-стим форсирует жилу в rollClickGain', rollClickGain(null).lucky === true);
    restoreClock();
    // артефактные множители В ЯКОРЕ опосредованно (симметрия престижа)
    resetGame();
    Object.assign(gameState.levels, { miner: 100, pickaxe: 10, dynamite: 3, lucky: 5 });
    const a0 = getExpectedClickGain();
    gameState.artifacts.push('art_glove'); // clickMult 1.1
    check('артефакт clickMult входит в якорь симметрично престижу',
        Math.abs(getExpectedClickGain() / a0 - 1.1) < 1e-6);
    // предметный баф по-прежнему вне якоря при артефакте
    gameState.miningBuffUntil = now + 60e3;
    gameState.miningBuffMult = 10;
    const aGlove = getExpectedClickGain();
    check('ЯКОРЬ: баф предмета не сдвигает якорь и с артефактами',
        Math.abs(getExpectedClickGain() - aGlove) < 1e-9);
}

// --- 5. Артефактные множители/прибавки считаются ---
{
    restoreClock();
    resetGame();
    check('артефакты: без них — нейтральные множители',
        getArtifactBonus('clickMult') === 1 && getArtifactBonus('passiveMult') === 1 &&
        getArtifactBonus('bossDamageMult') === 1 && getArtifactBonus('critAdd') === 0 &&
        getArtifactBonus('autoCpsAdd') === 0 && getArtifactBonus('offlineAdd') === 0 &&
        getArtifactBonus('dropBonus') === 0);
    gameState.artifacts.push('art_miner_totem'); // passiveMult 1.1
    gameState.artifacts.push('art_core_battery'); // passiveMult 1.15
    check('артефакты: passiveMult перемножается (1.1 x 1.15)',
        Math.abs(getArtifactBonus('passiveMult') - 1.1 * 1.15) < 1e-9);
    check('артефакты: passiveMult x гпс', Math.abs(getOrePerSecond() - 0) < 1e-12);
    gameState.levels.miner = 100; // gps = 100 x 1.1 x 1.15
    check('артефакты: passiveMult применён к добыче',
        Math.abs(getOrePerSecond() - 100 * 1.1 * 1.15) < 1e-9);
    gameState.artifacts.push('art_glove'); // clickMult 1.1
    gameState.levels.pickaxe = 5; // clickDamage = 6 x 1.1
    check('артефакты: clickMult применён к урону клика',
        Math.abs(getClickDamage() - 6 * 1.1) < 1e-9);
    gameState.levels.dynamite = 3; // 3 x 0.03 к шансу крита
    gameState.artifacts.push('art_lucky_charm'); // critAdd 0.03
    check('артефакты: critAdd суммируется (0.05 + 3x0.03 + 0.03 = 0.17)',
        Math.abs(getCritChance() - (0.05 + 0.09 + 0.03)) < 1e-9);
    gameState.artifacts.push('art_magnet_ring'); // autoCpsAdd 0.5
    gameState.levels.robotarm = 2; // 1 + 0.5
    check('артефакты: autoCpsAdd прибавляется к робо-руке', Math.abs(getAutoClicksPerSecond() - 1.5) < 1e-9);
    gameState.artifacts.push('art_lantern_old'); // offlineAdd 0.05
    check('артефакты: offlineAdd прибавляется к офлайн-ставке',
        Math.abs(getOfflineRate() - (0.2 + 0.05)) < 1e-9);
    gameState.artifacts.push('art_hardpick'); // bossDamageMult 1.25
    gameState.artifacts.push('art_ancient_pick'); // bossDamageMult 1.1
    check('артефакты: bossDamageMult перемножается (1.25 x 1.1)',
        Math.abs(getBossDamageMult() - 1.25 * 1.1) < 1e-9);
}

// --- 6. Крафт/верстак/claim на подменённом Date.now ---
{
    restoreClock();
    resetGame();
    check('крафт: без компонентов рецепты недоступны', CRAFT_RECIPES.every((r) => !canCraft(r.id)));
    check('крафт: неизвестный рецепт -> false', !canCraft('r_no_such') && !startCraft('r_no_such'));
    Object.assign(gameState.components, { scrap: 10, crystal: 5, core: 5, relic: 5, essence: 5 });
    check('крафт: мгновенные рецепты доступны (ингредиенты есть)',
        CRAFT_RECIPES.filter((r) => r.craftMs === 0).every((r) => canCraft(r.id)));
    check('крафт: артефактные рецепты доступны', CRAFT_RECIPES.filter((r) => r.craftMs > 0).every((r) => canCraft(r.id)));

    // стаки: под бомбу осталось 1 место (запас 4, стак 5) при выдаче x2 — отказ
    gameState.items.item_bomb = 4;
    check('крафт: стаки — места под результат x2 нет -> отказ', !canCraft('r_bomb'));
    gameState.items.item_bomb = 2; // место 3 >= 2
    check('крафт: стаки — места хватает', canCraft('r_bomb'));

    // таймерный крафт артефакта
    const compsBefore = { ...gameState.components };
    check('крафт: startCraft списывает стоимость и занимает верстак',
        startCraft('r_hardpick') === true &&
        gameState.components.crystal === compsBefore.crystal - 3 &&
        gameState.components.core === compsBefore.core - 1 &&
        gameState.crafting && gameState.crafting.recipeId === 'r_hardpick' &&
        gameState.crafting.endsAt === now + 600e3);
    check('крафт: верстак занят — новый крафт и прочие рецепты отказаны',
        !canCraft('r_hardpick') && !canCraft('r_bomb') && !startCraft('r_bomb'));
    check('крафт: claim раньше срока -> false', !canClaimCraft() && claimCraft() === null);
    now += 600e3 + 1;
    check('крафт: после подмотки времени canClaimCraft = true', canClaimCraft());
    const res = claimCraft();
    check('крафт: claim выдаёт артефакт и освобождает верстак',
        res && res.id === 'r_hardpick' && gameState.artifacts.includes('art_hardpick') &&
        gameState.crafting === null);
    // повторный крафт того же артефакта: не дублируется в коллекции
    Object.assign(gameState.components, { crystal: 5, core: 5 });
    startCraft('r_hardpick');
    now += 600e3 + 1;
    claimCraft();
    check('крафт: повторный артефакт не дублируется в коллекции',
        gameState.artifacts.filter((a) => a === 'art_hardpick').length === 1);

    // мгновенный крафт предметов (craftMs = 0): claim сразу
    Object.assign(gameState.components, { scrap: 10 });
    gameState.items.item_bomb = 0;
    check('крафт: мгновенный рецепт — claim сразу после startCraft',
        startCraft('r_bomb') && canClaimCraft() && claimCraft() &&
        gameState.items.item_bomb === 2 && gameState.crafting === null);

    // персист босс-боя: валидация сейва, update/clear
    const copperMax = bossHpFor(BOSSES.find((b) => b.id === 'boss_copper'));
    gameState.bossFight = { bossId: 'boss_copper', hp: copperMax - 100, elapsedMs: 65000 };
    const bossFightSave = JSON.parse(saveGameToString());
    check('персист боя: валидный бой сохраняется и принимается сейвом',
        bossFightSave.bossFight && bossFightSave.bossFight.bossId === 'boss_copper' &&
        applySave(JSON.parse(JSON.stringify(bossFightSave))) !== false &&
        gameState.bossFight && gameState.bossFight.hp === copperMax - 100 &&
        gameState.bossFight.elapsedMs === 65000);
    check('персист боя: неизвестный босс отбрасывается',
        (() => { const d = { ...bossFightSave, bossFight: { bossId: 'boss_nope', hp: 10, elapsedMs: 1 } }; applySave(d); return gameState.bossFight === null; })());
    check('персист боя: hp <= 0 и hp > максимума отбрасываются',
        (() => {
            let bad = 0;
            for (const hp of [0, -5, copperMax + 1]) {
                applySave({ ...bossFightSave, bossFight: { bossId: 'boss_copper', hp, elapsedMs: 1 } });
                if (gameState.bossFight !== null) bad++;
            }
            return bad === 0;
        })());
    gameState.bossFight = { bossId: 'boss_copper', hp: copperMax - 100, elapsedMs: 1000 };
    updateBossFight(copperMax - 250, 9876);
    check('персист боя: updateBossFight пишет hp/время (ceil/floor)',
        gameState.bossFight.hp === copperMax - 250 && gameState.bossFight.elapsedMs === 9876);
    clearBossFight();
    check('персист боя: clearBossFight гасит запись', gameState.bossFight === null);

}

// Сериализация сейва (saveGame пишет в стаб — читаем через тот же gameState):
// используем JSON gameState напрямую, как его сериализует saveGame.
function saveGameToString() {
    return JSON.stringify(gameState);
}

// --- 7. useItem: активация, слоты бафов, перезарядка, мгновенный расходник ---
{
    restoreClock();
    resetGame();
    check('useItem: пустой запас -> false', ITEMS.every((i) => !useItem(i.id)));
    check('useItem: неизвестный предмет -> false', !useItem('item_no_such'));
    Object.assign(gameState.items, { item_bomb: 3, item_belt: 2, item_coffee: 4, item_ration: 3, item_stim: 2 });
    check('useItem: бомба вне боя -> false, расход не списывается', !useItem('item_bomb') && gameState.items.item_bomb === 3);
    check('useItem: бомба в бою -> баф урона боссу',
        useItem('item_bomb', true) === true && gameState.items.item_bomb === 2 &&
        gameState.bossBuffMult === 2 && gameState.bossBuffUntil === now + 30e3);
    check('useItem: пояс (слот добычи) активен независимо от бомбы',
        useItem('item_belt') === true && gameState.miningBuffMult === 3 && gameState.miningBuffUntil === now + 180e3);
    now += 100e3;
    // пояс догорает ещё 80с (>30с) — кофе в тот же слот отказан
    check('useItem: тот же слот с остатком >30с -> отказ', !useItem('item_coffee') && gameState.items.item_coffee === 4);
    now += 60e3; // остаток 20с <= 30с — перезарядка сверху разрешена
    check('useItem: остаток <=30с — перезапуск слота разрешён (полная длительность)',
        useItem('item_coffee') === true && gameState.items.item_coffee === 3 &&
        gameState.miningBuffMult === 2 && gameState.miningBuffUntil === now + 300e3);
    // бомба: слот босса не зависит от добычи
    check('useItem: повторная бомба в бою (новый слот активен) — разрешена',
        useItem('item_bomb', true) === true && gameState.bossBuffMult === 2 && gameState.bossBuffUntil === now + 30e3);
    // жила-стим: отдельный слот
    check('useItem: стимулятор жилы -> форс жилы', useItem('item_stim') === true && isItemVeinActive() && gameState.itemVeinUntil === now + 120e3);
    // сухпаёк: мгновенный доход = instantSec x текущий полный доход
    const oreBefore = gameState.ore;
    const rate = getEarningRate();
    check('useItem: сухпаёк даёт 60с полного дохода',
        useItem('item_ration') === true && gameState.items.item_ration === 2 &&
        Math.abs(gameState.ore - oreBefore - 60 * rate) < 1e-6);
    check('useItem: третий сухпаёк списывается, бафов не создаёт',
        useItem('item_ration') === true && gameState.items.item_ration === 1 &&
        gameState.miningBuffMult === 2 && gameState.bossBuffMult === 2);
}

// --- 8. rollBossHit: клик + артефакты/бомба, без мутаций ---
{
    restoreClock();
    resetGame();
    Math.random = () => 0.99; // без крита/жилы
    Object.assign(gameState.levels, { pickaxe: 5, resonance: 0 });
    const clickGain = rollClickGain(null).gain;
    const hit = rollBossHit();
    check('rollBossHit: база = клик без мутации', Math.abs(hit.gain - clickGain) < 1e-9 && hit.crit === false && hit.lucky === false);
    gameState.artifacts.push('art_hardpick'); // x1.25
    gameState.items.item_bomb = 1;
    useItem('item_bomb', true); // x2
    const hit2 = rollBossHit();
    check('rollBossHit: артефакт x бомба перемножаются',
        Math.abs(hit2.gain - clickGain * 1.25 * 2) < 1e-9);
    restoreClock();
}

// --- 9. grantBossKill: баунти/дроп/артефакт, идемпотентность артефакта ---
{
    restoreClock();
    resetGame();
    Math.random = () => 0; // минимальные дропы
    check('grantBossKill: неизвестный босс -> null', grantBossKill('boss_no_such') === null);
    const copper = BOSSES.find((b) => b.id === 'boss_copper');
    const rate = getEarningRate();
    const oreBefore = gameState.ore;
    const res = grantBossKill('boss_copper');
    check('grantBossKill: баунти = ceil(90с полного дохода)',
        res && res.bounty === Math.ceil(BOSS_BOUNTY_SECONDS * rate) &&
        Math.abs(gameState.ore - oreBefore - res.bounty) < 1e-6);
    check('grantBossKill: минимальный дроп по таблице',
        res.comps.scrap === copper.drops.scrap[0] &&
        gameState.components.scrap === copper.drops.scrap[0]);
    check('grantBossKill: босс отмечен побеждённым', gameState.bossesDefeated.boss_copper === true);
    check('grantBossKill: артефакт выдан первый раз',
        res.artifactId === 'art_miner_totem' && gameState.artifacts.includes('art_miner_totem'));
    const compsAfterFirst = gameState.components.scrap;
    const res2 = grantBossKill('boss_copper');
    check('grantBossKill: артефакт повторно НЕ выдаётся',
        res2.artifactId === null && gameState.artifacts.filter((a) => a === 'art_miner_totem').length === 1);
    check('grantBossKill: второй дроп копится поверх', gameState.components.scrap === compsAfterFirst + res2.comps.scrap);

    // dropBonus артефакта: floor(n x (1+dropBonus))
    gameState.artifacts.push('art_deep_compass'); // dropBonus 0.15
    const diamond = BOSSES.find((b) => b.id === 'boss_diamond');
    const compBefore = { ...gameState.components };
    const res3 = grantBossKill('boss_diamond');
    const expectedEssence = Math.floor(diamond.drops.essence[0] * 1.15);
    const expectedCore = Math.floor(diamond.drops.core[0] * 1.15);
    check('grantBossKill: dropBonus применяется к дропу (ролл min)',
        res3.comps.essence === expectedEssence && res3.comps.core === expectedCore &&
        gameState.components.essence === (compBefore.essence || 0) + expectedEssence);
    restoreClock();
}

// --- 10. Мета переживает престиж, боссы сбрасываются ---
{
    restoreClock();
    resetGame();
    gameState.components.scrap = 5;
    gameState.artifacts.push('art_glove');
    gameState.items.item_coffee = 3;
    gameState.crafting = { recipeId: 'r_bomb', endsAt: now + 60e3 };
    gameState.bossesDefeated.boss_copper = true;
    gameState.tierEarned[DIAMOND_INDEX] = 1e12; // 1 звезда
    const p = doPrestige();
    check('престиж: сработал', p >= 1);
    check('престиж: мета переживает (компоненты/артефакты/предметы/верстак)',
        gameState.components.scrap === 5 && gameState.artifacts.includes('art_glove') &&
        gameState.items.item_coffee === 3 && gameState.crafting && gameState.crafting.recipeId === 'r_bomb');
    check('престиж: bossesDefeated сброшен (боссов можно бить снова)',
        Object.keys(gameState.bossesDefeated).length === 0);
    check('престиж: прогресс руды/тиров сброшен', gameState.ore === 0 && gameState.tier === 0 && gameState.stars >= 1);
}

// --- 11. resetGame: все новые поля к дефолтам ---
{
    restoreClock();
    resetGame();
    const init = createInitialState();
    const fields = ['components', 'artifacts', 'items', 'crafting', 'bossesDefeated',
        'miningBuffUntil', 'miningBuffMult', 'bossBuffUntil', 'bossBuffMult', 'itemVeinUntil'];
    check('resetGame: мета-поля сброшены к дефолтам',
        fields.every((f) => JSON.stringify(gameState[f]) === JSON.stringify(init[f])));
    check('resetGame: версия 5', gameState.version === SAVE_VERSION);
}

restoreClock();
console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ МЕТЫ ЗЕЛЁНЫЕ' : `\nПРОВАЛОВ: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
