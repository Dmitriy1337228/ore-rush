// Пилот DOM (этап 1, шаг 1.7 / решение D3): порядок слоёв DOM и Phaser.
// Проверяет факт: DOM-панель лежит над канвасом, поэтому Phaser-модалка
// (ежедневная награда) оказывается под ней. Результат — в журнал и в решение
// этапа 2 (что делать с алертами при открытом DOM-экране).
//
// Запуск: node scripts/pilot-layers-check.mjs [--out shots/pilot-gates]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from './lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const OUT = path.resolve(opt('out', 'shots/pilot-gates'));
const BASE = process.env.BASE_URL || 'http://localhost:5174';

fs.mkdirSync(OUT, { recursive: true });
const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
const report = { url: `${BASE}/?dom=1`, checks: {} };
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' });
    await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__DOM_UI && window.__GAME.scene.getScene('UIScene').L, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'layers-before.png') });

    // Принудительно открываем Phaser-модалку ежедневной награды.
    const phaser = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = { streak: 3, extra: 1200 };
        ui.tryShowDailyModal();
        const daily = { open: !!ui._dailyOpen, visible: !!(ui.dailyModal && ui.dailyModal.visible) };
        // Объекты алертов: dim (depth 50) и панель (51)
        const alerts = ui.children.list
            .filter((o) => o.visible && o.depth >= 50)
            .map((o) => ({ type: o.type, depth: o.depth, x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.width || 0), h: Math.round(o.height || 0) }));
        return { daily, alerts };
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'layers-after.png') });

    const dom = await page.evaluate(() => {
        const root = document.getElementById('ui-root');
        const panel = document.querySelector('[data-dom-panel]');
        const canvas = document.querySelector('#game canvas');
        const cs = getComputedStyle(root);
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
        const cx = Math.round(window.innerWidth / 2);
        const cy = Math.round(window.innerHeight / 2);
        const top = document.elementFromPoint(cx, cy);
        return {
            rootZ: cs.zIndex,
            rootPosition: cs.position,
            panel: r(panel),
            canvas: r(canvas),
            elementAtCenter: top ? (top.closest('#ui-root') ? 'dom' : 'canvas') : 'none',
            panelAboveCanvas: Number(cs.zIndex) > 0
        };
    });

    // D3 на DevPanel: панель разработчика (z-index 9999) обязана быть выше DOM-слоя.
    await page.keyboard.press('Shift+D');
    await page.waitForTimeout(300);
    const devPanel = await page.evaluate(() => {
        const el = document.getElementById('dev-admin-panel');
        if (!el || getComputedStyle(el).display === 'none') return { present: false };
        const b = el.getBoundingClientRect();
        const x = Math.round(b.left + b.width / 2);
        const y = Math.round(b.top + Math.min(b.height, 40) / 2);
        const top = document.elementFromPoint(x, y);
        return {
            present: true,
            z: getComputedStyle(el).zIndex,
            rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
            elementAtDevPanel: top ? (top.closest('#dev-admin-panel') ? 'devpanel' : (top.closest('#ui-root') ? 'dom' : 'other')) : 'none'
        };
    });
    await page.screenshot({ path: path.join(OUT, 'layers-devpanel.png') });

    report.checks = {
        phaserDailyOpen: phaser.daily,
        phaserAlertObjects: phaser.alerts,
        dom: dom,
        domCoversPhaserAlert: phaser.daily.open && dom.elementAtCenter === 'dom',
        devPanel: devPanel,
        devPanelAboveDom: devPanel.present && devPanel.elementAtDevPanel === 'devpanel',
        consoleErrors: errors
    };
    await ctx.close();
} finally {
    await browser.close();
}
fs.writeFileSync(path.join(OUT, 'layers-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
