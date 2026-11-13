// Проверка ежедневных наград (Этап 6): 7-дневный цикл, серия/пропуск, бафы,
// «Накопитель»/«Бесплатное улучшение», «Золотая жила», DevPanel-кнопки, модалка.
// Две фазы: node (чистая экономика) + браузер (UI, модалка, DevPanel, сейв).
// Dev-сервер поднимается сам и гасится после проверки.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) passed++; else failed++;
}

// ---------- Фаза 1: node (чистая логика state.js) ----------
const state = await import('../src/state.js');
const {
    gameState, createInitialState, applySave, DAILY_REWARDS,
    canClaimDaily, claimDailyReward, getDailyDay, getDailyMult, getCritChance,
    getEarningRate, rollClickGain, pickFreeUpgrade, getOrePerSecond, getExpectedClickGain
} = state;

{
    Object.assign(gameState, createInitialState());
    check('N1 первый заход: canClaim', canClaimDaily());
    const c1 = claimDailyReward();
    check('N2 день 1 = «Ускорение»', c1 && c1.reward.id === 'boost2' && c1.streak === 1, c1 && c1.reward.id);
    check('N3 баф x2 активен', getDailyMult() === 2 && gameState.dailyBuffUntil > Date.now());
    check('N4 повторная выдача в тот же день -> null', claimDailyReward() === null && !canClaimDaily());

    // «Завтра»: серия растёт
    gameState.lastDailyDay = getDailyDay() - 1;
    const oreBefore = gameState.ore;
    const c2 = claimDailyReward();
    check('N5 день 2 = «Накопитель», серия 2', c2 && c2.reward.id === 'stash' && c2.streak === 2);
    check('N6 Накопитель = 300с полного дохода', c2.extra > 0 && Math.abs(gameState.ore - oreBefore - c2.extra) < 1e-6 && Math.abs(c2.extra - 300 * getEarningRate()) < 1e-6,
        `${c2.extra}`);

    // Пропуск 3 дней — серия СБРАСЫВАЕТСЯ в 1
    gameState.lastDailyDay = getDailyDay() - 3;
    const c3 = claimDailyReward();
    check('N7 пропуск дня сбрасывает серию в 1', c3 && c3.streak === 1 && c3.reward.id === 'boost2');

    // Цикл 7 дней: подгоняем серию к 7-му дню
    gameState.dailyStreak = 6;
    gameState.lastDailyDay = getDailyDay() - 1;
    const c7 = claimDailyReward();
    check('N8 день 7 = «Золотая жила»', c7 && c7.reward.id === 'vein' && gameState.dailyVeinUntil > Date.now());
    const rolls = Array.from({ length: 30 }, () => rollClickGain().lucky);
    check('N9 жила форсируется во всех кликах', rolls.every(Boolean));
    gameState.dailyStreak = 7;
    gameState.lastDailyDay = getDailyDay() - 1;
    const c8 = claimDailyReward();
    check('N10 цикл замыкается: день 8 = награда 1-го дня', c8 && c8.reward.id === 'boost2' && c8.streak === 8);

    // «Критический импульс»: +25%, потолок 95%
    gameState.dailyCritUntil = Date.now() + 60e3;
    gameState.levels.dynamite = 23;
    check('N11 крит-баф: 0.74 + 0.25 -> кап 0.95', Math.abs(getCritChance() - 0.95) < 1e-9);
    gameState.dailyCritUntil = 0;
    check('N12 без бафа крит 0.74', Math.abs(getCritChance() - 0.74) < 1e-9);

    // «Бесплатное улучшение»: лучший ROI на свежем состоянии = кирка
    Object.assign(gameState, createInitialState());
    const pick = pickFreeUpgrade();
    check('N13 бесплатное улучшение на свежем старте = кирка', pick && pick.id === 'pickaxe', pick && pick.id);

    // Баф множит фактическую добычу, но НЕ якорь цены спуска
    Object.assign(gameState, createInitialState(), { levels: { ...createInitialState().levels, miner: 100 } });
    const gps0 = getOrePerSecond(), anchor0 = getExpectedClickGain();
    gameState.dailyBuffUntil = Date.now() + 60e3;
    gameState.dailyBuffMult = 10;
    check('N14 баф x10 множит пассив, якорь не тронут',
        Math.abs(getOrePerSecond() - gps0 * 10) < 1e-6 && Math.abs(getExpectedClickGain() - anchor0) < 1e-9);

    // Сейв-совместимость: старый сейв без daily-полей + истёкший баф не resurrect
    applySave({ version: 4, ore: 5, tier: 0, tierEarned: state.TIERS.map(() => 0), levels: {} });
    check('N15 старый сейв без daily-полей -> чистая серия',
        gameState.dailyStreak === 0 && gameState.lastDailyDay === 0 && gameState.dailyBuffMult === 1 && gameState.dailyBuffUntil === 0);
    applySave({ version: 4, ore: 5, tier: 0, tierEarned: state.TIERS.map(() => 0), levels: {}, dailyBuffUntil: Date.now() - 60e3, dailyBuffMult: 10 });
    check('N16 истёкший баф из сейва не оживает', gameState.dailyBuffUntil === 0 && getDailyMult() === 1);
}

// ---------- Фаза 2: браузер (UI, DevPanel, сейв) ----------
const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const b = await chromium.launch();
{
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3500);

    const daily = () => page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return { visible: ui.dailyModal.visible, name: ui.dailyName.text, streak: ui.dailyStreakText.text };
    });
    const st = async () => page.evaluate(async () => {
        const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
        const m = await import(u);
        return { streak: m.gameState.dailyStreak, mult: m.getDailyMult(), last: m.gameState.lastDailyDay, ore: m.gameState.ore };
    });

    check('U1 модалка дня 1 открылась на первом заходе', (await daily()).visible);
    check('U2 тексты: «Ускорение», серия 1', (await st()).streak === 1 && (await daily()).name === 'Ускорение' && /Серия: 1/.test((await daily()).streak));
    check('U3 баф x2 выдан', (await st()).mult === 2);

    await page.mouse.click(640, 512); // «Отлично!» (контейнер 640,360 + кнопка y152)
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return { visible: ui.dailyModal.visible, locked: ui.registry.get('blockLocked'), rows: ui.listContent.visible };
    });
    check('U4 закрытие: модалка скрыта, блокировка снята', !closed.visible && closed.locked === false && closed.rows === true);

    // DevPanel «след. день» ×6 -> серия 7. Каждая выдача открывает модалку,
    // закрываем её перед следующим днём (как игрок)
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    for (let i = 0; i < 6; i++) {
        await page.click('#dev-admin-panel button:has-text("Дейли: след. день")');
        await page.waitForTimeout(300);
        if (i < 5) { // модалку последнего (7-го) дня оставляем открытой для проверки
            const d = await daily();
            if (d.visible) { await page.mouse.click(640, 512); await page.waitForTimeout(250); }
        }
    }
    const day7 = await daily();
    const s7 = await st();
    check('U5 серия 7, день 7 = «Золотая жила»', s7.streak === 7 && day7.visible && day7.name === 'Золотая жила');
    await page.mouse.click(640, 512); // закрыть
    await page.waitForTimeout(300);

    // Форсированная жила: гасим дневной баф множителя (day6 x10 ещё активен),
    // клик по блоку даёт ровно урон x множитель жилы (детерминированный ролл)
    await page.evaluate(async () => {
        const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
        const m = await import(u);
        m.gameState.dailyBuffUntil = 0;
    });
    const expected = await page.evaluate(async () => {
        const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
        const m = await import(u);
        return m.getClickDamage() * (10 + m.getUpgradeLevel('magnet')); // veinMult x10 (магнит 0)
    });
    await page.evaluate(() => {
        let rs = 42;
        const lcg = () => { rs = (rs * 1103515245 + 12345) % 2147483648; return 0.05 + (rs / 2147483648) * 0.9; };
        Math.random = lcg;
    });
    const oreBeforeClick = (await st()).ore;
    await page.mouse.click(400, 390);
    await page.waitForTimeout(150);
    const oreAfterClick = (await st()).ore;
    check('U6 клик при «Золотой жиле» = урон x10 (без крита)', Math.abs(oreAfterClick - oreBeforeClick - expected) < 1e-6, `дельта=${oreAfterClick - oreBeforeClick}, ожидалось ${expected}`);

    // Сброс серии
    await page.click('#dev-admin-panel button:has-text("Дейли: сброс серии")');
    await page.waitForTimeout(300);
    const reset = await daily();
    check('U7 сброс серии -> день 1 «Ускорение»', reset.visible && reset.name === 'Ускорение' && (await st()).streak === 1);
    await page.mouse.click(640, 512);
    await page.waitForTimeout(200);

    // Перезагрузка: награда за сегодня уже получена — модалка не открывается
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3500);
    const afterReload = await daily();
    check('U8 перезагрузка: повторной выдачи нет, серия сохранена', !afterReload.visible && (await st()).streak === 1);

    check('U9 page errors', errors.length === 0 ? 'OK (0)' : `FAIL (${errors.join(' | ')})`);
    if (errors.length) failed++;
    await page.close();
}
await b.close();
console.log(`\nИтого: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
