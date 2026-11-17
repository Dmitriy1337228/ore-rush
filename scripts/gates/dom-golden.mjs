// DOM-golden мастерской (этап 5, шаг 5.3): tolerant-diff скриншота страницы.
// Скриншоты ui-check/ui-review и так снимают страницу целиком (DOM в кадре),
// но golden сцены фиксирует Phaser-экран; здесь — отдельный DOM-эталон.
//
// Детерминизм: mid-сейв, уровни 0 (нет пассива), компоненты/предметы выданы,
// ежедневная награда закрыта, GameScene и UIScene приостановлены (таймеры/твины
// стоят) — кадр статичен между прогонами.
//
// Запуск: node scripts/dom-golden.mjs [--update] [--runs 3]
// Пороги: CHANNEL_TOLERANCE (канал 0..255) и MAX_DIFF_RATIO (доля пикселей).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { decodePng, diffRatio } from '../../tests/characterization/helpers/png.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const ROOT = process.cwd();
const GOLDEN = path.join(ROOT, 'tests/characterization/golden/dom/craft-1280x720.png');
const SHOT = path.join(ROOT, 'shots/dom-golden/craft-1280x720.png');
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const VIEWPORT = { width: 1280, height: 720 };
const RUNS = Number(opt('runs', 1));

// Допуски: DOM-рендер стабилен, но шрифтовой растеризатор браузера может дать
// единичные пиксели на сглаживании. 16 по каналу и 0.5% пикселей — с запасом,
// при этом реальная правка вёрстки даёт кратно больше.
const CHANNEL_TOLERANCE = 16;
const MAX_DIFF_RATIO = 0.005;

fs.mkdirSync(path.dirname(SHOT), { recursive: true });
fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();

async function capture(i) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
        if (m.type() === 'error') {
            errors.push(m.text());
        }
    });
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        },
        { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' }
    );
    await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__DOM_CRAFT && window.__GAME.scene.getScene('UIScene').L, null, {
        timeout: 30000
    });
    await page.waitForTimeout(1250);
    await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) {
            ui.hideDailyModal();
        }

        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        for (const id of Object.keys(m.gameState.levels)) {
            m.gameState.levels[id] = 0;
        }

        for (const c of m.COMPONENTS) {
            m.gameState.components[c.id] = 100;
        }

        for (const i of m.ITEMS) {
            m.gameState.items[i.id] = 2;
        }

        m.gameState.crafting = null;
        m.gameState.bossBuffUntil = 0;
        m.gameState.miningBuffUntil = 0;
        m.gameState.itemVeinUntil = 0;
    });
    await page.waitForTimeout(350);
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForFunction(() => window.__DOM_CRAFT.isOpen(), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    // Статичный кадр: останавливаем игровые сцены (таймеры/твины/анимации)
    await page.evaluate(() => {
        const game = window.__GAME;
        game.scene.pause('GameScene');
        game.scene.pause('UIScene');
    });
    await page.waitForTimeout(250);
    const file = path.join(path.dirname(SHOT), `run-${i}.png`);
    await page.screenshot({ path: file });
    await ctx.close();

    return { file, errors };
}

const shots = [];
try {
    for (let i = 1; i <= RUNS; i++) {
        shots.push({ i, ...(await capture(i)) });
    }
} finally {
    await browser.close();
}

const errors = shots.flatMap((s) => s.errors);
if (errors.length) {
    console.error(`dom-golden: console/pageerror — ${errors.length}`);
    errors.slice(0, 5).forEach((e) => console.error('  ' + e));
    process.exitCode = 1;
} else if (flag('update')) {
    fs.copyFileSync(shots[0].file, GOLDEN);
    console.log(`dom-golden: эталон обновлён — ${path.relative(ROOT, GOLDEN)}`);
} else {
    if (!fs.existsSync(GOLDEN)) {
        console.error('dom-golden: нет эталона, запустите с --update');
        process.exitCode = 1;
    } else {
        const want = decodePng(fs.readFileSync(GOLDEN));
        let worst = 0;
        let bad = 0;
        for (const s of shots) {
            const got = decodePng(fs.readFileSync(s.file));
            const ratio = diffRatio(want, got, CHANNEL_TOLERANCE);
            worst = Math.max(worst, ratio);
            const ok = ratio <= MAX_DIFF_RATIO;
            if (!ok) {
                bad++;
            }

            console.log(
                `dom-golden run ${s.i}: ${(ratio * 100).toFixed(3)}% пикселей вне допуска ${CHANNEL_TOLERANCE} — ${ok ? 'ok' : 'FAIL'}`
            );
        }

        console.log(
            `dom-golden: прогонов ${RUNS}, худший ${(worst * 100).toFixed(3)}%, порог ${(MAX_DIFF_RATIO * 100).toFixed(2)}% — ${bad ? 'FAIL' : 'ok'}`
        );
        if (bad) {
            console.error(`Сравните ${path.relative(ROOT, shots[0].file)} с ${path.relative(ROOT, GOLDEN)}`);
            process.exitCode = 1;
        }
    }
}
