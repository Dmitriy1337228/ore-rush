const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const all = [ui.gearContent, ...ui.gearContent.list];
        return { types: all.map(o => o.type || o.constructor.name), setGeom: all.map(o => typeof o.setGeometryMask), setMask: all.map(o => typeof o.setMask) };
    });
    console.log(JSON.stringify(r));
    await b.close();
})().catch(e => { console.error(e); process.exit(1); });
