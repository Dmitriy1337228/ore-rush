// DOM-golden форм (этап 5 пилота, шаг 5.3; фаза 2 — шаг 1.3): tolerant-diff скриншота формы.
// Скриншоты ui-check/ui-review и так снимают страницу целиком (DOM в кадре), но golden сцены
// фиксирует Phaser-экран; здесь — отдельный DOM-эталон.
//
// Детерминизм: сид/подготовка — из реестра форм (scripts/lib/dom-forms.mjs); GameScene и
// UIScene приостанавливаются (таймеры/твины стоят) — кадр статичен между прогонами.
//
// Эталоны: tests/characterization/golden/dom/<form>/default-<WxH>.png
// Запуск: npm run test:dom-golden [-- --form craft] [--update] [--runs 3]
// Пороги: CHANNEL_TOLERANCE (канал 0..255) и MAX_DIFF_RATIO (доля пикселей) — общие для форм.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { FORMS, resolveForms } from '../lib/dom-forms.mjs';
import { decodePng, diffRatio } from '../../tests/characterization/helpers/png.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const ROOT = process.cwd();
const GOLDEN_ROOT = path.join(ROOT, 'tests/characterization/golden/dom');
const SHOT_ROOT = path.join(ROOT, 'shots/dom-golden');
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const RUNS = Number(opt('runs', 1));
const requested = opt('form', 'all');
const forms = resolveForms(requested);
if (!forms) {
    console.error(`dom-golden: неизвестная форма "${requested}" (есть: ${FORMS.map((f) => f.id).join(', ')}, all)`);
    process.exit(2);
}

// Допуски: DOM-рендер стабилен, но шрифтовой растеризатор браузера может дать единичные
// пиксели на сглаживании. 16 по каналу и 0.5% пикселей — с запасом, при этом реальная
// правка вёрстки даёт кратно больше.
const CHANNEL_TOLERANCE = 16;
const MAX_DIFF_RATIO = 0.005;
const STATE = 'default';
const SIZE_RE = /^(\d+)x(\d+)$/;

const active = forms.filter((f) => !f.pending);
const skipped = requested === 'all' ? [] : forms.filter((f) => f.pending);
for (const f of skipped) {
    console.log(`пропущено ${f.id}: форма ещё не на DOM (pending)`);
}

fs.mkdirSync(SHOT_ROOT, { recursive: true });

const jobs = [];
for (const form of active) {
    for (const size of form.golden) {
        const m = size.match(SIZE_RE);
        if (!m) {
            console.error(`dom-golden: плохой размер "${size}" у формы ${form.id}`);
            process.exit(2);
        }

        for (const variant of form.kinds || [null]) {
            jobs.push({ form, variant, size, width: Number(m[1]), height: Number(m[2]) });
        }
    }
}

let exitCode = 0;
if (jobs.length) {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const browser = await chromium.launch();

    const capture = async (job, i) => {
        const ctx = await browser.newContext({
            viewport: { width: job.width, height: job.height },
            deviceScaleFactor: 1
        });
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
            { [SAVE_KEY]: JSON.stringify(SEEDS[job.form.seed] || SEEDS.mid) }
        );
        await page.goto(BASE, { waitUntil: 'load' });
        await page.waitForFunction(
            (api) => !!window[api] && window.__GAME.scene.getScene('UIScene').L && document.fonts.status === 'loaded',
            job.form.api,
            { timeout: 30000 }
        );
        await page.waitForTimeout(1250);
        if (job.form.prepare) {
            await page.evaluate(job.form.prepare);
        }

        await page.waitForTimeout(350);
        await page.evaluate(job.variant ? job.variant.open : job.form.open);
        await page.waitForFunction(job.variant ? job.variant.isOpen : job.form.isOpen, null, { timeout: 10000 });
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const game = window.__GAME;
            game.scene.pause('GameScene');
            game.scene.pause('UIScene');
        });
        await page.waitForTimeout(250);
        const kind = job.variant ? job.variant.id : STATE;
        const dir = path.join(SHOT_ROOT, `${job.form.id}-${kind}-${job.size}`);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `run-${i}.png`);
        await page.screenshot({ path: file });
        await ctx.close();

        return { file, errors };
    };

    try {
        for (const job of jobs) {
            const kind = job.variant ? job.variant.id : STATE;
            const golden = path.join(GOLDEN_ROOT, job.form.id, `${kind}-${job.size}.png`);
            const shots = [];
            for (let i = 1; i <= RUNS; i++) {
                shots.push({ i, ...(await capture(job, i)) });
            }

            const errors = shots.flatMap((s) => s.errors);
            if (errors.length) {
                console.error(
                    `dom-golden ${job.form.id} ${job.variant ? job.variant.id : STATE} ${job.size}: console/pageerror — ${errors.length}`
                );
                errors.slice(0, 5).forEach((e) => console.error('  ' + e));
                exitCode = 1;
                continue;
            }

            if (flag('update')) {
                fs.mkdirSync(path.dirname(golden), { recursive: true });
                fs.copyFileSync(shots[0].file, golden);
                console.log(
                    `dom-golden ${job.form.id} ${job.variant ? job.variant.id : STATE} ${job.size}: эталон обновлён — ${path.relative(ROOT, golden)}`
                );
                continue;
            }

            if (!fs.existsSync(golden)) {
                console.error(
                    `dom-golden ${job.form.id} ${job.variant ? job.variant.id : STATE} ${job.size}: нет эталона ${path.relative(ROOT, golden)} — запустите с --update`
                );
                exitCode = 1;
                continue;
            }

            const want = decodePng(fs.readFileSync(golden));
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
                    `dom-golden ${job.form.id} ${job.variant ? job.variant.id : STATE} ${job.size} run ${s.i}: ${(ratio * 100).toFixed(3)}% пикселей вне допуска ${CHANNEL_TOLERANCE} — ${ok ? 'ok' : 'FAIL'}`
                );
            }

            console.log(
                `dom-golden ${job.form.id} ${job.variant ? job.variant.id : STATE} ${job.size}: прогонов ${RUNS}, худший ${(worst * 100).toFixed(3)}%, порог ${(MAX_DIFF_RATIO * 100).toFixed(2)}% — ${bad ? 'FAIL' : 'ok'}`
            );
            if (bad) {
                exitCode = 1;
            }
        }
    } finally {
        await browser.close();
    }
}

process.exitCode = exitCode;
