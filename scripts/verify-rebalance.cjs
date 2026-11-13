// Проверка пересчёта цен в UI без перезагрузки сцены (ребаланс этапа 1)
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const save = JSON.stringify({ version: 2, ore: 1e7, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5, sledge: 3, dynamite: 0, lucky: 0, resonance: 0, miner: 10, drill: 0, excavator: 0, factory: 0, tech: 0, lantern: 0, warehouse: 0 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'ore-rush-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    await page.click('#dev-admin-panel button:has-text("Макс всё")');
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const gs = JSON.parse(document.querySelector('#dev-admin-panel .dev-state').textContent);
        // Ряды скрытой вкладки не рендерятся — цены читаем по вкладкам через switchTab
        const readRows = (tabId) => {
            ui.switchTab(tabId);
            return ui.rows.flatMap((r) => {
                const def = r.def;
                if (def.tab !== tabId) return [];
                // Гейт-запертые ряды (текущий тир ниже def.tier) показывают
                // «нужно: шахта N» вместо цены
                if (def.tier !== undefined && gs.tier < def.tier) {
                    return [`${def.id}: показано "${r.priceText.text}" / ожидается "" (гейт: шахта ${def.tier}) => ${r.priceText.text === '' ? 'OK' : 'FAIL'}`];
                }
                // Ожидаемая цена — из state.js (учитывает и growth, и множитель тира;
                // раньше формула дублировалась без TIER_COST_MULT и валидна только при тире 0)
                const expected = def.maxLevel !== null ? 'макс' : window.__fmt(window.__ec.getUpgradeCost(def.id));
                return [`${def.id}: показано "${r.priceText.text}" / ожидается "${expected}" => ${r.priceText.text === expected ? 'OK' : 'FAIL'}`];
            });
        };
        return [...readRows('equipment'), ...readRows('enhance')];
    });
    console.log(res.join('\n'));
    const failed = res.filter((s) => s.includes('FAIL')).length;
    console.log(`verify-rebalance: ${res.length - failed}/${res.length} OK`);
    await b.close();
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
