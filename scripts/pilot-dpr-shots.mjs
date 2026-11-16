// Пилот DOM (этап 1, шаг 1.6): проверка шрифта/рамок на дробных DPR.
// Снимает фикстурную панель на DPR 1, 1.25, 1.5, 2, 3 (эмуляция Chrome DevTools)
// и фиксирует, что CSS px не «плывут»: размеры панели и кегли одинаковы на всех DPR.
//
// Запуск: node scripts/pilot-dpr-shots.mjs [--out shots/pilot-gates] [--viewport 390x844]
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
const [vw, vh] = opt('viewport', '390x844').split('x').map(Number);
const DPRS = [1, 1.25, 1.5, 2, 3];
const BASE = process.env.BASE_URL || 'http://localhost:5174';

fs.mkdirSync(OUT, { recursive: true });
const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
const report = [];
try {
    for (const dpr of DPRS) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.addInitScript(
            (s) => {
                for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
            },
            { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' }
        );
        await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
        await page.waitForFunction(() => !!window.__DOM_UI && document.fonts.status === 'loaded', null, {
            timeout: 30000
        });
        await page.waitForTimeout(500);
        const metrics = await page.evaluate(() => {
            const panel = document.querySelector('[data-dom-panel]');
            const name = document.querySelector('.dom-name');
            const btn = document.querySelector('.dom-btn');
            const root = document.getElementById('ui-root');
            const cs = getComputedStyle(panel);
            return {
                dpr: window.devicePixelRatio,
                fontLoaded: document.fonts.check('16px Monocraft'),
                panel: panel.getBoundingClientRect().toJSON(),
                nameFont: getComputedStyle(name).fontSize,
                btnFont: getComputedStyle(btn).fontSize,
                btnH: btn.getBoundingClientRect().height,
                borderWidth: cs.borderTopWidth,
                borderImageWidth: cs.borderImageWidth,
                rootClass: root.className,
                rootRect: root.getBoundingClientRect().toJSON()
            };
        });
        const file = path.join(OUT, `dpr-${String(dpr).replace('.', '_')}.png`);
        await page.screenshot({ path: file });
        report.push({ ...metrics, file: path.relative(process.cwd(), file), errors });
        await ctx.close();
    }
} finally {
    await browser.close();
}
const stable = report.every(
    (r) =>
        r.nameFont === report[0].nameFont &&
        r.btnFont === report[0].btnFont &&
        Math.abs(r.panel.width - report[0].panel.width) < 0.6 &&
        Math.abs(r.panel.height - report[0].panel.height) < 0.6
);
const out = {
    createdAt: new Date().toISOString(),
    viewport: `${vw}x${vh}`,
    dprs: DPRS,
    cssPxStable: stable,
    shots: report
};
fs.writeFileSync(path.join(OUT, 'dpr-report.json'), JSON.stringify(out, null, 2) + '\n');
console.log(
    JSON.stringify(
        {
            cssPxStable: stable,
            snaps: report.map((r) => ({
                dpr: r.dpr,
                nameFont: r.nameFont,
                btnFont: r.btnFont,
                btnH: Number(r.btnH.toFixed(1)),
                panel: `${r.panel.width.toFixed(1)}x${r.panel.height.toFixed(1)}`,
                fontLoaded: r.fontLoaded,
                errors: r.errors.length,
                file: r.file
            }))
        },
        null,
        2
    )
);
