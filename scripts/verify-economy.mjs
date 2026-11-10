// Node-проверки экономики: 12 тиров, цена спуска «снапшот от якоря» (v4),
// гейты глубины каталога (tier), капы кликовой цепочки, миграции v2->v3->v4.
// Запуск: node scripts/verify-economy.mjs

let failures = 0;
function check(name, cond, detail = '') {
    const ok = Boolean(cond);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
}

const state = await import('../src/state.js');
const {
    TIERS, TIER_STEP, TIER_COST_MULT, TIER_INCOME_MULT, UPGRADES,
    UNLOCK_BASE_SECONDS, UNLOCK_SECONDS_GROWTH, UNLOCK_FLOOR,
    unlockSecondsFor, computeNextUnlockPrice, getUnlockEtaSeconds, getNextUnlockPrice,
    DIAMOND_INDEX, PRESTIGE_REQUIREMENT, SAVE_VERSION,
    createInitialState, gameState, applySave,
    getUpgradeCost, getUpgradeDef, getUpgradeLevel, isUpgradeAvailable, canBuy, buyUpgrade, isMaxed,
    getEarningRate, fmt
} = state;

// --- 1. Лестница тиров ---
check('12 тиров', TIERS.length === 12, `получено ${TIERS.length}`);
const expectedKeys = ['coal', 'copper', 'iron', 'silver', 'gold', 'amethyst', 'emerald', 'ruby', 'sapphire', 'platinum', 'uranium', 'diamond'];
check('порядок руд', TIERS.map(t => t.key).join(',') === expectedKeys.join(','));
check('у каждого тира iconKey/blockPrefix/floatColor/adj', TIERS.every(t => t.iconKey && t.blockPrefix && t.floatColor && t.adj));
check('DIAMOND_INDEX = 11', DIAMOND_INDEX === 11);

// --- 2. Множители ---
check('TIER_STEP = {cost:3, income:3} (окупаемость инвариантна тиру)', TIER_STEP.cost === 3 && TIER_STEP.income === 3);
check('TIER_COST_MULT(0)=1, (2)=9, (11)=3^11',
    TIER_COST_MULT(0) === 1 && TIER_COST_MULT(2) === 9 && Math.abs(TIER_COST_MULT(11) - Math.pow(3, 11)) < 1e-6);
check('TIER_INCOME_MULT(11)=3^11=177147', TIER_INCOME_MULT(11) === 177147);
{
    const t0 = gameState.tier;
    gameState.tier = 2;
    check('цена кирки ур.0 на тире 2 = ceil(15*9)=135', getUpgradeCost('pickaxe') === 135, `получено ${getUpgradeCost('pickaxe')}`);
    gameState.tier = t0;
}

// --- 3. Цена спуска: снапшот от якоря ---
check('unlockSecondsFor(0)=180', unlockSecondsFor(0) === 180);
check('unlockSecondsFor(11)~180*2.95^11', Math.abs(unlockSecondsFor(11) - 180 * Math.pow(2.95, 11)) < 1e-6);
check('computeNextUnlockPrice(11)=null (последний тир)', computeNextUnlockPrice(11) === null);
check('цена при нулевом доходе = UNLOCK_FLOOR', computeNextUnlockPrice(0) === UNLOCK_FLOOR);
{
    // Вход в тир 1 с шахтёром 100: якорь лениво фиксируется от ставки на входе.
    const init = createInitialState();
    Object.assign(gameState, init, { levels: { ...init.levels, miner: 100 }, tier: 1, stars: 0, ore: 0, tierAnchorRate: 0 });
    const anchorRate = getEarningRate(); // 300 + 3*3.6 = 310.8
    const priceEntry = computeNextUnlockPrice(1);
    check('якорь зафиксирован лениво при первом обращении', gameState.tierAnchorRate > 0 && Math.abs(gameState.tierAnchorRate - anchorRate) < 1e-9,
        `anchor=${gameState.tierAnchorRate}`);
    check('цена при входе = N(1) сек якоря', priceEntry === Math.ceil(unlockSecondsFor(1) * anchorRate),
        `${priceEntry} vs ${Math.ceil(unlockSecondsFor(1) * anchorRate)}`);

    // Снапшот: ЛЮБАЯ прокачка не меняет цену — покупка никогда не отбрасывает.
    gameState.levels.miner = 200;
    const p200 = computeNextUnlockPrice(1);
    gameState.levels.miner = 1000;
    const p1000 = computeNextUnlockPrice(1);
    check('снапшот: цена неизменна при любой прокачке', p200 === priceEntry && p1000 === priceEntry,
        `${p200}, ${p1000} = ${priceEntry}`);

    // ETA падает от прокачки: ставка растёт, цена константна.
    gameState.levels.miner = 100;
    gameState.ore = 0;
    const etaBefore = getUnlockEtaSeconds();
    gameState.levels.miner = 500;
    const etaAfter = getUnlockEtaSeconds();
    check('ETA падает от прокачки (более чем в 4 раза)', etaAfter < etaBefore / 4, `${etaBefore.toFixed(0)}с -> ${etaAfter.toFixed(0)}с`);

    // Покупка при накоплениях не отталкивает спуск (главный баг v4.1).
    Object.assign(gameState, init, { levels: { ...init.levels, miner: 100 }, tier: 1, stars: 0, ore: priceEntry * 0.5, tierAnchorRate: 0 });
    const price1 = getNextUnlockPrice();
    const etaMid = getUnlockEtaSeconds();
    gameState.ore += getUpgradeCost('miner') * 10; // выдаём руду на покупку
    const bought = buyUpgrade('miner');
    const etaAfterBuy = getUnlockEtaSeconds();
    check('покупка доступна', bought === true);
    check('покупка при накоплениях не увеличивает ETA', etaAfterBuy <= etaMid, `${etaMid.toFixed(0)}с -> ${etaAfterBuy.toFixed(0)}с`);

    // Спуск: якорь нового тира = доход уже с множителем x3.
    gameState.ore = price1 + 1000;
    const entered = state.unlockTier();
    const rateT2 = getEarningRate();
    check('unlockTier списывает цену и переходит', entered && gameState.tier === 2 && gameState.ore === 1000);
    check('якорь сброшен при спуске', gameState.tierAnchorRate === 0);
    const priceT2 = computeNextUnlockPrice(2);
    check('цена в новом тире = N(2) сек дохода с множителем x3', priceT2 === Math.ceil(unlockSecondsFor(2) * rateT2),
        `${priceT2} vs ${Math.ceil(unlockSecondsFor(2) * rateT2)}`);
}

// --- 4. Гейты глубины (tier) и капы ---
{
    Object.assign(gameState, createInitialState(), { tier: 0, ore: 1e12, tierAnchorRate: 0 });
    const gatedIds = ['drill', 'excavator', 'hydraulic', 'factory', 'quarry', 'megafactory', 'orbital',
        'quantumlab', 'wormhole', 'singularity', 'dyson', 'plasma', 'disintegrator', 'aicore', 'focuslens', 'magnet'];
    const tierOf = Object.fromEntries(UPGRADES.filter(u => u.tier !== undefined).map(u => [u.id, u.tier]));
    check('все гейты заданы и в диапазоне 1..10', Object.values(tierOf).every(v => v >= 1 && v <= 10), JSON.stringify(tierOf));
    check('глубокие улучшения закрыты на тире 0', gatedIds.every(id => !isUpgradeAvailable(id)),
        gatedIds.filter(id => isUpgradeAvailable(id)).join(',') || 'все закрыты');
    check('canBuy/buyUpgrade блокируются гейтом (не только ценой)',
        gatedIds.every(id => !canBuy(id) && !buyUpgrade(id)));
    // Кирка/кувалда/шахтёр/робо-рука/динамит/жила/синергия/техника/фонарь/склад — без гейта
    const freeIds = ['pickaxe', 'sledge', 'miner', 'robotarm', 'dynamite', 'lucky', 'resonance', 'tech', 'lantern', 'warehouse'];
    check('ранний каталог доступен на тире 0', freeIds.every(id => isUpgradeAvailable(id)),
        freeIds.filter(id => !isUpgradeAvailable(id)).join(',') || 'все доступны');
    // Капы кликовой цепочки
    const caps = { pickaxe: 30, sledge: 10, hydraulic: 8, plasma: 6, disintegrator: 5 };
    check('капы кликовой цепочки', Object.entries(caps).every(([id, cap]) => getUpgradeDef(id).maxLevel === cap));
    gameState.levels.pickaxe = 30;
    check('isMaxed по капу кирки', isMaxed('pickaxe'));
    gameState.levels.pickaxe = 0;
    // Гейт снимается спуском: бур доступен на тире 1 при шахтёре 5
    gameState.tier = 1;
    gameState.levels.miner = 5;
    check('бур открывается на тире 1 (шахтёр 5)', isUpgradeAvailable('drill') && canBuy('drill'));
    // Гейт с требованием: экскаватор на тире 2 требует бур 5
    gameState.tier = 2;
    check('экскаватор на тире 2 закрыт требованием (бур < 5)', !isUpgradeAvailable('excavator'));
    gameState.levels.drill = 5;
    check('экскаватор открыт при бур 5 на тире 2', isUpgradeAvailable('excavator'));
    // Якорь из сейва
    Object.assign(gameState, createInitialState());
    applySave({ version: 4, ore: 5, tier: 4, stars: 1, tierEarned: TIERS.map(() => 0), tierAnchorRate: 12345, levels: {} });
    check('якорь читается из сейва', gameState.tierAnchorRate === 12345, `anchor=${gameState.tierAnchorRate}`);
    const p = computeNextUnlockPrice(4);
    check('цена использует якорь из сейва', p === Math.ceil(Math.max(UNLOCK_FLOOR, unlockSecondsFor(4) * 12345)), `${p}`);
    state.forceNextTier();
    check('forceNextTier сбрасывает якорь', gameState.tierAnchorRate === 0);
    gameState.tierAnchorRate = 777;
    gameState.tierEarned[DIAMOND_INDEX] = 1e12;
    state.doPrestige();
    check('doPrestige сбрасывает якорь', gameState.tierAnchorRate === 0 && gameState.tier === 0);
}

// --- 5. Исходное состояние ---
{
    const init = createInitialState();
    check('tierEarned длины 12', init.tierEarned.length === 12 && init.tierEarned.every(v => v === 0));
    check('в новом состоянии 26 улучшений', Object.keys(init.levels).length === 26, `получено ${Object.keys(init.levels).length}`);
    check('в новом состоянии якорь = 0', init.tierAnchorRate === 0);
}

// --- 6. Миграция v2 -> v3 -> v4 ---
{
    const v2 = {
        version: 2, ore: 12345, tier: 2, stars: 3, clicks: 42, lifetimeMined: 999999,
        tierEarned: [100, 200, 300, 400, 500],
        levels: { pickaxe: 7, dynamite: 2, miner: 9, factory: 1 }
    };
    applySave(JSON.parse(JSON.stringify(v2)));
    check('миграция v2: золото тир 2 -> 4', gameState.tier === 4, `tier=${gameState.tier}`);
    check('миграция v2: руда сохранена', gameState.ore === 12345);
    check('миграция v2: уровни сохранены', gameState.levels.pickaxe === 7 && gameState.levels.factory === 1 && gameState.levels.miner === 9);
    check('миграция v2: tierEarned перенесены по ключам', gameState.tierEarned[0] === 100 && gameState.tierEarned[2] === 200 && gameState.tierEarned[4] === 300 && gameState.tierEarned[6] === 400 && gameState.tierEarned[11] === 500);
    check('миграция v2: версия обновлена, якорь ленивый', gameState.version === SAVE_VERSION && SAVE_VERSION === 4 && gameState.tierAnchorRate === 0);

    applySave({ version: 2, ore: 1, tier: 4, tierEarned: [0, 0, 0, 0, 7e10], levels: {} });
    check('миграция v2: алмазный тир 4 -> 11', gameState.tier === 11, `tier=${gameState.tier}`);
    check('миграция v2: алмазная добыча -> индекс 11', gameState.tierEarned[11] === 7e10);

    applySave({ version: 3, ore: 777, tier: 5, stars: 0, tierEarned: TIERS.map(() => 0), levels: { miner: 3 } });
    check('миграция v3: сейв принят', gameState.version === 4 && gameState.ore === 777 && gameState.tier === 5 && gameState.levels.miner === 3);
    check('миграция v3: якорь пустой (ленивая фиксация)', gameState.tierAnchorRate === 0);
}

// --- 7. Престиж-масштаб ---
check('PRESTIGE_REQUIREMENT = 1e12', PRESTIGE_REQUIREMENT === 1e12);
{
    applySave({ version: 4, ore: 0, tier: 11, stars: 0, tierEarned: TIERS.map((_, i) => (i === 11 ? 1e12 : 0)), levels: {} });
    check('1e12 алмазов = 1 звезда', state.getStarsGain() === 1, `gain=${state.getStarsGain()}`);
    applySave({ version: 4, ore: 0, tier: 11, stars: 0, tierEarned: TIERS.map((_, i) => (i === 11 ? 4e12 : 0)), levels: {} });
    check('4e12 алмазов = 2 звезды', state.getStarsGain() === 2);
}

// --- 8. fmt для больших цен ---
check('fmt(147622500)=148M', fmt(147622500) === '148M', fmt(147622500));
check('fmt(4.2e12) не ∞ и не e-notation', !fmt(4.2e12).includes('e'), fmt(4.2e12));

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ' : `\nПРОВАЛОВ: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
