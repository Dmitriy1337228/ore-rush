// Проверка пересчёта цен в UI без перезагрузки сцены (ребаланс этапа 1)
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const save = JSON.stringify({ version: 2, ore: 1e7, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5, sledge: 3, dynamite: 0, lucky: 0, resonance: 0, miner: 10, drill: 0, excavator: 0, factory: 0, tech: 0, lantern: 0, warehouse: 0 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'minecraft-clicker-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    await page.click('#dev-admin-panel button:has-text("Макс всё")');
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const gs = JSON.parse(document.querySelector('#dev-admin-panel .dev-state').textContent);
        return ui.rows.map((r) => {
            const def = r.def;
            const expected = def.maxLevel !== null ? 'макс' : window.__fmt(Math.ceil(def.baseCost * Math.pow(def.growth, gs.levels[def.id])));
            return `${def.id}: показано "${r.priceText.text}" / ожидается "${expected}" => ${r.priceText.text === expected ? 'OK' : 'FAIL'}`;
        });
    });
    console.log(res.join('\n'));
    await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
