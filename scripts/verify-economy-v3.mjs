// Node-проверки экономики v3: 12 тиров, динамическая цена спуска, миграция v2->v3.
// Запуск: node scripts/verify-economy-v3.mjs

let failures = 0;
function check(name, cond, detail = '') {
    const ok = Boolean(cond);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
}

const state = await import('../src/state.js');
const {
    TIERS, TIER_STEP, TIER_COST_MULT, TIER_INCOME_MULT,
    UNLOCK_BASE_SECONDS, UNLOCK_SECONDS_GROWTH, UNLOCK_FLOOR,
    unlockSecondsFor, computeNextUnlockPrice,
    DIAMOND_INDEX, PRESTIGE_REQUIREMENT, SAVE_VERSION,
    createInitialState, gameState, applySave,
    getUpgradeCost, fmt
} = state;

// --- 1. Лестница тиров ---
check('12 тиров', TIERS.length === 12, `получено ${TIERS.length}`);
const expectedKeys = ['coal', 'copper', 'iron', 'silver', 'gold', 'amethyst', 'emerald', 'ruby', 'sapphire', 'platinum', 'uranium', 'diamond'];
check('порядок руд', TIERS.map(t => t.key).join(',') === expectedKeys.join(','));
check('у каждого тира iconKey/blockPrefix/floatColor/adj', TIERS.every(t => t.iconKey && t.blockPrefix && t.floatColor && t.adj));
check('DIAMOND_INDEX = 11', DIAMOND_INDEX === 11);

// --- 2. Множители ---
check('TIER_STEP = {cost:2.5, income:3}', TIER_STEP.cost === 2.5 && TIER_STEP.income === 3);
check('TIER_COST_MULT(0)=1, (2)=6.25, (11)=2.5^11',
    TIER_COST_MULT(0) === 1 && TIER_COST_MULT(2) === 6.25 && Math.abs(TIER_COST_MULT(11) - Math.pow(2.5, 11)) < 1e-6);
check('TIER_INCOME_MULT(11)=3^11=177147', TIER_INCOME_MULT(11) === 177147);
{
    const t0 = gameState.tier;
    gameState.tier = 2;
    check('цена кирки ур.0 на тире 2 = ceil(15*6.25)=94', getUpgradeCost('pickaxe') === 94, `получено ${getUpgradeCost('pickaxe')}`);
    gameState.tier = t0;
}

// --- 3. Динамическая цена спуска (пересчёт от текущего дохода) ---
check('unlockSecondsFor(0)=180', unlockSecondsFor(0) === 180);
check('unlockSecondsFor(11)~180*1.45^11', Math.abs(unlockSecondsFor(11) - 180 * Math.pow(1.45, 11)) < 1e-6);
check('computeNextUnlockPrice(11)=null (последний тир)', computeNextUnlockPrice(11) === null);
check('цена при нулевом доходе = UNLOCK_FLOOR', computeNextUnlockPrice(0) === UNLOCK_FLOOR);
{
    // miner=100 на тире 1: gps = 300; E[клик] = 3 (урон) x 1.2 (крит) = 3.6;
    // ставка дохода = 300 + (0 авто + 3 ручных) x 3.6 = 310.8; цена = ceil(261 x 310.8)
    const init = createInitialState();
    Object.assign(gameState, init, { levels: { ...init.levels, miner: 100 }, tier: 1, stars: 0 });
    const price = computeNextUnlockPrice(1);
    const expect = Math.ceil(unlockSecondsFor(1) * (300 + 3 * 3.6));
    check('цена спуска = N сек полного дохода (пассив + клики)', price === expect, `${price} vs ${expect}`);
    const oreBefore = gameState.ore;
    gameState.ore = price + 1000;
    const entered = state.unlockTier();
    check('unlockTier списывает текущую цену и переходит', entered && gameState.tier === 2 && gameState.ore === 1000);
    // пересчёт: прокачка поднимает доход и цену синхронно
    Object.assign(gameState, init, { levels: { ...init.levels, miner: 200 }, tier: 1, stars: 0 });
    const price200 = computeNextUnlockPrice(1);
    check('цена спуска растёт от прокачки (пересчёт от дохода)', price200 > price * 1.5, `${price200} > ${price} x1.5`);
    gameState.ore = oreBefore;
}

// --- 4. Исходное состояние ---
{
    const init = createInitialState();
    check('tierEarned длины 12', init.tierEarned.length === 12 && init.tierEarned.every(v => v === 0));
    check('в новом состоянии 26 улучшений', Object.keys(init.levels).length === 26, `получено ${Object.keys(init.levels).length}`);
}

// --- 5. Миграция v2 -> v3 ---
{
    // сейв на тире 2 (золото в старой нумерации) должен попасть на тир 4 (золото в новой)
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
    check('миграция v2: версия обновлена', gameState.version === SAVE_VERSION && SAVE_VERSION === 3);

    // сейв на алмазах (старый тир 4) -> новый тир 11
    applySave({ version: 2, ore: 1, tier: 4, tierEarned: [0, 0, 0, 0, 7e10], levels: {} });
    check('миграция v2: алмазный тир 4 -> 11', gameState.tier === 11, `tier=${gameState.tier}`);
    check('миграция v2: алмазная добыча -> индекс 11', gameState.tierEarned[11] === 7e10);
}

// --- 6. Престиж-масштаб ---
check('PRESTIGE_REQUIREMENT = 1e12', PRESTIGE_REQUIREMENT === 1e12);
{
    applySave({ version: 3, ore: 0, tier: 11, stars: 0, tierEarned: TIERS.map((_, i) => (i === 11 ? 1e12 : 0)), levels: {} });
    check('1e12 алмазов = 1 звезда', state.getStarsGain() === 1, `gain=${state.getStarsGain()}`);
    applySave({ version: 3, ore: 0, tier: 11, stars: 0, tierEarned: TIERS.map((_, i) => (i === 11 ? 4e12 : 0)), levels: {} });
    check('4e12 алмазов = 2 звезды', state.getStarsGain() === 2);
}

// --- 7. fmt для больших цен ---
check('fmt(147622500)=148M', fmt(147622500) === '148M', fmt(147622500));
check('fmt(4.2e12) не ∞ и не e-notation', !fmt(4.2e12).includes('e'), fmt(4.2e12));

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ' : `\nПРОВАЛОВ: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
