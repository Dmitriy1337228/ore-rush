// Приёмка DOM-статус-модалок (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, этап 1, SM1–SM9, Q1–Q5).
// Реальный dev-сервер и state.js: мост текстов, очередь окон, флаги блокировки, жесты,
// портрет и откат флагом. Вёрстку (пороги, пересечения) меряет `npm run ui:check:dom`.
// Скриншоты — docs/dom-phase3/baseline/phase3/status-dom/.
//
// Запуск: npm run verify:status-dom             (DOM-путь, эталон)
//         npm run verify:status-dom -- --legacy (Phaser-путь под флагом, адаптация шагов)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { withLegacy } from '../lib/forms-flag.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const LEGACY = process.argv.includes('--legacy');
const OUT = path.resolve('docs/dom-phase3/baseline/phase3/status-dom');
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

const HIDE_DAILY = () => {
    const ui = window.__GAME.scene.getScene('UIScene');
    ui._pendingDaily = null;
    ui.registry.set('dailyInfo', null);
    if (ui._dailyOpen) {
        ui.hideDailyModal();
    }
};

async function openGame({
    seed = SEEDS.mid,
    width = 1280,
    height = 720,
    legacy = false,
    query = '',
    before = null
} = {}) {
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
    const url = legacy ? withLegacy(BASE, 'status') : query ? `${BASE}?${query}` : BASE;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__GAME?.scene?.getScene('UIScene')?.scene?.isActive?.(), null, {
        timeout: 30000
    });
    await page.waitForFunction(() => !!window.__DOM_STATUS, null, { timeout: 30000 });
    await page.waitForTimeout(900);
    await page.evaluate(HIDE_DAILY);
    await page.waitForFunction(() => !window.__GAME.registry.get('blockLocked'), null, { timeout: 5000 });
    if (before) {
        await page.evaluate(before);
        await page.waitForTimeout(150);
    }

    return { ctx, page };
}

const flags = (page) =>
    page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return {
            offline: !!ui._offlineOpen,
            daily: !!ui._dailyOpen,
            bossReward: !!ui._bossRewardOpen,
            playerDown: !!ui._playerDownOpen,
            settings: !!ui._settingsOpen,
            locked: !!window.__GAME.registry.get('blockLocked'),
            domOpen: ['offline', 'daily', 'boss-reward', 'player-down'].filter((k) => window.__DOM_STATUS.isOpen(k)),
            domHidden: document.querySelector('[data-dom-modal-kind="status"]').hidden
        };
    });

const readState = (page) =>
    page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);

        return { ore: m.gameState.ore, levels: { ...m.gameState.levels }, stars: m.gameState.stars };
    });

const clickOk = (page) => page.click('[data-dom-modal-kind="status"] [data-act="status-ok"]');

// ---------- Phaser-путь под флагом: паритет текстов и очередь ----------
async function runLegacy() {
    {
        const { ctx, page } = await openGame({ legacy: true });
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
            ui.showOfflineModal({ seconds: 7200, reward: 1200, counted: 3600 });
            await new Promise((r) => setTimeout(r, 120));
            const snap = bridge.offlineSnapshot({ seconds: 7200, reward: 1200, counted: 3600 });

            return {
                visible: ui.offlineModal.visible,
                dom: window.__DOM_STATUS.isOpen('offline'),
                text: ui.offlineBody.text,
                snap: snap.body,
                title: ui.offlineModal === null ? '' : 'ok'
            };
        });
        check(
            'L1 Phaser-путь: офлайн-окно Phaser, DOM закрыт',
            m.visible && !m.dom,
            JSON.stringify({ visible: m.visible, dom: m.dom })
        );
        const strip = (t) => t.split('\n').filter(Boolean);

        check(
            'L2 Phaser-путь: текст офлайна = bridge.offlineSnapshot',
            JSON.stringify(strip(m.text)) === JSON.stringify(strip(m.snap)),
            JSON.stringify(strip(m.text))
        );

        const d = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
            ui.hideOfflineModal();
            ui._pendingDaily = { streak: 3, extra: 250 };
            ui.tryShowDailyModal();
            await new Promise((r) => setTimeout(r, 120));
            const snap = bridge.dailySnapshot({ streak: 3, extra: 250 });

            return {
                visible: ui.dailyModal.visible,
                dom: window.__DOM_STATUS.isOpen('daily'),
                streak: ui.dailyStreakText.text,
                name: ui.dailyName.text,
                desc: ui.dailyDesc.text,
                snap
            };
        });
        check(
            'L3 Phaser-путь: дейли-окно и тексты = bridge.dailySnapshot',
            d.visible && !d.dom && d.streak === d.snap.streakText && d.name === d.snap.name && d.desc === d.snap.desc,
            JSON.stringify(d)
        );
        await ctx.close();
    }
}

async function runDom() {
    // ---------- SM1: офлайн — открытие, блокировка, фон, кнопка ----------
    {
        const { ctx, page } = await openGame();
        // Экономика тикает пассивно: замораживаем таймеры, чтобы сравнение руды
        // измеряло только клики (ввод при этом работает).
        await page.evaluate(() => {
            window.__GAME.scene.getScene('GameScene').time.paused = true;
        });
        const before = await readState(page);
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
            ui.showOfflineModal({ seconds: 7200, reward: 1200, counted: 3600 });
            await new Promise((r) => setTimeout(r, 150));
            const layer = document.querySelector('[data-dom-modal-kind="status"]');
            const snap = bridge.offlineSnapshot({ seconds: 7200, reward: 1200, counted: 3600 });

            return {
                open: window.__DOM_STATUS.isOpen('offline'),
                flag: !!ui._offlineOpen,
                locked: !!window.__GAME.registry.get('blockLocked'),
                title: layer.querySelector('.dom-title').textContent,
                lines: [...layer.querySelectorAll('.dom-line')].map((e) => e.textContent),
                button: layer.querySelector('[data-act="status-ok"]').textContent,
                snap
            };
        });
        check(
            'SM1a офлайн открыт, флаг и блокировка',
            m.open && m.flag && m.locked && m.title === m.snap.title && m.button === m.snap.okLabel,
            JSON.stringify({ open: m.open, flag: m.flag, locked: m.locked })
        );
        const strip = (t) => t.split('\n').filter(Boolean);
        check(
            'SM1b тексты = bridge.offlineSnapshot',
            JSON.stringify(m.lines) === JSON.stringify(strip(m.snap.body)),
            JSON.stringify(m.lines)
        );

        for (let i = 0; i < 3; i++) {
            await page.mouse.click(290, 420);
        }

        await page.waitForTimeout(150);
        const during = await readState(page);
        check('SM1c клики в игру под скримом не добывают', during.ore === before.ore, `${before.ore} -> ${during.ore}`);

        await page.mouse.click(20, 700);
        const still = await flags(page);
        check('SM1d клик по фону не закрывает окно', still.domOpen.includes('offline'));
        await page.screenshot({ path: path.join(OUT, 'sm1-offline.png') });

        await clickOk(page);
        await page.waitForTimeout(150);
        const closed = await flags(page);
        check(
            'SM1e кнопка закрывает окно и снимает блокировку',
            closed.domOpen.length === 0 && !closed.offline && !closed.locked,
            JSON.stringify(closed)
        );
        await ctx.close();
    }

    // ---------- SM2/SM5: очередь и переходы офлайн → дейли ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui.showOfflineModal({ seconds: 7200, reward: 1200, counted: 3600 });
            ui._pendingDaily = { streak: 3, extra: 250 };
            ui.tryShowDailyModal();
            await new Promise((r) => setTimeout(r, 80));
            const blocked = window.__DOM_STATUS.current();
            ui.hideOfflineModal();
            await new Promise((r) => setTimeout(r, 120));
            const after = window.__DOM_STATUS.current();
            const slots = document.querySelectorAll('.dom-daily-slot').length;
            const active = document.querySelectorAll('.dom-daily-slot.is-active').length;
            const streak = document.querySelector('.dom-status-streak')?.textContent;

            return { blocked, after, slots, active, streak };
        });
        check(
            'SM2a дейли ждёт закрытия офлайна и открывается после',
            m.blocked === 'offline' && m.after === 'daily',
            JSON.stringify(m)
        );
        check(
            'SM2b 7 слотов, активен ровно один, серия верная',
            m.slots === 7 && m.active === 1 && m.streak === 'Серия: 3 дня',
            JSON.stringify({ slots: m.slots, active: m.active, streak: m.streak })
        );
        const st = await flags(page);
        check('SM2c одновременно открыто одно окно', st.domOpen.length === 1, JSON.stringify(st.domOpen));
        await page.screenshot({ path: path.join(OUT, 'sm2-daily.png') });
        await clickOk(page);
        await page.waitForTimeout(150);
        check('SM2d дейли закрывается кнопкой', (await flags(page)).domOpen.length === 0);
        await ctx.close();
    }

    // ---------- SM3/Q4: награда босса поверх настроек, очередь дейли ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
            await ui.openModal();
            await new Promise((r) => setTimeout(r, 250));
            ui._pendingDaily = { streak: 4, extra: 100 };
            const reward = {
                bounty: 5000,
                elapsedSec: 32,
                speedMult: 1.5,
                comps: { scrap: 2, crystal: 1 },
                artifactId: 'art_miner_totem'
            };
            ui.showBossRewardModal(reward);
            await new Promise((r) => setTimeout(r, 150));
            const panel = document.querySelector('[data-dom-modal-kind="status"]');
            const snap = bridge.bossRewardSnapshot(reward);

            return {
                after: window.__DOM_STATUS.current(),
                settings: !!ui._settingsOpen,
                daily: !!ui._dailyOpen,
                bounty: panel.querySelector('.dom-status-bounty')?.textContent,
                comps: panel.querySelectorAll('.dom-comp').length,
                artifact: !!panel.querySelector('.dom-artifact'),
                snap
            };
        });
        check(
            'SM3a награда босса открыта, настройки закрыты, дейли ждёт',
            m.after === 'boss-reward' && !m.settings && !m.daily,
            JSON.stringify(m)
        );
        check(
            'SM3b баунти и компоненты из снимка',
            m.bounty === m.snap.bountyText && m.comps === m.snap.comps.length && m.artifact,
            JSON.stringify({ bounty: m.bounty, comps: m.comps })
        );
        await page.screenshot({ path: path.join(OUT, 'sm3-boss-reward.png') });
        await clickOk(page);
        await page.waitForTimeout(200);
        const q = await flags(page);
        check(
            'SM3c после OK открывается отложенная награда дня',
            q.domOpen.length === 1 && q.domOpen[0] === 'daily',
            JSON.stringify(q.domOpen)
        );
        await clickOk(page);
        await page.waitForTimeout(120);
        await ctx.close();
    }

    // ---------- SM4: вырубление поверх настроек, затем дейли ----------
    {
        const { ctx, page } = await openGame();
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
            await ui.openModal();
            await new Promise((r) => setTimeout(r, 250));
            ui._pendingDaily = { streak: 5, extra: 0 };
            const info = { bossName: 'Алмазный владыка', dmg: 123456789, maxPlayer: 987654321 };
            ui.showPlayerDownModal(info);
            await new Promise((r) => setTimeout(r, 150));
            const panel = document.querySelector('[data-dom-modal-kind="status"]');
            const snap = bridge.playerDownSnapshot(info);

            return {
                after: window.__DOM_STATUS.current(),
                settings: !!ui._settingsOpen,
                daily: !!ui._dailyOpen,
                lines: [...panel.querySelectorAll('.dom-line')].map((e) => e.textContent),
                snap
            };
        });
        const strip = (t) => t.split('\n').filter(Boolean);
        check(
            'SM4a вырубление открыто, настройки закрыты, дейли ждёт',
            m.after === 'player-down' && !m.settings && !m.daily,
            JSON.stringify({ after: m.after, settings: m.settings })
        );
        check(
            'SM4b тексты вырубления = bridge.playerDownSnapshot',
            JSON.stringify(m.lines) === JSON.stringify(strip(m.snap.body)),
            JSON.stringify(m.lines)
        );
        await page.screenshot({ path: path.join(OUT, 'sm4-player-down.png') });
        await clickOk(page);
        await page.waitForTimeout(200);
        check(
            'SM4c после OK открывается дейли',
            (await flags(page)).domOpen[0] === 'daily',
            JSON.stringify((await flags(page)).domOpen)
        );
        await clickOk(page);
        await page.waitForTimeout(120);
        await ctx.close();
    }

    // ---------- SM6: окна не пишут в state; 20 циклов ----------
    {
        const { ctx, page } = await openGame();
        await page.evaluate(() => {
            window.__GAME.scene.getScene('GameScene').time.paused = true;
        });
        const before = await readState(page);
        const errorsBefore = consoleErrors.length;
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            let maxOpen = 0;
            for (let i = 0; i < 20; i++) {
                ui.showOfflineModal({ seconds: 60, reward: 5, counted: 60 });
                await new Promise((r) => setTimeout(r, 16));
                maxOpen = Math.max(maxOpen, window.__DOM_STATUS.current() ? 1 : 0);
                ui.hideOfflineModal();
                await new Promise((r) => setTimeout(r, 16));
            }

            return { maxOpen, open: window.__DOM_STATUS.current() };
        });
        const after = await readState(page);
        check(
            'SM6a 20 циклов: одно окно, открыто/закрыто без ошибок',
            m.maxOpen === 1 && m.open === null && consoleErrors.length === errorsBefore,
            JSON.stringify(m)
        );
        check(
            'SM6b показ окна не меняет руду/уровни',
            JSON.stringify(before.levels) === JSON.stringify(after.levels) && before.ore === after.ore
        );
        await ctx.close();
    }

    // ---------- SM8: перезагрузка во время окна ----------
    {
        const { ctx, page } = await openGame();
        await page.evaluate(() => {
            window.__GAME.scene.getScene('UIScene').showOfflineModal({ seconds: 60, reward: 5, counted: 60 });
        });
        await page.waitForTimeout(150);
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(
            () => !!window.__DOM_STATUS && !!window.__GAME?.scene?.getScene('UIScene')?.L,
            null,
            {
                timeout: 30000
            }
        );
        await page.waitForTimeout(1200);
        const m = await page.evaluate(() => ({
            booted: !!window.__DOM_STATUS,
            locked: !!window.__GAME.registry.get('blockLocked')
        }));
        check('SM8 перезагрузка посреди окна: игра снова грузится', m.booted, JSON.stringify(m));
        await ctx.close();
    }

    // ---------- SM9: обучение на Phaser до tutorialDone ----------
    {
        const { ctx, page } = await openGame({ seed: { ...SEEDS.mid, tutorialDone: false } });
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const st = await import(files.find((u) => u.includes('/src/state.js')));
            ui._pendingDaily = { streak: 1, extra: 0 };
            ui.tryShowDailyModal();
            await new Promise((r) => setTimeout(r, 150));
            const daily = window.__DOM_STATUS.current();
            ui.hideDailyModal();
            await new Promise((r) => setTimeout(r, 2600));

            return {
                daily,
                tutorialDone: !!st.gameState.tutorialDone,
                tabs: (ui.tabBtns || []).length,
                domList: !!ui.domUpgrades
            };
        });
        check(
            'SM9 пока обучение не завершено, список на Phaser (D3)',
            m.daily === 'daily' && !m.tutorialDone && m.tabs > 0 && !m.domList,
            JSON.stringify(m)
        );
        await ctx.close();
    }

    // ---------- Q1: портрет — все четыре окна в кадре без H-SCROLL ----------
    {
        const { ctx, page } = await openGame({ width: 390, height: 844 });
        const kinds = [
            ['offline', 'ui.showOfflineModal({ seconds: 7200, reward: 1200, counted: 3600 })'],
            ['daily', 'ui._pendingDaily = { streak: 6, extra: 12345 }; ui.tryShowDailyModal()'],
            [
                'boss-reward',
                "ui.showBossRewardModal({ bounty: 5000, elapsedSec: 32, speedMult: 1.5, comps: { scrap: 2 }, artifactId: 'art_miner_totem' })"
            ],
            [
                'player-down',
                "ui.showPlayerDownModal({ bossName: 'Алмазный владыка', dmg: 123456789, maxPlayer: 987654321 })"
            ]
        ];
        let allOk = true;
        for (const [kind, script] of kinds) {
            const m = await page.evaluate(async (js) => {
                const ui = window.__GAME.scene.getScene('UIScene');
                eval(js);
                await new Promise((r) => setTimeout(r, 200));
                const panel = document.querySelector('[data-dom-modal-kind="status"] [data-dom-modal]');
                const scroll = panel.querySelector('[data-dom-scroll]');
                const btn = panel.querySelector('[data-act="status-ok"]');
                const pr = panel.getBoundingClientRect();
                const br = btn.getBoundingClientRect();
                const font = parseFloat(
                    getComputedStyle(panel.querySelector('.dom-line, .dom-desc, .dom-title')).fontSize
                );

                return {
                    kind: window.__DOM_STATUS.current(),
                    inViewport:
                        pr.x >= -1 &&
                        pr.y >= -1 &&
                        pr.right <= window.innerWidth + 1 &&
                        pr.bottom <= window.innerHeight + 1,
                    noHScroll: scroll.scrollWidth <= scroll.clientWidth + 1,
                    touch: br.height >= 40,
                    font
                };
            }, script);
            const ok = m.kind === kind && m.inViewport && m.noHScroll && m.touch && m.font >= 10;
            allOk = allOk && ok;
            check(`Q1 ${kind}: в кадре, без H-SCROLL, тап ≥40, кегль ≥10`, ok, JSON.stringify(m));
            await page.screenshot({ path: path.join(OUT, `q1-${kind}-390x844.png`) });
            await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');
                if (ui._offlineOpen) {
                    ui.hideOfflineModal();
                }

                if (ui._dailyOpen) {
                    ui.hideDailyModal();
                }

                if (ui._bossRewardOpen) {
                    ui.hideBossRewardModal();
                }

                if (ui._playerDownOpen) {
                    ui.hidePlayerDownModal();
                }
            });
            await page.waitForTimeout(150);
        }

        check('Q1 сводно: четыре окна в портрете', allOk);
        await ctx.close();
    }

    // ---------- Q2: длинный текст награды не ломает вёрстку ----------
    {
        const { ctx, page } = await openGame({ width: 390, height: 844 });
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = { streak: 2, extra: { name: 'Очень длинное название улучшения для проверки переноса' } };
            ui.tryShowDailyModal();
            await new Promise((r) => setTimeout(r, 200));
            const panel = document.querySelector('[data-dom-modal-kind="status"] [data-dom-modal]');
            const scroll = panel.querySelector('[data-dom-scroll]');
            const desc = panel.querySelector('.dom-desc');
            const r = desc.getBoundingClientRect();

            return {
                open: window.__DOM_STATUS.current(),
                noHScroll: scroll.scrollWidth <= scroll.clientWidth + 1,
                lines: Math.round(r.height / parseFloat(getComputedStyle(desc).lineHeight))
            };
        });
        check(
            'Q2 длинное имя улучшения переносится без H-SCROLL',
            m.open === 'daily' && m.noHScroll && m.lines >= 3,
            JSON.stringify(m)
        );
        await page.screenshot({ path: path.join(OUT, 'q2-long-daily-390x844.png') });
        await ctx.close();
    }

    // ---------- Q3/Q5: дейли поверх DOM-списка, клики под скримом не проходят ----------
    {
        const { ctx, page } = await openGame({ query: 'domUpgradesSpike=1' });
        const before = await readState(page);
        const m = await page.evaluate(async () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = { streak: 2, extra: 0 };
            ui.tryShowDailyModal();
            await new Promise((r) => setTimeout(r, 200));
            const list = document.querySelector('[data-dom-upgrades]');
            const status = document.querySelector('[data-dom-modal-kind="status"]');
            const z = (el) => Number(getComputedStyle(el).zIndex) || 0;
            const btn = document.querySelector('[data-dom-upgrades] [data-buy]');
            const br = btn.getBoundingClientRect();

            return {
                daily: window.__DOM_STATUS.current(),
                listVisible: !!list && !list.hidden,
                listZ: z(list),
                statusZ: z(status),
                buy: { x: br.x + br.width / 2, y: br.y + br.height / 2 }
            };
        });
        check(
            'Q3 дейли поверх списка: список виден, статус выше по z',
            m.daily === 'daily' && m.listVisible && m.statusZ > m.listZ,
            JSON.stringify(m)
        );
        await page.mouse.click(m.buy.x, m.buy.y);
        await page.waitForTimeout(200);
        const after = await readState(page);
        check(
            'Q5 клик по кнопке покупки под скримом не меняет уровень',
            JSON.stringify(before.levels) === JSON.stringify(after.levels),
            JSON.stringify(before.levels)
        );
        await page.screenshot({ path: path.join(OUT, 'q3-daily-over-list.png') });
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
