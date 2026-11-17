// Пилот DOM (этап 0.3): чистые (без разметки нарушений) скриншоты мастерской
// на фиксированном наборе вьюпортов -> docs/dom-pilot/baseline/.
// Использует те же seed/setup, что состояние `craft` матрицы ui:check,
// и ту же остановку таймеров (детерминированная картинка).
//
// Запуск: node scripts/pilot-baseline-shots.mjs [--out docs/dom-pilot/baseline]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { VIEWPORTS, STATES, SAVE_KEY } from '../lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const outArg = opt('out', null);
// Безопасный дефолт: shots/ в .gitignore. Трекнутый эталон обновляется ТОЛЬКО явным
// --out docs/dom-pilot/baseline — случайный прогон метрики не перезапишет артефакты (M4).
const OUT = path.resolve(outArg || path.join('shots', 'metrics', 'baseline'));
if (!outArg) {
    console.log('по умолчанию: shots/metrics/baseline; для обновления эталона — --out docs/dom-pilot/baseline');
}

const SHOT_IDS = ['p360', 'p390', 'p412', 't768', 'l844', 'd1280'];

const viewports = VIEWPORTS.filter((v) => SHOT_IDS.includes(v.id));
const craftState = STATES.find((s) => s.id === 'craft');
if (viewports.length !== SHOT_IDS.length || !craftState) {
    console.error('Не нашёл вьюпорты или состояние craft в ui-matrix.mjs');
    process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();

const made = [];
try {
    for (const vp of viewports) {
        const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: 1
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
        page.on('console', (m) => {
            if (m.type() === 'error') {
                errors.push(`console: ${m.text()}`);
            }
        });
        await page.addInitScript(
            (s) => {
                for (const [k, v] of Object.entries(s)) {
                    localStorage.setItem(k, v);
                }
            },
            { [SAVE_KEY]: JSON.stringify(craftState.seed) }
        );
        await page.goto(BASE, { waitUntil: 'load' });
        await page.waitForFunction(
            () => {
                const g = window.__GAME;
                const ui = g && g.scene.getScene('UIScene');

                return !!(ui && ui.L && document.fonts.status === 'loaded');
            },
            null,
            { timeout: 30000 }
        );
        await page.waitForTimeout(500);
        await craftState.setup(page);
        // Заморозка экономики: картинка не «плывёт» между прогонами (как settle в ui-check).
        await page.evaluate(() => {
            window.__GAME.scene.getScene('GameScene').time.paused = true;
        });
        await page.waitForTimeout(800);
        const file = path.join(OUT, `craft-${vp.width}x${vp.height}.png`);
        await page.screenshot({ path: file });
        made.push({
            id: vp.id,
            viewport: `${vp.width}x${vp.height}`,
            file: path.relative(process.cwd(), file),
            errors
        });
        if (errors.length) {
            errors.slice(0, 5).forEach((e) => console.log(`  console[${vp.id}]: ${e}`));
        }

        await ctx.close();
        console.log(`shot: ${path.relative(process.cwd(), file)}`);
    }
} finally {
    await browser.close();
}

fs.writeFileSync(
    path.join(OUT, 'shots.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), base: BASE, shots: made }, null, 2) + '\n'
);
console.log(`\nготово: ${made.length} скриншотов в ${path.relative(process.cwd(), OUT)} (shots.json рядом)`);
