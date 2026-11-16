// Пилот DOM (этап 1, DoD 1.1): ввод через слой.
// Проверяет три вещи на фикстурной мастерской:
//  1) клик по шахте (панель скрыта) доходит до канваса — руда растёт;
//  2) клик по DOM-панели НЕ доходит до канваса;
//  3) клик по пустому месту #ui-root (вне панели) доходит до канваса.
// Дополнительно: #ui-root совпадает с канвасом ±1 CSS px.
//
// Запуск: node scripts/pilot-dom-input-check.mjs [--viewport 1280x720]
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from './lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const [w, h] = opt('viewport', '1280x720').split('x').map(Number);
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const RECT_TOLERANCE_CSS = 1; // субпиксельные округления getBoundingClientRect

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
const out = { viewport: `${w}x${h}`, checks: {}, pass: false };
try {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' });
    await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__DOM_UI && window.__GAME.scene.getScene('UIScene').L, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    const ore = () => page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        return m.gameState.ore;
    });

    out.checks.rootRect = await page.evaluate((tol) => {
        const root = document.getElementById('ui-root').getBoundingClientRect();
        const canvas = document.querySelector('#game canvas').getBoundingClientRect();
        const diffs = ['left', 'top', 'width', 'height'].map((k) => Math.abs(root[k] - canvas[k]));
        return { ok: diffs.every((d) => d <= tol), diffs };
    }, RECT_TOLERANCE_CSS);

    await page.evaluate(() => {
        window.__CANVAS_PD = 0;
        document.querySelector('#game canvas').addEventListener('pointerdown', () => window.__CANVAS_PD++);
    });

    // 1) панель скрыта — клики по шахте добывают руду
    await page.evaluate(() => window.__DOM_UI.hide());
    await page.waitForTimeout(200);
    const oreBefore = await ore();
    for (let i = 0; i < 3; i++) {
        await page.mouse.click(400, 390);
        await page.waitForTimeout(120);
    }
    const oreAfter = await ore();
    const pdHidden = await page.evaluate(() => window.__CANVAS_PD);
    out.checks.mineClickPasses = { ok: oreAfter > oreBefore && pdHidden >= 3, oreBefore, oreAfter, canvasPointerDown: pdHidden };

    // 2) панель видима — клик по панели не доходит до канваса
    await page.evaluate(() => { window.__DOM_UI.show(); window.__CANVAS_PD = 0; });
    await page.waitForTimeout(200);
    const oreBeforePanel = await ore();
    await page.mouse.click(w / 2, h / 2);
    await page.waitForTimeout(300);
    const oreAfterPanel = await ore();
    const pdPanel = await page.evaluate(() => window.__CANVAS_PD);
    out.checks.panelBlocks = { ok: pdPanel === 0 && oreAfterPanel === oreBeforePanel, oreBeforePanel, oreAfterPanel, canvasPointerDown: pdPanel };

    // 3) пустое место #ui-root вне панели — доходит до канваса
    await page.evaluate(() => { window.__CANVAS_PD = 0; });
    const panelBox = await page.evaluate(() => document.querySelector('[data-dom-panel]').getBoundingClientRect().toJSON());
    const px = Math.max(8, Math.round(panelBox.left / 2));
    const py = Math.round(panelBox.top + panelBox.height * 0.75);
    await page.mouse.click(px, py);
    await page.waitForTimeout(200);
    const pdOutside = await page.evaluate(() => window.__CANVAS_PD);
    out.checks.emptyRootPasses = { ok: pdOutside >= 1, click: [px, py], canvasPointerDown: pdOutside };

    out.pass = Object.values(out.checks).every((c) => c.ok);
    await ctx.close();
} finally {
    await browser.close();
}
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.pass ? 0 : 1;
