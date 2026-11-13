// Проверка РЕАЛЬНОГО возврата во вкладку (visibilitychange, без перезагрузки
// страницы — как сворачивание мобильного вебвью Яндекса). Ветка visible раньше
// не выполнялась ни одним тестом, и баг перезаписи lastExit до чтения ([1]
// ревью 2026-11-13) не ловил никто. Dev-сервер поднимается сам.
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    let failed = 0;
    const origLog = console.log;
    console.log = (...a) => { if (String(a.join(' ')).includes('FAIL')) failed++; origLog(...a); };
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const stateUrl = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js')));
    // Шахтёр 100 -> пассив 100/с; сеем lastExit «2 часа назад» в оба хранилища
    // (как при уходе со страницы), затем РЕАЛЬНО эмитим visibilitychange
    await page.evaluate(async (url) => {
        const m = await import(url);
        m.gameState.levels.miner = 100;
        m.saveGame();
        const exit = Date.now() - 2 * 3600 * 1000;
        localStorage.setItem('ore-rush-lastExit', String(exit));
        localStorage.setItem('mockStats', JSON.stringify({ lastExit: exit }));
    }, stateUrl);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(800);

    const st = await page.evaluate(async (url) => {
        const m = await import(url);
        const ui = window.__GAME.scene.getScene('UIScene');
        return {
            ore: m.gameState.ore,
            lastExit: localStorage.getItem('ore-rush-lastExit'),
            modal: ui.offlineModal.visible
        };
    }, stateUrl);

    // 1. Начисление: 2ч x 20% x gps 100 = 144000 руды (тик пассива даёт сверху ~100-200)
    console.log('1. offline credited on visible:', st.ore >= 144000 ? `OK (ore=${st.ore})` : `FAIL (ore=${st.ore})`);
    // 2. lastExit перезаписан на «сейчас» — начат новый отсчёт
    console.log('2. lastExit restarted:', st.lastExit && Number(st.lastExit) > Date.now() - 60 * 1000 ? 'OK' : `FAIL (${st.lastExit})`);
    // 3. Модалка офлайна открылась (тот же путь, что и симуляция DevPanel)
    console.log('3. offline modal shown:', st.modal ? 'OK' : 'FAIL');

    // 4. Быстрый тоггл hidden->visible (без 5 минут) не даёт повторного начисления
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    const ore2 = await page.evaluate(async (url) => (await import(url)).gameState.ore, stateUrl);
    console.log('4. quick toggle: no double credit:', ore2 === st.ore ? 'OK' : `FAIL (${st.ore} -> ${ore2})`);

    // 5. page errors
    console.log('5. page errors:', errors.length ? `FAIL (${errors.join(' | ')})` : 'OK (0)');
    if (errors.length) failed++;

    // 6. МИГРАЦИЯ со старого имени игры (переименование 2026-11-13): сейв и
    // lastExit под СТАРЫМИ ключами читаются, зеркало создаётся под новым
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page2 = await ctx2.newPage();
    const errors2 = [];
    page2.on('pageerror', (e) => errors2.push(String(e)));
    const legacySave = JSON.stringify({ version: 4, ore: 12345, tier: 0, stars: 0, clicks: 0, lifetimeMined: 12345, tierEarned: new Array(12).fill(0), levels: { miner: 3 } });
    const legacyExit = Date.now() - 3600 * 1000;
    await page2.addInitScript((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, {
        'minecraft-clicker-save': legacySave,
        'minecraft-clicker-lastExit': String(legacyExit),
        mockStats: JSON.stringify({ lastExit: legacyExit })
    });
    await page2.goto('http://localhost:5174', { waitUntil: 'load' });
    await page2.waitForTimeout(3000);
    const mig = await page2.evaluate(async (url) => {
        const m = await import(url);
        return {
            ore: m.gameState.ore,
            miner: m.gameState.levels.miner,
            newKey: localStorage.getItem('ore-rush-save'),
            offlineModal: window.__GAME.scene.getScene('UIScene').offlineModal.visible
        };
    }, stateUrl);
    console.log('6. legacy migration: save applied:', mig.ore >= 12345 && mig.miner === 3 ? `OK (ore=${mig.ore}, miner=${mig.miner})` : `FAIL (ore=${mig.ore}, miner=${mig.miner})`);
    console.log('6a. legacy migration: new key mirrored:', mig.newKey ? 'OK' : 'FAIL');
    console.log('6b. legacy lastExit -> offline modal:', mig.offlineModal ? 'OK' : 'FAIL');
    if (errors2.length) { console.log(`6c. page errors: FAIL (${errors2.join(' | ')})`); failed++; }
    await ctx2.close();

    await b.close();
    console.log(failed === 0 ? 'verify-offline: ВСЕ ЧЕКИ ЗЕЛЁНЫЕ' : `verify-offline: ПРОВАЛОВ ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
