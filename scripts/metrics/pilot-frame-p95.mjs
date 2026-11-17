// p95 времени кадра при открытой форме (пилот DOM, этап 0.3/1.9; фаза 2 — шаг 1.4).
// Один и тот же скрипт для baseline (Phaser-путь, --legacy) и DOM-версии (по умолчанию).
//
// Условия замера (фиксированы для сравнимости):
//  - Chromium, viewport 1280x720, deviceScaleFactor 1;
//  - эмуляция CPU x4 (CDP Emulation.setCPUThrottlingRate);
//  - сид/состояние формы — из реестра (scripts/lib/dom-forms.mjs) и ui-matrix;
//  - 1 с прогрева, затем 3 раунда по 10 с замеров по requestAnimationFrame; p95 по всем кадрам.
//
// Запуск: npm run metrics:p95 [-- --form craft|settings|daily] [--legacy] [--dom] [--seconds 10] [--out file.json]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { withLegacy } from '../lib/forms-flag.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const SECONDS = Number(opt('seconds', 10));
const WARMUP_MS = 1000;
const CPU_RATE = 4;
const FORM = opt('form', 'craft');
// DOM по умолчанию для всех форм; Phaser-путь — только `--legacy` (у craft его нет).
const LEGACY = flag('legacy');
const DOM = flag('dom') || !LEGACY;

const TARGETS = {
    craft: {
        seed: 'mid',
        dom: {
            prepare: `(async () => {
                const ui = window.__GAME.scene.getScene('UIScene');
                ui._pendingDaily = null;
                ui.registry.set('dailyInfo', null);
                if (ui._dailyOpen) ui.hideDailyModal();
                const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
                const m = await import(url);
                for (const id of Object.keys(m.gameState.levels)) m.gameState.levels[id] = 0;
                for (const c of m.COMPONENTS) m.gameState.components[c.id] = 100;
                for (const i of m.ITEMS) m.gameState.items[i.id] = 2;
            })()`,
            open: "window.__GAME.scene.getScene('UIScene').openCraft()",
            ready: 'window.__DOM_CRAFT.isOpen()',
            state: 'craftOpen'
        },
        phaser: null
    },
    settings: {
        seed: 'mid',
        dom: {
            prepare: `(() => { const ui = window.__GAME.scene.getScene('UIScene'); ui._pendingDaily = null; ui.registry.set('dailyInfo', null); if (ui._dailyOpen) ui.hideDailyModal(); })()`,
            open: "window.__GAME.scene.getScene('UIScene').openModal()",
            ready: '!!window.__DOM_SETTINGS && window.__DOM_SETTINGS.isOpen()',
            state: 'settingsOpen'
        },
        phaser: {
            prepare: `(() => { const ui = window.__GAME.scene.getScene('UIScene'); ui._pendingDaily = null; ui.registry.set('dailyInfo', null); if (ui._dailyOpen) ui.hideDailyModal(); })()`,
            open: "window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown')",
            ready: "window.__GAME.scene.getScene('UIScene')._settingsOpen",
            state: 'settingsOpen'
        }
    },
    daily: {
        seed: 'fresh',
        dom: {
            prepare: null,
            open: "window.__GAME.scene.getScene('UIScene').tryShowDailyModal()",
            ready: "window.__GAME.scene.getScene('UIScene')._dailyOpen",
            state: 'dailyOpen'
        },
        phaser: {
            prepare: null,
            open: null,
            ready: "window.__GAME.scene.getScene('UIScene')._dailyOpen",
            state: 'dailyOpen'
        }
    }
};

const target = TARGETS[FORM];
if (!target) {
    console.error(`metrics:p95: неизвестная форма "${FORM}" (есть: craft, settings, daily)`);
    process.exit(2);
}

const pathDef = DOM ? target.dom : target.phaser;
if (!pathDef) {
    console.error(`metrics:p95: у формы ${FORM} нет ${DOM ? 'DOM' : 'Phaser'}-пути`);
    process.exit(2);
}

const URL = DOM ? BASE : withLegacy(BASE);
const MODE = DOM ? 'dom' : 'phaser';

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
let report;
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));
    page.on('console', (m) => {
        if (m.type() === 'error') {
            consoleErrors.push(`console: ${m.text()}`);
        }
    });
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        },
        { [SAVE_KEY]: JSON.stringify(SEEDS[target.seed] || SEEDS.mid) }
    );
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
    await page.goto(URL, { waitUntil: 'load' });
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
    if (pathDef.prepare) {
        await page.evaluate(pathDef.prepare);
    }

    if (DOM) {
        await page.waitForFunction(() => /__DOM_(CRAFT|SETTINGS|STATUS)/.test(Object.keys(window).join(',')), null, {
            timeout: 30000
        });
    }

    await page.waitForTimeout(FORM === 'daily' ? 900 : 1250);
    if (pathDef.open) {
        await page.evaluate(pathDef.open);
    }

    await page.waitForFunction(pathDef.ready, null, { timeout: 10000 });
    await page.waitForTimeout(800);
    const open = await page.evaluate((flagName) => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return { [flagName]: !!ui[`_${flagName}`], domRoot: !!document.getElementById('ui-root') };
    }, pathDef.state);

    await page.waitForTimeout(WARMUP_MS);

    const rounds = [];
    for (let i = 0; i < 3; i++) {
        rounds.push(
            await page.evaluate(
                (ms) =>
                    new Promise((resolve) => {
                        const deltas = [];
                        const start = performance.now();
                        let last = start;
                        const tick = (now) => {
                            deltas.push(now - last);
                            last = now;
                            if (now - start < ms) {
                                requestAnimationFrame(tick);
                            } else {
                                resolve(deltas);
                            }
                        };
                        requestAnimationFrame(tick);
                    }),
                SECONDS * 1000
            )
        );
    }

    const stats = (d) => {
        const arr = d.slice().sort((a, b) => a - b);
        const p = (q) => arr[Math.min(arr.length - 1, Math.floor(q * (arr.length - 1)))];

        return {
            frames: arr.length,
            meanMs: Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)),
            p50Ms: Number(p(0.5).toFixed(2)),
            p95Ms: Number(p(0.95).toFixed(2)),
            maxMs: Number(arr[arr.length - 1].toFixed(2))
        };
    };
    const perRound = rounds.map(stats);
    const all = stats(rounds.flat());

    report = {
        createdAt: new Date().toISOString(),
        url: URL,
        form: FORM,
        mode: MODE,
        viewport: '1280x720',
        deviceScaleFactor: 1,
        cpuThrottleRate: CPU_RATE,
        secondsPerRound: SECONDS,
        warmupMs: WARMUP_MS,
        screen: open,
        rounds: perRound,
        combined: all,
        p95: all.p95Ms,
        consoleErrors
    };
    console.log(JSON.stringify(report, null, 2));
    await ctx.close();
} finally {
    await browser.close();
}

const out = opt('out');
if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2) + '\n');
}
