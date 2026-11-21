// Приёмка DOM-списка улучшений (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, этап 2, U1–U9).
// Реальный dev-сервер и state.js: ряды/вкладки/пакеты, покупка за кадр, seam боя и
// полноэкранных DOM-форм, узкий ландшафт, откат флагом. Вёрстку (пороги, пересечения)
// меряет `npm run ui:check:dom -- --form upgrades`; golden — `test:dom-golden`.
// Скриншоты — docs/dom-phase3/baseline/phase3/upgrades-dom/.
//
// Запуск: npm run verify:upgrades-dom             (DOM-путь, эталон)
//         npm run verify:upgrades-dom -- --legacy (Phaser-путь под флагом, адаптация)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { withLegacy } from '../lib/forms-flag.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const LEGACY = process.argv.includes('--legacy');
const OUT = path.resolve('docs/dom-phase3/baseline/phase3/upgrades-dom');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) {
        passed++;
    } else {
        failed++;
    }
}

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
const consoleErrors = [];
const trackErrors = (page) => {
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));
    page.on('console', (m) => {
        if (m.type() === 'error') {
            consoleErrors.push(`console: ${m.text()}`);
        }
    });
};

async function openGame({ seed = SEEDS.mid, width = 1280, height = 720, legacy = false } = {}) {
    const ctx = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: width < 600
    });
    const page = await ctx.newPage();
    trackErrors(page);
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        },
        { [SAVE_KEY]: JSON.stringify(seed) }
    );
    await page.goto(legacy ? withLegacy(BASE, 'upgrades') : BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__GAME?.scene?.getScene('UIScene')?.scene?.isActive?.(), null, {
        timeout: 30000
    });
    await page.waitForFunction(
        () => {
            const ui = window.__GAME.scene.getScene('UIScene');

            return window.__DOM_UPGRADES || (ui.rows && ui.rows.length > 0);
        },
        null,
        { timeout: 30000 }
    );
    await page.waitForTimeout(900);
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) {
            ui.hideDailyModal();
        }
    });
    await page.waitForFunction(() => !window.__GAME.registry.get('blockLocked'), null, { timeout: 5000 });

    return { ctx, page };
}

const readState = (page) =>
    page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);

        return { ore: m.gameState.ore, level: m.gameState.levels.pickaxe, tier: m.gameState.tier };
    });

async function tap(page, sel) {
    const r = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) {
            return null;
        }

        const b = el.getBoundingClientRect();

        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, sel);
    await page.mouse.click(r.x, r.y);
}

const listHidden = (page) =>
    page.evaluate(() => {
        const el = document.querySelector('[data-dom-upgrades]');

        return !el || !!el.hidden;
    });

async function runLegacy() {
    const { ctx, page } = await openGame({ legacy: true });
    const m = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return {
            rows: (ui.rows || []).length,
            tabs: (ui.tabBtns || []).length,
            dom: !!window.__DOM_UPGRADES
        };
    });
    check(
        'L1 Phaser-путь: 27 рядов и вкладки построены, DOM-панели нет',
        m.rows === 27 && m.tabs === 2 && !m.dom,
        JSON.stringify(m)
    );

    const before = await readState(page);
    await page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        m.gameState.ore = 1e12;
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.refreshUi();
        ui.switchTab('equipment');
        ui.buyAmount = 1;
        ui.refreshUi();
    });
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const row = ui.rows.find((r) => r && r.btn && r.btn.emit && r.def && r.def.id === 'pickaxe');

        if (row) {
            row.btn.emit('pointerup');
        }
    });
    const after = await readState(page);
    check(
        'L2 Phaser-путь: покупка из списка работает',
        after.level > before.level,
        `${before.level} -> ${after.level}`
    );
    await ctx.close();
}

async function runDom() {
    // ---------- U1: панель и вкладки, Phaser-хром выключен ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const st = await import(files.find((u) => u.includes('/src/state.js')));
            // Как в Phaser-списке: показаны доступные и «следующее» в цепочке (isUpgradeVisible)
            const expectedRows = st.UPGRADES.filter((d) => d.tab === 'equipment' && st.isUpgradeVisible(d.id)).length;
            const ui = window.__GAME.scene.getScene('UIScene');
            const panel = document.querySelector('[data-dom-upgrades]');
            const tabs = [...panel.querySelectorAll('[data-tab]')];

            return {
                expectedRows,
                open: !!window.__DOM_UPGRADES && !panel.hidden,
                rows: panel.querySelectorAll('[data-row]').length,
                tabs: tabs.length,
                active: tabs.filter((t) => t.dataset.on === '1').length,
                phaserRows: (ui.rows || []).length,
                phaserTabsVisible: (ui.tabBtns || []).some((t) => t.c.visible),
                listVisible: ui.listContent.visible
            };
        });
        check(
            'U1 ряды как в Phaser (доступные + следующее), 2 вкладки, Phaser-список не строится/скрыт',
            m.open &&
                m.rows === m.expectedRows &&
                m.tabs === 2 &&
                m.active === 1 &&
                m.phaserRows === 0 &&
                !m.phaserTabsVisible &&
                !m.listVisible,
            JSON.stringify(m)
        );
        await page.screenshot({ path: path.join(OUT, 'u1-list.png') });
        await ctx.close();
    }

    // ---------- U2: вкладки ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(() => {
            window.__DOM_UPGRADES.switchTab('enhance');
            const panel = document.querySelector('[data-dom-upgrades]');
            const enhance = {
                rows: panel.querySelectorAll('[data-row]').length,
                active: panel.querySelector('[data-tab][data-on="1"]')?.dataset.tab
            };
            window.__DOM_UPGRADES.switchTab('equipment');

            return { enhance, back: panel.querySelector('[data-tab][data-on="1"]')?.dataset.tab };
        });
        check(
            'U2 «Усиления»: 7 рядов и активная вкладка, возврат на «Оборудование»',
            m.enhance.rows === 7 && m.enhance.active === 'enhance' && m.back === 'equipment',
            JSON.stringify(m)
        );
        await ctx.close();
    }

    // ---------- U3: дейли поверх списка ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = { streak: 2, extra: 0 };
            ui.tryShowDailyModal();
            await new Promise((r) => setTimeout(r, 200));
            const list = document.querySelector('[data-dom-upgrades]');
            const status = document.querySelector('[data-dom-modal-kind="status"]');
            const z = (el) => Number(getComputedStyle(el).zIndex) || 0;

            return {
                daily: window.__DOM_STATUS.current(),
                listVisible: !list.hidden,
                listZ: z(list),
                statusZ: z(status)
            };
        });
        check(
            'U3 дейли поверх списка: список под скримом, статус выше',
            m.daily === 'daily' && m.listVisible && m.statusZ > m.listZ,
            JSON.stringify(m)
        );
        await page.click('[data-dom-modal-kind="status"] [data-act="status-ok"]');
        await page.waitForTimeout(150);
        await ctx.close();
    }

    // ---------- U4: seam настроек/крафта/карты ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const hidden = () => !!document.querySelector('[data-dom-upgrades]').hidden;
            const out = {};
            await ui.openModal();
            await new Promise((r) => setTimeout(r, 200));
            out.settings = hidden();
            ui.closeModal();
            await new Promise((r) => setTimeout(r, 200));
            out.afterSettings = hidden();
            await ui.openCraft();
            await new Promise((r) => setTimeout(r, 250));
            out.craft = hidden();
            ui.closeCraft();
            await new Promise((r) => setTimeout(r, 250));
            out.afterCraft = hidden();
            ui.openMap();
            await new Promise((r) => setTimeout(r, 200));
            out.map = hidden();
            ui.closeMap();
            await new Promise((r) => setTimeout(r, 200));

            return { ...out, afterMap: hidden() };
        });
        check(
            'U4 настройки/крафт/карта прячут список и возвращают его',
            m.settings && m.craft && m.map && !m.afterSettings && !m.afterCraft && !m.afterMap,
            JSON.stringify(m)
        );
        await ctx.close();
    }

    // ---------- U5: seam боя (снаряжение вместо списка) ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper');
            await new Promise((r) => setTimeout(r, 350));
            const during = {
                list: !!document.querySelector('[data-dom-upgrades]').hidden,
                boss: !!window.__GAME.registry.get('bossActive')
            };
            window.__GAME.registry.set('bossActive', false);
            await new Promise((r) => setTimeout(r, 250));
            const ui = window.__GAME.scene.getScene('UIScene');
            ui.refreshUi();

            return { during, after: !!document.querySelector('[data-dom-upgrades]').hidden };
        });
        check(
            'U5 бой прячет список (снаряжение), после — возвращает',
            m.during.boss && m.during.list && !m.after,
            JSON.stringify(m)
        );
        await ctx.close();
    }

    // ---------- U6: пакеты x1/x10/МАКС + экономика ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const st = await import(files.find((u) => u.includes('/src/state.js')));
            const ui = window.__GAME.scene.getScene('UIScene');
            st.gameState.ore = 1e9;
            st.gameState.levels.pickaxe = 0;
            st.saveGame();
            window.__DOM_UPGRADES.setBuyAmount(1);
            window.__DOM_UPGRADES.refreshAll();
            await new Promise((r) => setTimeout(r, 80));

            const rows = () => [...document.querySelectorAll('[data-dom-upgrades] [data-row]')];
            const buy = (id) =>
                rows()
                    .find((r) => r.dataset.row === id)
                    ?.querySelector('[data-buy]');
            const press = (el) => {
                const b = el.getBoundingClientRect();
                const opts = { bubbles: true, pointerId: 5, clientX: b.left + 3, clientY: b.top + 3 };
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new PointerEvent('pointerup', opts));
            };

            const l0 = st.gameState.levels.pickaxe;
            const ore0 = st.gameState.ore;
            press(buy('pickaxe'));
            const one = { level: st.gameState.levels.pickaxe, spent: ore0 - st.gameState.ore };

            window.__DOM_UPGRADES.setBuyAmount(10);
            window.__DOM_UPGRADES.refreshAll();
            const l10 = st.gameState.levels.pickaxe;
            const ore10 = st.gameState.ore;
            const expectedCost = st.getBulkCost('pickaxe', 10).total;
            press(buy('pickaxe'));
            const ten = {
                gained: st.gameState.levels.pickaxe - l10,
                cost: ore10 - st.gameState.ore,
                expected: expectedCost
            };

            window.__DOM_UPGRADES.setBuyAmount('max');
            window.__DOM_UPGRADES.refreshAll();
            const lmax = st.gameState.levels.pickaxe;
            const oreMax = st.gameState.ore;
            const expectedN = st.getAffordableBulk('pickaxe', Infinity).n;
            press(buy('pickaxe'));
            const max = {
                gained: st.gameState.levels.pickaxe - lmax,
                cost: oreMax - st.gameState.ore,
                expectedN
            };

            return {
                l0,
                one,
                ten,
                max,
                label: rows()
                    .find((r) => r.dataset.row === 'pickaxe')
                    ?.querySelector('[data-buy]')?.textContent
            };
        });
        check(
            'U6a x1: уровень +1, руда списана по цене state',
            m.one.level === m.l0 + 1 && m.one.spent > 0,
            JSON.stringify(m.one)
        );
        check(
            'U6b x10: ровно +10 и цена пакета из state',
            m.ten.gained === 10 && Math.abs(m.ten.cost - m.ten.expected) < 1e-3,
            JSON.stringify(m.ten)
        );
        check(
            'U6c МАКС: куплено столько, сколько по карману (state), кнопка «Купить»',
            m.max.gained === m.max.expectedN && m.max.gained > 10 && m.label === 'Купить',
            JSON.stringify(m.max)
        );
        await ctx.close();
    }

    // ---------- U7: отклик покупки ≤ 1 кадра ----------
    {
        const { ctx, page } = await openGame();
        await page.evaluate(async () => {
            const url = performance
                .getEntriesByType('resource')
                .map((r) => r.name)
                .find((u) => u.includes('/src/state.js'));
            const m = await import(url);
            m.gameState.ore = 1e24;
            window.__DOM_UPGRADES.setBuyAmount(1);
            window.__DOM_UPGRADES.refreshAll();
            await new Promise((r) => setTimeout(r, 80));
        });
        const m = await page.evaluate(
            () =>
                new Promise((resolve) => {
                    const row = document.querySelector('[data-dom-upgrades] [data-row="pickaxe"]');
                    const before = row.querySelector('.dom-sub').textContent;
                    const btn = row.querySelector('[data-buy]');
                    const b = btn.getBoundingClientRect();
                    const opts = { bubbles: true, pointerId: 9, clientX: b.left + 4, clientY: b.top + 4 };
                    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
                    const start = performance.now();
                    btn.dispatchEvent(new PointerEvent('pointerup', opts));
                    const afterSync = document.querySelector('[data-row="pickaxe"] .dom-sub')?.textContent;
                    let frames = 0;
                    const tick = () => {
                        frames++;
                        const now = document.querySelector('[data-row="pickaxe"] .dom-sub')?.textContent;
                        if (now !== before || frames > 5) {
                            resolve({ before, afterSync, after: now, frames, ms: performance.now() - start });
                        } else {
                            requestAnimationFrame(tick);
                        }
                    };
                    requestAnimationFrame(tick);
                })
        );
        check('U7 ряд перерисован синхронно (≤ 1 кадра)', m.after !== m.before && m.frames <= 1, JSON.stringify(m));
        await ctx.close();
    }

    // ---------- U8: драг по списку не покупает ----------
    {
        const { ctx, page } = await openGame();
        const before = await readState(page);
        const m = await page.evaluate(async () => {
            const scroll = document.querySelector('[data-dom-upgrades-scroll]');
            const btn = document.querySelector('[data-dom-upgrades] [data-buy]');
            const b = btn.getBoundingClientRect();
            const opts = (x) => ({ bubbles: true, pointerId: 3, clientX: x, clientY: b.top + 4 });
            btn.dispatchEvent(new PointerEvent('pointerdown', opts(b.left + 4)));
            btn.dispatchEvent(new PointerEvent('pointermove', opts(b.left + 90)));
            btn.dispatchEvent(new PointerEvent('pointerup', opts(b.left + 90)));
            await new Promise((r) => setTimeout(r, 100));

            return { scrollTop: scroll.scrollTop };
        });
        const after = await readState(page);
        check(
            'U8 жест/драг по кнопке не покупает',
            after.level === before.level,
            JSON.stringify({ before: before.level, after: after.level, ...m })
        );

        await page.evaluate(() => {
            const scroll = document.querySelector('[data-dom-upgrades-scroll]');
            scroll.scrollTop = 240;
        });
        await page.waitForTimeout(150);
        const scrolled = await page.evaluate(() => document.querySelector('[data-dom-upgrades-scroll]').scrollTop);
        check('U8b список прокручивается', scrolled > 100, String(scrolled));
        await ctx.close();
    }

    // ---------- U9: узкий ландшафт 844x390 без H-SCROLL, stress 27/27 ----------
    {
        const { ctx, page } = await openGame({ width: 844, height: 390 });
        const m = await page.evaluate(async () => {
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const st = await import(files.find((u) => u.includes('/src/state.js')));
            st.gameState.tier = 11;
            st.gameState.ore = 9.99e33;
            for (const id of Object.keys(st.gameState.levels)) {
                st.gameState.levels[id] = 999;
            }

            window.__DOM_UPGRADES.refreshAll();
            await new Promise((r) => setTimeout(r, 250));
            const scroll = document.querySelector('[data-dom-upgrades-scroll]');
            const narrow = document.querySelector('[data-dom-upgrades]').classList.contains('is-narrow');
            window.__DOM_UPGRADES.switchTab('enhance');
            const enhance = document.querySelectorAll('[data-dom-upgrades] [data-row]').length;
            window.__DOM_UPGRADES.switchTab('equipment');

            return { narrow, noHScroll: scroll.scrollWidth <= scroll.clientWidth + 1, enhance };
        });
        check(
            'U9 l844: узкая раскладка без H-SCROLL, 27 рядов на двух вкладках',
            m.narrow && m.noHScroll && m.enhance === 7,
            JSON.stringify(m)
        );
        await page.screenshot({ path: path.join(OUT, 'u9-narrow-844x390.png') });
        await ctx.close();
    }
}

try {
    if (LEGACY) {
        await runLegacy();
    } else {
        await runDom();
    }
} finally {
    await browser.close();
}

check('консоль без ошибок', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n=== Итого${LEGACY ? ' (Phaser-путь)' : ''}: ${passed} OK, ${failed} FAIL ===`);
process.exitCode = failed ? 1 : 0;
