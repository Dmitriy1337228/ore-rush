// Временная проверка Робо-руки (удалить после приёмки этапа 2)
const { chromium } = require('playwright');
(async () => {
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // робо-рука 4 ур. = 2 клика/сек; ручной урон = (1+5)=6; криты выкл (динамит 0 — 5% базовый)
    const save = JSON.stringify({ version: 2, ore: 0, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5, sledge: 0, dynamite: 0, lucky: 0, resonance: 0, miner: 0, drill: 0, excavator: 0, factory: 0, tech: 0, robotarm: 4, lantern: 0, warehouse: 0 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'minecraft-clicker-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const oreBefore = await page.evaluate(() => Math.floor(window.__GAME.scene.getScene('GameScene').gameState ? 0 : 0) || 0).catch(() => 0);
    const read = () => page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const gs = JSON.parse(document.querySelector('#dev-admin-panel') ? '{}' : '{}');
        return { coal: ui.coalText.text, clicks: 'n/a' };
    });
    // state читаем напрямую через window.__GAME + gameState недоступен — читаем coalText
    await page.waitForTimeout(10000);
    const r1 = await read();
    console.log('after 10s: coal =', r1.coal, '(ожидание ~120 с учётом пауз на разрушение блока)');
    await page.waitForTimeout(5000);
    const r2 = await read();
    console.log('after 15s: coal =', r2.coal);
    // счётчик ручных кликов не должен расти — проверим через панель JSON (откроем и закроем)
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => JSON.parse(document.querySelector('#dev-admin-panel .dev-state').textContent));
    console.log('clicks (ручные):', st.clicks, '| totalMined:', Math.floor(st.lifetimeMined));
    await page.screenshot({ path: 'shots_v18/01_automine.png' });
    console.log('page errors:', errors.length ? errors.join(' | ') : '0');
    await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
