// Проверка Робо-руки: авто-клики дают доход и разрушают блок (этап 2 + фикс заживления)
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();

    // --- Сценарий 1: робо-рука 4 ур. (2 клика/с) — доход без ручных кликов ---
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const save = JSON.stringify({ version: 2, ore: 0, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5, sledge: 0, dynamite: 0, lucky: 0, resonance: 0, miner: 0, drill: 0, excavator: 0, factory: 0, tech: 0, robotarm: 4, lantern: 0, warehouse: 0 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'ore-rush-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const read = () => page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return { coal: ui.coalText.text };
    });
    await page.waitForTimeout(10000);
    const r1 = await read();
    console.log('after 10s: coal =', r1.coal, '(ожидание ~120 с учётом пауз на разрушение блока)');
    await page.waitForTimeout(5000);
    const r2 = await read();
    console.log('after 15s: coal =', r2.coal);
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => JSON.parse(document.querySelector('#dev-admin-panel .dev-state').textContent));
    console.log('clicks (ручные):', st.clicks, '| totalMined:', Math.floor(st.lifetimeMined));
    await page.close();

    // --- Сценарий 2: робо-рука 1 ур. (0.5 клика/с) — блок должен РАЗРУШАТЬСЯ.
    // Раньше окно заживления трещин (1.2с) было короче интервала авто-кликов (2с):
    // стадии не накапливались и блок не ломался вовсе.
    const page2 = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page2.on('pageerror', (e) => errors.push(String(e)));
    const save2 = JSON.stringify({ version: 2, ore: 0, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5, sledge: 0, dynamite: 0, lucky: 0, resonance: 0, miner: 0, drill: 0, excavator: 0, factory: 0, tech: 0, robotarm: 1, lantern: 0, warehouse: 0 } });
    await page2.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'ore-rush-save': save2 });
    await page2.goto('http://localhost:5174', { waitUntil: 'load' });
    await page2.waitForTimeout(3000);
    // Сэмплируем стадию блока каждые 150мс ~14с (5 авто-ударов по 2с = ~10с на блок)
    const samples = await page2.evaluate(() => new Promise((resolve) => {
        const gs = window.__GAME.scene.getScene('GameScene');
        const seen = [];
        const t0 = performance.now();
        const iv = setInterval(() => {
            seen.push({ stage: gs.blockStage, busy: gs.blockBusy });
            if (performance.now() - t0 > 14000) { clearInterval(iv); resolve(seen); }
        }, 150);
    }));
    const maxStage = Math.max(...samples.map(s => s.stage));
    let breaks = 0, prevStage = 0;
    for (const s of samples) {
        if (s.busy && prevStage >= 3) breaks++;
        if (!s.busy && s.stage < prevStage && prevStage >= 3) breaks++;
        prevStage = s.stage;
    }
    console.log(`block stages: max=${maxStage}, разрушений за 14с ~${breaks} => ${(maxStage >= 3 && breaks >= 1) ? 'OK' : 'FAIL'}`);
    await page2.close();

    console.log('page errors:', errors.length ? errors.join(' | ') : '0');
    await b.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
