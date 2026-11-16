// Пилот DOM (этап 0.3 / 1.9 / этап 6): p95 времени кадра при открытой мастерской.
// Один и тот же скрипт для baseline (Phaser) и DOM-версии (`--dom` -> ?dom=1).
//
// Условия замера (фиксированы для сравнимости):
//  - Chromium, viewport 1280x720, deviceScaleFactor 1;
//  - эмуляция CPU x4 (CDP Emulation.setCPUThrottlingRate);
//  - сейв/состояние `craft` из scripts/lib/ui-matrix.mjs, таймеры экономики НЕ паузятся;
//  - 1 с прогрева, затем 10 с замеров по requestAnimationFrame; p95 по всем кадрам.
//
// Запуск: node scripts/pilot-frame-p95.mjs [--dom] [--seconds 10] [--out <file.json>]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { STATES, SAVE_KEY } from './lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const URL = flag('dom') ? `${BASE}/?dom=1` : BASE;
const SECONDS = Number(opt('seconds', 10));
const WARMUP_MS = 1000;
const CPU_RATE = 4;
const craftState = STATES.find((s) => s.id === 'craft');

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
        if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
    });
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        },
        { [SAVE_KEY]: JSON.stringify(craftState.seed) }
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
    if (flag('dom')) {
        // DOM-версия (этап 2): боевой экран монтирует UIScene по флагу ?dom=1.
        await page.waitForFunction(() => !!window.__DOM_CRAFT, null, { timeout: 30000 });
        await page.waitForTimeout(1250); // отложенная ежедневная награда
        await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = null;
            ui.registry.set('dailyInfo', null);
            if (ui._dailyOpen) ui.hideDailyModal();
        });
        await page.waitForTimeout(350);
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
        await page.waitForFunction(() => window.__DOM_CRAFT.isOpen(), null, { timeout: 10000 });
    } else {
        await craftState.setup(page);
    }
    await page.waitForTimeout(800);
    const open = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return { craftOpen: !!ui._craftOpen, domRoot: !!document.getElementById('ui-root') };
    });

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
                            if (now - start < ms) requestAnimationFrame(tick);
                            else resolve(deltas);
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
    // Итоговый p95 — по объединённой выборке всех раундов (устойчивее к «холодному» первому).
    const all = stats(rounds.flat());

    report = {
        createdAt: new Date().toISOString(),
        url: URL,
        mode: flag('dom') ? 'dom' : 'phaser',
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
