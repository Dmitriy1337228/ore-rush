// Приёмка DOM-формы «Настройки» (docs/UI_DOM_PHASE2_PLAN.md, этап 2, ST1–ST14).
// Реальный dev-сервер и state.js: поведение, паритет текстов, блокировки и жесты.
// Вёрстку (пороги, пересечения) меряет `npm run ui:check:dom`; здесь — только скриншоты
// состояний в docs/pilot-baseline/phase2/settings-dom/.
//
// Запуск: npm run verify:settings-dom            (DOM-путь, эталон)
//         npm run verify:settings-dom -- --legacy (Phaser-путь под флагом, адаптация шагов)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { withLegacy } from '../lib/forms-flag.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const LEGACY = process.argv.includes('--legacy');
const OUT = path.resolve('docs/pilot-baseline/phase2/settings-dom');
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

async function openSettings({ seed = SEEDS.mid, width = 1280, height = 720, before = null, legacy = false } = {}) {
    const ctx = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: width < 600
    });
    const page = await ctx.newPage();
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
        { [SAVE_KEY]: JSON.stringify(seed) }
    );
    await page.goto(legacy ? withLegacy(BASE) : BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__GAME?.scene?.getScene('UIScene')?.scene?.isActive?.(), null, {
        timeout: 30000
    });
    if (!legacy) {
        await page.waitForFunction(() => !!window.__DOM_SETTINGS, null, { timeout: 30000 });
    }

    await page.waitForTimeout(900);
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) {
            ui.hideDailyModal();
        }
    });
    // Не спим: ждём фактического снятия блокировки (updateBlockLock идёт по кадру)
    await page.waitForFunction(() => !window.__GAME.registry.get('blockLocked'), null, { timeout: 5000 });
    if (before) {
        await page.evaluate(before);
        await page.waitForTimeout(150);
    }

    // Открытие кнопкой HUD (ST1): тот же обработчик, что у шестерёнки.
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown'));
    if (legacy) {
        await page.waitForFunction(() => window.__GAME.scene.getScene('UIScene')._settingsOpen, null, {
            timeout: 10000
        });
    } else {
        await page.waitForFunction(() => window.__DOM_SETTINGS.isOpen(), null, { timeout: 10000 });
    }

    await page.waitForTimeout(250);

    return { ctx, page };
}

const readState = (page) =>
    page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);

        return {
            ore: m.gameState.ore,
            tier: m.gameState.tier,
            stars: m.gameState.stars,
            levels: { ...m.gameState.levels },
            soundOn: m.gameState.soundOn,
            musicOn: m.gameState.musicOn,
            musicVolume: m.gameState.musicVolume,
            tierEarned: [...m.gameState.tierEarned]
        };
    });

const saveOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ore-rush-save')));
const rectOf = (page, sel) =>
    page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) {
            return null;
        }

        const r = el.getBoundingClientRect();

        return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }, sel);

async function tap(page, sel) {
    const r = await rectOf(page, sel);
    await page.mouse.click(r.cx, r.cy);
}

// ---------- Phaser-путь под флагом (`--legacy`): адаптированные шаги ----------
// Жестовые DOM-проверки (ST4 указатель/ST10 resize/ST13 тач) на Phaser-пути заменяются
// смысловыми эквивалентами; вёрстка Phaser-пути зафиксирована golden `test:ui`.
async function runLegacy() {
    const { ctx, page } = await openSettings({ legacy: true });
    const opened = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return { flag: ui._settingsOpen, visible: ui.modal.visible, dom: !!window.__DOM_SETTINGS?.isOpen() };
    });
    check(
        'L1 Phaser-путь: окно открыто, DOM не открыт',
        opened.flag && opened.visible && !opened.dom,
        JSON.stringify(opened)
    );

    const texts = await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const files = performance.getEntriesByType('resource').map((r) => r.name);
        const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
        const snap = bridge.settingsSnapshot({
            bossActive: !!ui.registry.get('bossActive'),
            portrait: !!ui.L.portrait
        });

        return {
            stats: ui.modalStats.text.split('\n'),
            snapStats: snap.stats,
            prestige: ui.prestigeInfo.text.split('\n'),
            snapPrestige: snap.prestigeLines,
            vol: ui.volPct.text,
            snapVol: snap.volumeText
        };
    });
    check(
        'L12 Phaser-путь: тексты = bridge',
        JSON.stringify(texts.stats) === JSON.stringify(texts.snapStats) &&
            JSON.stringify(texts.prestige) === JSON.stringify(texts.snapPrestige) &&
            texts.vol === texts.snapVol
    );

    const toggles = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.soundBtn.emit('pointerdown');
        ui.musicBtn.emit('pointerdown');

        return { sound: ui.soundText.text, music: ui.musicText.text };
    });
    check(
        'L2/L3 Phaser-путь: тумблеры переключаются',
        toggles.sound === 'Звук: выкл' && toggles.music === 'Музыка: выкл',
        JSON.stringify(toggles)
    );

    const success = await page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        m.gameState.tierEarned[11] = 1e12;
        m.gameState.tier = 3;
        m.gameState.stars = 0;
        m.saveGame();
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.refreshUi();
        ui.tryPrestige();
        const armed = ui.prestigeText.text;
        ui.tryPrestige();
        await new Promise((r) => setTimeout(r, 300));

        return { armed, stars: m.gameState.stars, tier: m.gameState.tier, open: ui._settingsOpen };
    });
    check(
        'L6 Phaser-путь: взвод и успешный престиж',
        /^Точно\? \+/.test(success.armed) && success.stars > 0 && success.tier === 0 && !success.open,
        JSON.stringify(success)
    );

    const reset = await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.settingsBtn.emit('pointerdown');
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        m.gameState.ore = 9999;
        m.gameState.levels.pickaxe = 10;
        ui.refreshUi();
        ui.tryReset();
        const armed = ui.resetText.text;
        ui.tryReset();
        await new Promise((r) => setTimeout(r, 300));

        return { armed, ore: m.gameState.ore, pickaxe: m.gameState.levels.pickaxe, open: ui._settingsOpen };
    });
    check(
        'L7 Phaser-путь: сброс с подтверждением',
        reset.armed === 'Точно сбросить?' && reset.ore === 0 && reset.pickaxe === 0 && !reset.open,
        JSON.stringify(reset)
    );

    const queue = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.settingsBtn.emit('pointerdown');
        ui._pendingDaily = { streak: 1, extra: 100 };
        ui.tryShowDailyModal();
        const whileOpen = { daily: !!ui._dailyOpen, settings: ui._settingsOpen };
        ui.closeModal();

        return { whileOpen };
    });
    check(
        'L9 Phaser-путь: дейли ждёт закрытия настроек',
        queue.whileOpen.settings && !queue.whileOpen.daily,
        JSON.stringify(queue)
    );

    await ctx.close();
}

try {
    if (LEGACY) {
        await runLegacy();
    } else {
        // ---------- ST1: открытие, закрытия, фон и клики в игру ----------
        {
            const { ctx, page } = await openSettings();
            let m = await page.evaluate(() => ({
                open: window.__DOM_SETTINGS.isOpen(),
                locked: window.__GAME.registry.get('blockLocked'),
                panel: !!document.querySelector('[data-dom-modal]')
            }));
            check(
                'ST1a HUD: форма открыта, панель есть, игра заблокирована',
                m.open && m.locked && m.panel,
                JSON.stringify(m)
            );
            const before = await readState(page);
            for (let i = 0; i < 3; i++) {
                await page.mouse.click(290, 420);
            }

            await page.waitForTimeout(150);
            const during = await readState(page);
            check(
                'ST1b клики в игру под формой не начисляют руду',
                during.ore === before.ore,
                `${before.ore} -> ${during.ore}`
            );

            await page.mouse.click(20, 700); // фон (backdrop)
            await page.waitForTimeout(150);
            m = await page.evaluate(() => window.__DOM_SETTINGS.isOpen());
            check('ST1c клик по фону не закрывает', m === true);

            await tap(page, '[data-dom-close]');
            await page.waitForTimeout(200);
            const closedByX = await page.evaluate(() => !window.__DOM_SETTINGS.isOpen());
            await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown'));
            await page.waitForTimeout(200);
            const reopened = await page.evaluate(() => window.__DOM_SETTINGS.isOpen());
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
            const closedByEsc = await page.evaluate(() => !window.__DOM_SETTINGS.isOpen());
            check('ST1d крестик, повторное открытие и Esc', closedByX && reopened && closedByEsc);

            const ore0 = (await readState(page)).ore;
            for (let i = 0; i < 4; i++) {
                await page.mouse.click(290, 420);
            }

            await page.waitForTimeout(150);
            const ore1 = (await readState(page)).ore;
            check('ST1e после закрытия клики снова добывают', ore1 > ore0, `${ore0} -> ${ore1}`);
            await page.screenshot({ path: path.join(OUT, 'st1-desktop.png') });
            await ctx.close();

            // ST1f: узкий телефон 375 px — значение громкости не обрезается,
            // горизонтального переполнения скролла нет (репорт игрока)
            const narrow = await openSettings({ width: 375, height: 812 });
            const nm = await narrow.page.evaluate(() => {
                const panel = document.querySelector('[data-dom-modal]');
                const scroll = panel.querySelector('[data-dom-scroll]');
                const val = panel.querySelector('.dom-range-value');
                const pr = panel.getBoundingClientRect();
                const sr = scroll.getBoundingClientRect();
                const vr = val.getBoundingClientRect();

                return {
                    inViewport:
                        pr.x >= -1 &&
                        pr.y >= -1 &&
                        pr.right <= window.innerWidth + 1 &&
                        pr.bottom <= window.innerHeight + 1,
                    noHScroll: scroll.scrollWidth <= scroll.clientWidth + 1,
                    valueVisible: vr.right <= sr.right + 1 && vr.left >= sr.left - 1,
                    text: val.textContent
                };
            });
            check(
                'ST1f 375px: «50%» виден, горизонтального скролла нет',
                nm.inViewport && nm.noHScroll && nm.valueVisible && nm.text === '50%',
                JSON.stringify(nm)
            );
            await narrow.page.screenshot({ path: path.join(OUT, 'st1-375.png') });
            await narrow.ctx.close();
        }

        // ---------- ST2/ST3: тумблеры, звук подтверждения и musicChanged ----------
        {
            const { ctx, page } = await openSettings();
            await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');
                window.__sfxPlayed = [];
                const orig = ui.sound.play.bind(ui.sound);
                ui.sound.play = (key, opts) => {
                    window.__sfxPlayed.push(key);
                    orig(key, opts);
                };
                window.__musicEvents = 0;
                ui.game.events.on('music-changed', () => {
                    window.__musicEvents++;
                });
            });
            const s0 = await readState(page);
            await tap(page, '[data-act="sound"]');
            const s1 = await readState(page);
            const label = await page.textContent('[data-act="sound"]');
            // Включение звука даёт подтверждающий sfx (выключение — тишина)
            await tap(page, '[data-act="sound"]');
            const sfx = await page.evaluate(() => window.__sfxPlayed.length);
            check(
                'ST2 звук: флаг, подпись, сейв и звук подтверждения',
                s1.soundOn === !s0.soundOn && label === (s1.soundOn ? 'Звук: вкл' : 'Звук: выкл') && sfx > 0,
                `${label}, sfx=${sfx}`
            );
            await tap(page, '[data-act="music"]');
            const s2 = await readState(page);
            const events = await page.evaluate(() => window.__musicEvents);
            check(
                'ST3 музыка: флаг, подпись и musicChanged',
                s2.musicOn === !s1.musicOn && events > 0,
                `events=${events}`
            );
            await ctx.close();
        }

        // ---------- ST4: слайдер указателем (тап, драг, вылет за трек, 0/100) ----------
        {
            const { ctx, page } = await openSettings();
            const r = await rectOf(page, '[data-range="music-volume"]');
            await page.mouse.click(r.x + 2, r.cy);
            await page.waitForTimeout(120);
            let s = await saveOf(page);
            let shown = await page.textContent('.dom-range-value');
            check(
                'ST4a тап в начало трека: 0% сохранено как 0',
                s.musicVolume === 0 && shown === '0%',
                `${s.musicVolume}/${shown}`
            );

            await page.mouse.move(r.cx, r.cy);
            await page.mouse.down();
            await page.mouse.move(r.x + r.w * 0.75, r.cy, { steps: 6 });
            await page.mouse.up();
            await page.waitForTimeout(120);
            s = await saveOf(page);
            shown = await page.textContent('.dom-range-value');
            check(
                'ST4b драг по треку: значение в [0..1], подпись совпадает',
                s.musicVolume > 0 && s.musicVolume <= 1 && shown === `${Math.round(s.musicVolume * 100)}%`,
                `${s.musicVolume}/${shown}`
            );

            // Палец уходит за трек при драге — значение клампится в 100%
            await page.mouse.move(r.cx, r.cy);
            await page.mouse.down();
            await page.mouse.move(r.x + r.w + 80, r.cy, { steps: 8 });
            await page.mouse.up();
            await page.waitForTimeout(120);
            s = await saveOf(page);
            check('ST4c выход пальца за трек: клампится в 1', s.musicVolume === 1, String(s.musicVolume));

            await page.screenshot({ path: path.join(OUT, 'st4-slider.png') });
            await ctx.close();
        }

        // ---------- ST5: престиж недоступен + короткая формулировка в портрете ----------
        {
            const { ctx, page } = await openSettings();
            const m = await page.evaluate(async () => {
                const files = performance.getEntriesByType('resource').map((r) => r.name);
                const msg = await import(files.find((u) => u.includes('/src/state/settingsMessages.js')));
                const ui = window.__GAME.scene.getScene('UIScene');
                const stateUrl = files.find((u) => u.includes('/src/state.js'));
                const st = await import(stateUrl);
                const expected = msg.prestigeInfo({
                    can: false,
                    gain: 0,
                    have: st.gameState.tierEarned[11],
                    need: st.PRESTIGE_REQUIREMENT,
                    portrait: false
                });

                return {
                    dom: [...document.querySelectorAll('[data-ref^="prestige"]')].map((e) => e.textContent),
                    expected,
                    dim: document.querySelector('[data-act="prestige"]').classList.contains('is-disabled')
                };
            });
            check(
                'ST5a престиж недоступен: текст = settingsMessages, кнопка неактивна',
                JSON.stringify(m.dom) === JSON.stringify(m.expected) && m.dim,
                JSON.stringify(m.dom)
            );

            const before = await readState(page);
            await tap(page, '[data-act="prestige"]');
            await tap(page, '[data-act="prestige"]');
            const after = await readState(page);
            const open = await page.evaluate(() => window.__DOM_SETTINGS.isOpen());
            check(
                'ST5b клики неактивного престижа ничего не меняют',
                open && before.stars === after.stars && before.tier === after.tier
            );
            await ctx.close();

            const portrait = await openSettings({ width: 390, height: 844 });
            const line = await portrait.page.evaluate(async () => {
                const files = performance.getEntriesByType('resource').map((r) => r.name);
                const msg = await import(files.find((u) => u.includes('/src/state/settingsMessages.js')));
                const st = await import(files.find((u) => u.includes('/src/state.js')));

                return {
                    dom: document.querySelector('[data-ref="prestige1"]').textContent,
                    expected: msg.prestigeInfo({
                        can: false,
                        gain: 0,
                        have: st.gameState.tierEarned[11],
                        need: st.PRESTIGE_REQUIREMENT,
                        portrait: true
                    })[0]
                };
            });
            check('ST5c портрет: короткая формулировка', line.dom === line.expected, JSON.stringify(line));
            await portrait.page.screenshot({ path: path.join(OUT, 'st5-portrait.png') });
            await portrait.ctx.close();
        }

        // ---------- ST6: престиж доступен — взвод, успех, tierChanged, надпись ----------
        {
            const { ctx, page } = await openSettings({
                before: async () => {
                    const url = performance
                        .getEntriesByType('resource')
                        .map((r) => r.name)
                        .find((u) => u.includes('/src/state.js'));
                    const m = await import(url);
                    m.gameState.tierEarned[11] = 1e12;
                    m.gameState.tier = 3;
                    m.gameState.stars = 0;
                    m.saveGame();
                }
            });
            await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');
                window.__tierChanged = 0;
                ui.game.events.on('tier-changed', () => {
                    window.__tierChanged++;
                });
            });
            const before = await readState(page);
            await tap(page, '[data-act="prestige"]');
            const armed = await page.textContent('[data-act="prestige"]');
            await page.screenshot({ path: path.join(OUT, 'st6-armed.png') });
            await tap(page, '[data-act="prestige"]');
            await page.waitForTimeout(250);
            const after = await readState(page);
            const m = await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');

                return {
                    open: window.__DOM_SETTINGS.isOpen(),
                    tierChanged: window.__tierChanged,
                    float: ui.children.list.some((o) => o.type === 'Text' && /Множитель/.test(o.text || ''))
                };
            });
            check(
                'ST6 престиж: взвод, ровно +gain звёзд, закрытие, tierChanged и надпись',
                /^Точно\? \+/.test(armed) &&
                    after.stars === before.stars + 1 &&
                    after.tier === 0 &&
                    !m.open &&
                    m.tierChanged > 0 &&
                    m.float,
                JSON.stringify({ armed, stars: after.stars, ...m })
            );
            await page.screenshot({ path: path.join(OUT, 'st6-success.png') });
            await ctx.close();
        }

        // ---------- ST7: сброс, обучение, повторное открытие ----------
        {
            const { ctx, page } = await openSettings({
                before: async () => {
                    const url = performance
                        .getEntriesByType('resource')
                        .map((r) => r.name)
                        .find((u) => u.includes('/src/state.js'));
                    const m = await import(url);
                    m.gameState.ore = 9999;
                    m.gameState.levels.pickaxe = 10;
                    m.saveGame();
                    const ui = window.__GAME.scene.getScene('UIScene');
                    window.__tutRebuilt = 0;
                    const orig = ui.maybeRebuildTutorial.bind(ui);
                    ui.maybeRebuildTutorial = () => {
                        window.__tutRebuilt++;
                        orig();
                    };
                }
            });
            await tap(page, '[data-act="reset"]');
            const armed = await page.textContent('[data-act="reset"]');
            await tap(page, '[data-act="reset"]');
            await page.waitForTimeout(250);
            const s = await readState(page);
            const m = await page.evaluate(() => ({
                open: window.__DOM_SETTINGS.isOpen(),
                tut: window.__tutRebuilt
            }));
            check(
                'ST7a сброс: взвод, resetGame, обучение пересобрано',
                armed === 'Точно сбросить?' && s.ore === 0 && s.levels.pickaxe === 0 && !m.open && m.tut > 0,
                JSON.stringify({ armed, ...m })
            );

            await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown'));
            await page.waitForTimeout(200);
            const label = await page.textContent('[data-act="reset"]');
            await tap(page, '[data-act="reset"]');
            const rearmed = await page.textContent('[data-act="reset"]');
            check(
                'ST7b повторное открытие сбрасывает «взведённость»',
                label === 'Сбросить весь прогресс' && rearmed === 'Точно сбросить?',
                `${label} -> ${rearmed}`
            );
            await ctx.close();
        }

        // ---------- ST8: бой блокирует престиж/сброс, тумблеры работают ----------
        {
            const { ctx, page } = await openSettings({
                seed: SEEDS.deep,
                before: async () => {
                    window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper');
                }
            });
            const before = await readState(page);
            await tap(page, '[data-act="prestige"]');
            await tap(page, '[data-act="prestige"]');
            await tap(page, '[data-act="reset"]');
            await tap(page, '[data-act="reset"]');
            await page.waitForTimeout(150);
            const after = await readState(page);
            await tap(page, '[data-act="sound"]');
            const s3 = await readState(page);
            const dim = await page.evaluate(() => ({
                prestige: document.querySelector('[data-act="prestige"]').classList.contains('is-disabled'),
                reset: document.querySelector('[data-act="reset"]').classList.contains('is-disabled'),
                boss: !!window.__GAME.registry.get('bossActive')
            }));
            check(
                'ST8 бой: престиж/сброс заблокированы, тумблеры работают',
                dim.boss &&
                    dim.prestige &&
                    dim.reset &&
                    before.stars === after.stars &&
                    before.tier === after.tier &&
                    before.ore === after.ore &&
                    s3.soundOn !== after.soundOn,
                JSON.stringify(dim)
            );
            await page.screenshot({ path: path.join(OUT, 'st8-boss-locked.png') });
            await ctx.close();
        }

        // ---------- ST9: D3 — Phaser-оверлей поверх настроек ----------
        {
            const { ctx, page } = await openSettings();
            const m = await page.evaluate(async () => {
                const ui = window.__GAME.scene.getScene('UIScene');
                ui.showOfflineModal({ seconds: 7200, reward: 1200, rate: 0.28, capSeconds: 14400 });
                await new Promise((r) => setTimeout(r, 250));
                const hidden = document.querySelector('.dom-modal-layer').hidden;
                const overlay = !!ui.offlineModal.visible;
                ui.hideOfflineModal();
                await new Promise((r) => setTimeout(r, 250));
                const restored = !document.querySelector('.dom-modal-layer').hidden;

                return { hidden, overlay, restored, open: window.__DOM_SETTINGS.isOpen() };
            });
            check(
                'ST9a оверлей поверх: настройки спрятаны и возвращаются',
                m.overlay && m.hidden && m.restored && m.open,
                JSON.stringify(m)
            );

            const q = await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');
                ui._pendingDaily = { streak: 1, extra: 100 };
                ui.tryShowDailyModal();
                const whileOpen = { daily: !!ui._dailyOpen, settings: ui._settingsOpen };
                ui.closeModal();
                ui.tryShowDailyModal();

                return { whileOpen, after: !!ui._dailyOpen };
            });
            check('ST9b дейли ждёт закрытия настроек', q.whileOpen.settings && !q.whileOpen.daily, JSON.stringify(q));
            await ctx.close();
        }

        // ---------- ST10: resize/ориентация при открытой форме, значения сохраняются ----------
        {
            const { ctx, page } = await openSettings({
                before: async () => {
                    const url = performance
                        .getEntriesByType('resource')
                        .map((r) => r.name)
                        .find((u) => u.includes('/src/state.js'));
                    const m = await import(url);
                    m.gameState.tierEarned[11] = 1e12;
                    m.gameState.tier = 3;
                    m.saveGame();
                }
            });
            await page.evaluate(() => {
                const r = document.querySelector('[data-range="music-volume"]');
                r.value = '37';
                r.dispatchEvent(new Event('input', { bubbles: true }));
                r.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await tap(page, '[data-act="prestige"]');
            const armedBefore = await page.textContent('[data-act="prestige"]');
            const errorsBefore = consoleErrors.length;
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForTimeout(400);
            const m = await page.evaluate(() => ({
                open: window.__DOM_SETTINGS.isOpen(),
                portrait: document.getElementById('ui-root').classList.contains('portrait'),
                volume: document.querySelector('.dom-range-value').textContent,
                armed: document.querySelector('[data-act="prestige"]').textContent,
                panel: (() => {
                    const r = document.querySelector('[data-dom-modal]').getBoundingClientRect();

                    return (
                        r.x >= -1 && r.y >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1
                    );
                })()
            }));
            check(
                'ST10 resize: форма цела, значение слайдера и взвод сохраняются',
                m.open &&
                    m.portrait &&
                    m.panel &&
                    m.volume === '37%' &&
                    m.armed === armedBefore &&
                    consoleErrors.length === errorsBefore,
                JSON.stringify(m)
            );
            await page.screenshot({ path: path.join(OUT, 'st10-resized.png') });
            await ctx.close();
        }

        // ---------- ST11: закрытие на тике / 20 циклов ----------
        {
            const { ctx, page } = await openSettings();
            const errorsBefore = consoleErrors.length;
            const m = await page.evaluate(async () => {
                const ui = window.__GAME.scene.getScene('UIScene');
                let maxLayers = 0;
                for (let i = 0; i < 20; i++) {
                    ui.closeModal();
                    await new Promise((r) => setTimeout(r, 16));
                    ui.settingsBtn.emit('pointerdown');
                    await new Promise((r) => setTimeout(r, 20));
                    maxLayers = Math.max(maxLayers, document.querySelectorAll('.dom-modal-layer').length);
                }

                return {
                    maxLayers,
                    open: window.__DOM_SETTINGS.isOpen(),
                    locked: window.__GAME.registry.get('blockLocked')
                };
            });
            check(
                'ST11 20 циклов: слой один, окно открыто, ошибок нет',
                m.maxLayers === 1 && m.open && m.locked && consoleErrors.length === errorsBefore,
                JSON.stringify(m)
            );
            await ctx.close();
        }

        // ---------- ST12: тексты DOM = bridge = settingsMessages ----------
        {
            const { ctx, page } = await openSettings();
            const m = await page.evaluate(async () => {
                const files = performance.getEntriesByType('resource').map((r) => r.name);
                const bridge = await import(files.find((u) => u.includes('/src/ui/dom/bridge.js')));
                const msg = await import(files.find((u) => u.includes('/src/state/settingsMessages.js')));
                const ui = window.__GAME.scene.getScene('UIScene');
                const snap = bridge.settingsSnapshot({
                    bossActive: !!ui.registry.get('bossActive'),
                    portrait: document.getElementById('ui-root').classList.contains('portrait')
                });
                const dom = {
                    stats: [...document.querySelectorAll('[data-line]')].map((e) => e.textContent),
                    sound: document.querySelector('[data-act="sound"]').textContent,
                    music: document.querySelector('[data-act="music"]').textContent,
                    volume: document.querySelector('.dom-range-value').textContent,
                    prestige: [...document.querySelectorAll('[data-ref^="prestige"]')].map((e) => e.textContent),
                    button: document.querySelector('[data-act="prestige"]').textContent
                };

                return { snap, dom, msg: { sound: msg.soundLabel(snap.soundOn), music: msg.musicLabel(snap.musicOn) } };
            });
            check(
                'ST12 тексты DOM = bridge = settingsMessages',
                JSON.stringify(m.dom.stats) === JSON.stringify(m.snap.stats) &&
                    JSON.stringify(m.dom.prestige) === JSON.stringify(m.snap.prestigeLines) &&
                    m.dom.sound === m.msg.sound &&
                    m.dom.music === m.msg.music &&
                    m.dom.volume === m.snap.volumeText &&
                    m.dom.button === m.snap.labels.prestige
            );
            await ctx.close();
        }

        // ---------- ST13: тач — тап, дрожание, свайп ----------
        {
            const { ctx, page } = await openSettings({ width: 390, height: 844 });
            const r = await rectOf(page, '[data-act="sound"]');
            const s0 = await readState(page);
            await page.touchscreen.tap(r.cx, r.cy);
            await page.waitForTimeout(120);
            const s1 = await readState(page);
            check('ST13a тач-тап: одно переключение', s1.soundOn === !s0.soundOn);

            const cdp = await ctx.newCDPSession(page);
            const send = async (type, x, y) =>
                cdp.send('Input.dispatchTouchEvent', {
                    type,
                    touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
                });
            await send('touchStart', r.cx, r.cy);
            await send('touchMove', r.cx + 5, r.cy + 3);
            await send('touchEnd');
            await page.waitForTimeout(120);
            const s2 = await readState(page);
            check('ST13b дрожание ≤10 px считается тапом', s2.soundOn === !s1.soundOn);

            const line = await rectOf(page, '[data-ref="prestige2"]');
            const s3before = await readState(page);
            await send('touchStart', line.cx, line.cy);
            await send('touchMove', line.cx + 60, line.cy - 40);
            await send('touchMove', line.cx + 140, line.cy - 90);
            await send('touchEnd');
            await page.waitForTimeout(120);
            const s3 = await readState(page);
            check(
                'ST13c свайп по форме не нажимает кнопки',
                s3.soundOn === s3before.soundOn && s3.musicOn === s3before.musicOn
            );
            await ctx.close();
        }

        // ---------- ST14: откат флагом ----------
        {
            const { ctx, page } = await openSettings({ legacy: true });
            const m = await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');

                return { flag: ui._settingsOpen, visible: ui.modal.visible, dom: !!window.__DOM_SETTINGS?.isOpen() };
            });
            check(
                'ST14 флаг отката: открывается Phaser-путь, DOM не открыт',
                m.flag && m.visible && !m.dom,
                JSON.stringify(m)
            );
            await ctx.close();
        }
    }
} finally {
    await browser.close();
}

check('консоль без ошибок', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n=== Итого${LEGACY ? ' (Phaser-путь)' : ''}: ${passed} OK, ${failed} FAIL ===`);
process.exitCode = failed ? 1 : 0;
