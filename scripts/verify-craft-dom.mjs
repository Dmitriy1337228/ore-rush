// Приёмка DOM-мастерской (этап 2, каркас). Проверяет:
//   открытие/закрытие (вызов, крестик, Esc, фон), блокировку игры под панелью,
//   содержимое из моста (чипы/3 списка), D3 (Phaser-оверлеи не под DOM),
//   переключение флага D5 (без флага — прежняя Phaser-мастерская).
//
// Запуск: node scripts/verify-craft-dom.mjs [--out shots/pilot-gates]
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
const BASE = process.env.BASE_URL || 'http://localhost:5174';
fs.mkdirSync(OUT, { recursive: true });

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
const results = [];

async function openPage({ dom }) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        if (!s.domUi) localStorage.removeItem('domUi');
    }, { [SAVE_KEY]: JSON.stringify(SEEDS.mid), ...(dom ? { domUi: '1' } : {}) });
    await page.goto(`${BASE}${dom ? '/?dom=1' : '/'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
        const ui = window.__GAME && window.__GAME.scene.getScene('UIScene');
        return !!(ui && ui.L);
    }, null, { timeout: 30000 });
    if (dom) await page.waitForFunction(() => !!window.__DOM_CRAFT, null, { timeout: 30000 });
    await page.waitForTimeout(1250);
    // Сейв mid может принести отложенную ежедневную награду (delayedCall 900 мс) —
    // убираем её из очереди, чтобы сценарии начинались с чистого экрана.
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) ui.hideDailyModal();
        if (ui._offlineOpen) ui.hideOfflineModal();
        if (ui._settingsOpen && ui.closeModal) ui.closeModal();
        if (ui._mapOpen) ui.closeMap();
        if (ui._bossRewardOpen && ui.hideBossRewardModal) ui.hideBossRewardModal();
        if (ui._playerDownOpen) ui.hidePlayerDownModal();
    });
    await page.waitForTimeout(250);
    // Нулевая пассивная добыча: иначе руда растёт сама и проверка «клик не прошёл»
    // неотличима от обычного дохода (тестовая мутация состояния, только в прогоне).
    await page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        for (const id of Object.keys(m.gameState.levels)) m.gameState.levels[id] = 0;
    });
    await page.waitForTimeout(150);
    return { ctx, page, errors };
}

const check = (name, ok, details = {}) => {
    results.push({ name, ok, ...details });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${details.note ? ' — ' + details.note : ''}`);
};

// ---- С флагом D5: DOM-мастерская ----
{
    const { ctx, page, errors } = await openPage({ dom: true });
    await page.evaluate(() => {
        window.__CANVAS_PD = 0;
        document.querySelector('#game canvas').addEventListener('pointerdown', () => window.__CANVAS_PD++);
    });

    const ore = () => page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        return m.gameState.ore;
    });

    // 1) открытие и содержимое
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForTimeout(300);
    const content = await page.evaluate(() => ({
        open: window.__DOM_CRAFT.isOpen(),
        panelVisible: !document.querySelector('[data-dom-panel]').hidden,
        chips: document.querySelectorAll('[data-dom-chips] .dom-chip').length,
        items: document.querySelectorAll('[data-dom-list="items"] [data-row]').length,
        recipes: document.querySelectorAll('[data-dom-list="recipes"] [data-row]').length,
        artifacts: document.querySelectorAll('[data-dom-list="artifacts"] [data-art]').length,
        craftBlocked: window.__GAME.registry.get('blockLocked')
    }));
    check('D5: DOM-панель открывается', content.open && content.panelVisible, content);
    check('D5: данные моста в трёх списках', content.chips === 5 && content.items === 7 && content.recipes === 10 && content.artifacts === 9, content);

    // 2) под панелью игра заблокирована
    const oreBefore = await ore();
    await page.mouse.click(640, 360); // центр панели
    await page.waitForTimeout(200);
    const during = await page.evaluate(() => ({ open: window.__DOM_CRAFT.isOpen(), pd: window.__CANVAS_PD }));
    const oreDuring = await ore();
    check('блокировка: клик по панели не доходит до канваса', during.pd === 0 && oreDuring === oreBefore && during.open, { pd: during.pd, oreBefore, oreDuring });

    // 3) фон закрывает и не пропускает клик в игру
    await page.mouse.click(20, 20);
    await page.waitForTimeout(200);
    const afterBackdrop = await page.evaluate(() => ({ open: window.__DOM_CRAFT.isOpen(), pd: window.__CANVAS_PD, locked: window.__GAME.registry.get('blockLocked') }));
    check('закрытие по фону', !afterBackdrop.open, afterBackdrop);

    // 4) Esc и крестик
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('закрытие по Esc', await page.evaluate(() => !window.__DOM_CRAFT.isOpen()));

    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForTimeout(150);
    await page.locator('.dom-close').click();
    await page.waitForTimeout(150);
    check('закрытие крестиком', await page.evaluate(() => !window.__DOM_CRAFT.isOpen()));

    // 5) HUD-кнопка «Крафт» открывает именно DOM-экран
    await page.evaluate(() => window.__DOM_CRAFT.close({ notify: false }));
    await page.waitForTimeout(200);
    const craftBtn = await page.evaluate(() => {
        const b = window.__GAME.scene.getScene('UIScene').craftBtn.getBounds();
        return { x: Math.round(b.centerX), y: Math.round(b.centerY) };
    });
    await page.mouse.click(craftBtn.x, craftBtn.y);
    await page.waitForTimeout(350);
    const hudOpened = await page.evaluate(() => window.__DOM_CRAFT.isOpen());
    check('HUD-кнопка «Крафт» открывает DOM-экран', hudOpened, craftBtn);
    await page.evaluate(() => window.__DOM_CRAFT.close({ notify: false }));
    await page.waitForTimeout(200);

    // 6) после закрытия клики снова доходят, руда растёт
    await page.evaluate(() => { window.__CANVAS_PD = 0; window.__DOM_CRAFT.close({ notify: false }); });
    const orePassBefore = await ore();
    for (let i = 0; i < 3; i++) { await page.mouse.click(400, 390); await page.waitForTimeout(100); }
    const orePassAfter = await ore();
    const passPd = await page.evaluate(() => window.__CANVAS_PD);
    check('после закрытия клик по шахте добывает', orePassAfter > orePassBefore && passPd >= 3, { orePassBefore, orePassAfter, passPd });

    // 6) D3: каждый Phaser-оверлей закрывает DOM и виден сам
    const overlays = [
        ['daily', `ui._pendingDaily = { streak: 3, extra: 1200 }; ui.tryShowDailyModal();`, 'ui.hideDailyModal()'],
        ['boss-reward', `ui.showBossRewardModal({ bounty: 100, comps: { scrap: 2 } });`, `ui.hideBossRewardModal ? ui.hideBossRewardModal() : (ui._bossRewardOpen = false, ui.bossRewardDim.setVisible(false), ui.bossRewardModal.setVisible(false))`],
        ['player-down', `ui.showPlayerDownModal({ bossName: 'Медный страж', dmg: 1000, maxPlayer: 5000 });`, 'ui.hidePlayerDownModal()']
    ];
    for (const [name, openCode, closeCode] of overlays) {
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
        await page.waitForTimeout(150);
        await page.evaluate(`(() => { const ui = window.__GAME.scene.getScene('UIScene'); ${openCode} })()`);
        await page.waitForTimeout(350);
        const st = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const top = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
            return {
                domOpen: window.__DOM_CRAFT.isOpen(),
                daily: ui._dailyOpen, bossReward: ui._bossRewardOpen, playerDown: ui._playerDownOpen,
                topIsDom: !!(top && top.closest('#ui-root'))
            };
        });
        const flag = name === 'daily' ? st.daily : name === 'boss-reward' ? st.bossReward : st.playerDown;
        check(`D3: ${name} закрывает DOM и виден`, !st.domOpen && flag && !st.topIsDom, st);
        await page.evaluate(`(() => { const ui = window.__GAME.scene.getScene('UIScene'); ${closeCode} })()`);
        await page.waitForTimeout(200);
    }

    check('нет console/pageerror (DOM-режим)', errors.length === 0, { errors: errors.slice(0, 5) });
    await page.screenshot({ path: path.join(OUT, 'verify-dom-craft.png') });
    await ctx.close();
}

// ---- Без флага: прежняя Phaser-мастерская ----
{
    const { ctx, page, errors } = await openPage({ dom: false });
    const st = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui.openCraft();
        return {
            hasDomCraft: !!ui.domCraft,
            craftOpen: !!ui._craftOpen,
            rootVisible: !!(ui.craftRoot && ui.craftRoot.visible),
            domRoot: !!document.getElementById('ui-root')
        };
    });
    check('D5 off: открывается Phaser-мастерская', !st.hasDomCraft && st.craftOpen && st.rootVisible && !st.domRoot, st);
    check('нет console/pageerror (Phaser-режим)', errors.length === 0, { errors: errors.slice(0, 5) });
    await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'verify-craft-dom.json'), JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`\n=== ${results.length - failed.length}/${results.length} проверок ok ===`);
process.exitCode = failed.length ? 1 : 0;
