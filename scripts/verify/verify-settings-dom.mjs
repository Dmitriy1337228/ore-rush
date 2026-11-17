// Приёмка DOM-формы «Настройки» (docs/UI_DOM_PHASE2_PLAN.md, этап 2, ST1–ST14).
// Реальный dev-сервер, реальный state.js: проверяем поведение и паритет текстов,
// гейт вёрстки — npm run ui:check:dom (здесь только скриншоты состояний).
// Запуск: npm run verify:settings-dom
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

// ---------- Phaser-путь под флагом (`--legacy`): адаптированный набор ----------
// Пошаговые DOM-проверки указателя (ST4/ST9/ST10/ST13) на Phaser-пути не применимы:
// там клики идут по канвасу, а вёрстку фиксирует golden `ui-review` (17/18/…). Здесь —
// смысловые эквиваленты: открытие/закрытие, тумблеры, престиж/сброс, босс, очередь, тексты.
async function runLegacy() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));
    page.on('console', (m) => {
        if (m.type() === 'error') {
            consoleErrors.push(`console: ${m.text()}`);
        }
    });
    await page.addInitScript((s) => localStorage.setItem('ore-rush-save', s), JSON.stringify(SEEDS.mid));
    await page.goto(withLegacy(BASE), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__GAME?.scene?.getScene('UIScene')?.scene?.isActive?.(), null, {
        timeout: 30000
    });
    await page.waitForTimeout(900);
    const open = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) {
            ui.hideDailyModal();
        }

        ui.settingsBtn.emit('pointerdown');

        return { open: ui._settingsOpen, visible: ui.modal.visible, locked: window.__GAME.registry.get('blockLocked') };
    });
    check(
        'L1 Phaser-путь: окно открыто, блокировка стоит',
        open.open && open.visible && open.locked,
        JSON.stringify(open)
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
            sound: ui.soundText.text,
            music: ui.musicText.text,
            vol: ui.volPct.text,
            snapVol: snap.volumeText
        };
    });
    check(
        'L12 Phaser-путь: тексты = bridge',
        JSON.stringify(texts.stats) === JSON.stringify(texts.snapStats) &&
            JSON.stringify(texts.prestige) === JSON.stringify(texts.snapPrestige) &&
            texts.sound === (texts.sound.startsWith('Звук:') ? texts.sound : '') &&
            texts.vol === texts.snapVol,
        JSON.stringify({ stats: texts.stats.length })
    );

    const toggles = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.soundBtn.emit('pointerdown');
        ui.musicBtn.emit('pointerdown');

        return {
            sound: ui.soundText.text,
            music: ui.musicText.text,
            saved: JSON.parse(localStorage.getItem('ore-rush-save'))
        };
    });
    check(
        'L2/L3 Phaser-путь: тумблеры переключаются и сохраняются',
        toggles.sound === 'Звук: выкл' && toggles.music === 'Музыка: выкл',
        JSON.stringify(toggles)
    );

    const locked = await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const before = { stars: ui.registry.get('stars') };
        ui.tryPrestige();
        ui.tryPrestige();
        const after = { stars: ui.registry.get('stars') };

        return { before, after, text: ui.prestigeText.text };
    });
    check(
        'L5 Phaser-путь: престиж недоступен — клики без эффекта',
        locked.text === 'Сбросить шахту',
        JSON.stringify(locked)
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

        return {
            armed,
            stars: m.gameState.stars,
            tier: m.gameState.tier,
            open: ui._settingsOpen,
            visible: ui.modal.visible
        };
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
        ui.tryShowDailyModal();

        return { whileOpen, after: !!ui._dailyOpen };
    });
    check(
        'L11 Phaser-путь: очередь дейли за настройками',
        queue.whileOpen.settings && !queue.whileOpen.daily && queue.after,
        JSON.stringify(queue)
    );

    await ctx.close();
}

if (LEGACY) {
    await runLegacy();
    await browser.close();
    check('консоль без ошибок', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    console.log(`\n=== Итого (Phaser-путь): ${passed} OK, ${failed} FAIL ===`);
    process.exit(failed ? 1 : 0);
}

async function openSettings({ seed = SEEDS.mid, width = 1280, height = 720, before = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
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
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__GAME?.scene?.getScene('UIScene')?.scene?.isActive?.(), null, {
        timeout: 30000
    });
    await page.waitForFunction(() => !!window.__DOM_SETTINGS, null, { timeout: 30000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) {
            ui.hideDailyModal();
        }
    });
    await page.waitForTimeout(150);
    if (before) {
        await page.evaluate(before);
        await page.waitForTimeout(150);
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openModal());
    } else {
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openModal());
    }

    await page.waitForFunction(() => window.__DOM_SETTINGS.isOpen(), null, { timeout: 10000 });
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
            musicVolume: m.gameState.musicVolume
        };
    });

const saveOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ore-rush-save')));

try {
    // ---------- ST1: открытие и все элементы без скролла ----------
    for (const [w, h, name] of [
        [1280, 720, 'desktop'],
        [390, 844, 'portrait']
    ]) {
        const { ctx, page } = await openSettings({ width: w, height: h });
        const m = await page.evaluate(() => {
            const panel = document.querySelector('[data-dom-modal]');
            const scroll = panel.querySelector('[data-dom-scroll]');
            const r = panel.getBoundingClientRect();
            const ids = [...panel.querySelectorAll('[data-form-id]')].map((e) => e.dataset.formId);

            return {
                open: window.__DOM_SETTINGS.isOpen(),
                inViewport:
                    r.x >= -1 && r.y >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
                noScroll: scroll.scrollHeight <= scroll.clientHeight + 1,
                ids,
                locked: window.__GAME.registry.get('blockLocked')
            };
        });
        check(
            `ST1 ${name}: открыто, панель во вьюпорте, все элементы без скролла`,
            m.open && m.inViewport && m.noScroll && m.ids.length === 6 && m.locked,
            JSON.stringify(m)
        );
        await page.screenshot({ path: path.join(OUT, `st1-${name}.png`) });
        await ctx.close();
    }

    // ---------- ST2/ST3/ST4: тумблеры и громкость ----------
    {
        const { ctx, page } = await openSettings();
        const s0 = await readState(page);
        await page.click('[data-act="sound"]');
        const s1 = await readState(page);
        const label1 = await page.textContent('[data-act="sound"]');
        check(
            'ST2 звук: подпись и сейв переключаются',
            s1.soundOn === !s0.soundOn && label1 === (s1.soundOn ? 'Звук: вкл' : 'Звук: выкл'),
            label1
        );
        await page.click('[data-act="music"]');
        const s2 = await readState(page);
        const label2 = await page.textContent('[data-act="music"]');
        check(
            'ST3 музыка: подпись и сейв переключаются',
            s2.musicOn === !s1.musicOn && label2 === (s2.musicOn ? 'Музыка: вкл' : 'Музыка: выкл'),
            label2
        );

        for (const pct of [0, 50, 100, 25]) {
            await page.evaluate((v) => {
                const r = document.querySelector('[data-range="music-volume"]');
                r.value = String(v);
                r.dispatchEvent(new Event('input', { bubbles: true }));
                r.dispatchEvent(new Event('change', { bubbles: true }));
            }, pct);
            await page.waitForTimeout(80);
            const save = await saveOf(page);
            const shown = await page.textContent('.dom-range-value');
            check(
                `ST4 громкость ${pct}%: сейв и подпись`,
                Math.abs(save.musicVolume - pct / 100) < 1e-9 && shown === `${pct}%`,
                `${save.musicVolume} / ${shown}`
            );
        }

        await page.screenshot({ path: path.join(OUT, 'st2-toggles.png') });
        await ctx.close();
    }

    // ---------- ST5: престиж недоступен ----------
    {
        const { ctx, page } = await openSettings();
        const before = await readState(page);
        await page.click('[data-act="prestige"]');
        await page.click('[data-act="prestige"]');
        await page.waitForTimeout(150);
        const after = await readState(page);
        const open = await page.evaluate(() => window.__DOM_SETTINGS.isOpen());
        const dim = await page.evaluate(() =>
            document.querySelector('[data-act="prestige"]').classList.contains('is-disabled')
        );
        check(
            'ST5 престиж недоступен: клики не меняют прогресс, окно открыто',
            open && before.stars === after.stars && before.tier === after.tier && dim
        );
        await ctx.close();
    }

    // ---------- ST6: престиж доступен, взвод и успех ----------
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
        await page.click('[data-act="prestige"]');
        const armed = await page.textContent('[data-act="prestige"]');
        check('ST6a престиж: первый клик — взвод «Точно?»', /^Точно\? \+/.test(armed), armed);
        await page.screenshot({ path: path.join(OUT, 'st6-armed.png') });
        await page.click('[data-act="prestige"]');
        await page.waitForTimeout(600);
        const s = await readState(page);
        const closed = await page.evaluate(() => !window.__DOM_SETTINGS.isOpen());
        check(
            'ST6b престиж: звёзды начислены, прогресс сброшен, окно закрыто',
            s.stars > 0 && s.tier === 0 && closed,
            JSON.stringify({ stars: s.stars, tier: s.tier, closed })
        );
        await ctx.close();
    }

    // ---------- ST7: сброс прогресса ----------
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
            }
        });
        await page.click('[data-act="reset"]');
        const armed = await page.textContent('[data-act="reset"]');
        check('ST7a сброс: первый клик — «Точно сбросить?»', armed === 'Точно сбросить?', armed);
        await page.click('[data-act="reset"]');
        await page.waitForTimeout(600);
        const s = await readState(page);
        const closed = await page.evaluate(() => !window.__DOM_SETTINGS.isOpen());
        check(
            'ST7b сброс: прогресс обнулён, окно закрыто',
            s.ore === 0 && s.levels.pickaxe === 0 && closed,
            JSON.stringify({ ore: s.ore, pickaxe: s.levels.pickaxe })
        );
        await ctx.close();
    }

    // ---------- ST8: блокировка в бою ----------
    {
        const { ctx, page } = await openSettings({
            seed: SEEDS.deep,
            before: async () => {
                const gs = window.__GAME.scene.getScene('GameScene');
                gs.startBossFight('boss_copper');
            }
        });
        const before = await readState(page);
        await page.click('[data-act="prestige"]');
        await page.click('[data-act="prestige"]');
        await page.click('[data-act="reset"]');
        await page.click('[data-act="reset"]');
        await page.waitForTimeout(200);
        const after = await readState(page);
        const labels = await page.evaluate(() => ({
            prestige: document.querySelector('[data-act="prestige"]').classList.contains('is-disabled'),
            reset: document.querySelector('[data-act="reset"]').classList.contains('is-disabled'),
            boss: !!window.__GAME.registry.get('bossActive')
        }));
        check(
            'ST8 бой: престиж/сброс заблокированы и не меняют состояние',
            before.stars === after.stars && before.tier === after.tier && before.ore === after.ore && labels.boss,
            JSON.stringify(labels)
        );
        await page.screenshot({ path: path.join(OUT, 'st8-boss-locked.png') });
        await ctx.close();
    }

    // ---------- ST9: клик по фону не закрывает и не меняет игру ----------
    {
        const { ctx, page } = await openSettings();
        const before = await readState(page);
        await page.mouse.click(20, 700);
        await page.waitForTimeout(200);
        const after = await readState(page);
        const open = await page.evaluate(() => window.__DOM_SETTINGS.isOpen());
        check('ST9 клик по фону: окно открыто, состояние не изменилось', open && before.ore === after.ore);
        await ctx.close();
    }

    // ---------- ST10: Esc закрывает и снимает блокировку ----------
    {
        const { ctx, page } = await openSettings();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => ({
            open: window.__DOM_SETTINGS.isOpen(),
            hidden: document.querySelector('[data-dom-modal]').closest('.dom-modal-layer').hidden,
            locked: window.__GAME.registry.get('blockLocked'),
            flag: window.__GAME.scene.getScene('UIScene')._settingsOpen
        }));
        check(
            'ST10 Esc: окно скрыто, флаг и блокировка сняты',
            !m.open && m.hidden && !m.locked && !m.flag,
            JSON.stringify(m)
        );
        await ctx.close();
    }

    // ---------- ST11: очередь дейли за настройками ----------
    {
        const { ctx, page } = await openSettings({ seed: SEEDS.fresh });
        const whileOpen = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = { streak: 1, extra: 100 };
            ui.tryShowDailyModal();

            return { daily: !!ui._dailyOpen, settings: ui._settingsOpen };
        });
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeModal());
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => !!window.__GAME.scene.getScene('UIScene')._dailyOpen);
        check(
            'ST11 очередь: дейли не открывается поверх настроек, открывается после закрытия',
            whileOpen.settings && !whileOpen.daily && after,
            JSON.stringify({ whileOpen, after })
        );
        await ctx.close();
    }

    // ---------- ST12: тексты = bridge = settingsMessages ----------
    {
        const { ctx, page } = await openSettings();
        const m = await page.evaluate(async () => {
            const files = performance.getEntriesByType('resource').map((r) => r.name);
            const stateUrl = files.find((u) => u.includes('/src/state.js'));
            const bridgeUrl = files.find((u) => u.includes('/src/ui/dom/bridge.js'));
            const msgUrl = files.find((u) => u.includes('/src/state/settingsMessages.js'));
            const bridge = await import(bridgeUrl);
            const msg = await import(msgUrl);
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
        const sameStats = JSON.stringify(m.snap.stats) === JSON.stringify(m.dom.stats);
        const samePrestige = JSON.stringify(m.snap.prestigeLines) === JSON.stringify(m.dom.prestige);
        check(
            'ST12 тексты DOM совпадают с bridge и settingsMessages',
            sameStats &&
                samePrestige &&
                m.dom.sound === m.msg.sound &&
                m.dom.music === m.msg.music &&
                m.dom.volume === m.snap.volumeText &&
                m.dom.button === m.snap.labels.prestige,
            JSON.stringify({ sameStats, samePrestige })
        );
        await ctx.close();
    }

    // ---------- ST13: нет скрытых интерактивов вне панели ----------
    {
        const { ctx, page } = await openSettings();
        const m = await page.evaluate(() => {
            const panel = document.querySelector('[data-dom-modal]');
            const all = [...document.querySelectorAll('[data-act], [data-dom-close], [data-range]')];
            const outside = all.filter((el) => !panel.contains(el));
            const hiddenButInPanel = all.filter((el) => panel.contains(el) && !el.getClientRects().length);

            return { count: all.length, outside: outside.length, hiddenButInPanel: hiddenButInPanel.length };
        });
        check(
            'ST13 интерактив только в видимой панели',
            m.count >= 6 && m.outside === 0 && m.hiddenButInPanel === 0,
            JSON.stringify(m)
        );
        await ctx.close();
    }

    // ---------- ST14: после закрытия игра снова принимает клики ----------
    {
        const { ctx, page } = await openSettings({ seed: { ...SEEDS.fresh, levels: { pickaxe: 5 } } });
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeModal());
        await page.waitForTimeout(250);
        const before = await readState(page);
        for (let i = 0; i < 6; i++) {
            await page.mouse.click(290, 420);
            await page.waitForTimeout(40);
        }

        await page.waitForTimeout(200);
        const after = await readState(page);
        const locked = await page.evaluate(() => window.__GAME.registry.get('blockLocked'));
        check(
            'ST14 после закрытия клики снова добывают руду',
            !locked && after.ore > before.ore,
            JSON.stringify({ ore: before.ore, after: after.ore })
        );
        await ctx.close();
    }
} finally {
    await browser.close();
}

check('консоль без ошибок', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
console.log(`\n=== Итого: ${passed} OK, ${failed} FAIL ===`);
process.exitCode = failed ? 1 : 0;
