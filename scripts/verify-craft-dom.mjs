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
import { MSG } from '../src/state/craftMessages.js';

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
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
            if (!s.domUi) localStorage.removeItem('domUi');
        },
        { [SAVE_KEY]: JSON.stringify(SEEDS.mid), ...(dom ? { domUi: '1' } : {}) }
    );
    await page.goto(`${BASE}${dom ? '/?dom=1' : '/'}`, { waitUntil: 'load' });
    await page.waitForFunction(
        () => {
            const ui = window.__GAME && window.__GAME.scene.getScene('UIScene');
            return !!(ui && ui.L);
        },
        null,
        { timeout: 30000 }
    );
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
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
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

    const ore = () =>
        page.evaluate(async () => {
            const url = performance
                .getEntriesByType('resource')
                .map((r) => r.name)
                .find((u) => u.includes('/src/state.js'));
            const m = await import(url);
            return m.gameState.ore;
        });

    // Состояние доступно сценариям S1–S10; мутации — только в тесте.
    await page.evaluate(async () => {
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        window.__ST = await import(url);
    });
    const st = (code) =>
        page.evaluate((c) => {
            const m = window.__ST;
            // eslint-disable-next-line no-eval
            return eval(c);
        }, code);
    const wait = (ms = 350) => page.waitForTimeout(ms);
    const rowText = (id) => page.locator(`[data-row="${id}"]`).innerText();
    const clickIn = async (id, act) => {
        await page.locator(`[data-row="${id}"] [data-act="${act}"]`).click();
        await wait();
    };
    const openCraft = async () => {
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
        await wait(250);
    };
    const closeCraft = async () => {
        await page.evaluate(() => window.__DOM_CRAFT.close({ notify: false }));
        await wait(150);
    };

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
    check(
        'D5: данные моста в трёх списках',
        content.chips === 5 && content.items === 7 && content.recipes === 10 && content.artifacts === 9,
        content
    );

    // 2) под панелью игра заблокирована
    const oreBefore = await ore();
    await page.mouse.click(640, 360); // центр панели
    await page.waitForTimeout(200);
    const during = await page.evaluate(() => ({ open: window.__DOM_CRAFT.isOpen(), pd: window.__CANVAS_PD }));
    const oreDuring = await ore();
    check(
        'блокировка: клик по панели не доходит до канваса',
        during.pd === 0 && oreDuring === oreBefore && during.open,
        { pd: during.pd, oreBefore, oreDuring }
    );

    // 3) фон закрывает и не пропускает клик в игру
    await page.mouse.click(20, 20);
    await page.waitForTimeout(200);
    const afterBackdrop = await page.evaluate(() => ({
        open: window.__DOM_CRAFT.isOpen(),
        pd: window.__CANVAS_PD,
        locked: window.__GAME.registry.get('blockLocked')
    }));
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
    await page.evaluate(() => {
        window.__CANVAS_PD = 0;
        window.__DOM_CRAFT.close({ notify: false });
    });
    const orePassBefore = await ore();
    for (let i = 0; i < 3; i++) {
        await page.mouse.click(400, 390);
        await page.waitForTimeout(100);
    }
    const orePassAfter = await ore();
    const passPd = await page.evaluate(() => window.__CANVAS_PD);
    check('после закрытия клик по шахте добывает', orePassAfter > orePassBefore && passPd >= 3, {
        orePassBefore,
        orePassAfter,
        passPd
    });

    // ---------- Сценарии приёмки S1–S10 (этап 3) ----------
    await openCraft();

    // S1. Покупка: нехватка руды / успех / полный стак
    await st('m.gameState.ore = 0; m.gameState.items.item_bomb = 0;');
    await wait();
    await clickIn('item_bomb', 'buy');
    let s1 = await st('({ ore: m.gameState.ore, stock: m.gameState.items.item_bomb || 0 })');
    check('S1: нехватка руды', (await rowText('item_bomb')).includes(MSG.noOre) && s1.stock === 0 && s1.ore === 0, s1);

    const price = await st("m.getItemPrice('item_bomb')");
    await st('m.gameState.ore = 1e6; m.gameState.items.item_bomb = 0;');
    await wait();
    await clickIn('item_bomb', 'buy');
    s1 = await st('({ ore: m.gameState.ore, stock: m.gameState.items.item_bomb || 0 })');
    check('S1: покупка списывает цену', s1.stock === 1 && s1.ore === 1e6 - price, { price, ...s1 });

    await st('m.gameState.items.item_bomb = 5;');
    await wait();
    await clickIn('item_bomb', 'buy');
    s1 = await st('({ stock: m.gameState.items.item_bomb || 0 })');
    check('S1: полный стак', (await rowText('item_bomb')).includes(MSG.stackFull) && s1.stock === 5, s1);

    // S2. Активация: вне боя / успех / баф активен / нет предмета
    await st('m.gameState.items.item_bomb = 2; m.gameState.bossBuffUntil = 0;');
    await wait();
    await clickIn('item_bomb', 'use');
    check('S2: боевой предмет вне боя', (await rowText('item_bomb')).includes(MSG.bossOnly));

    await st('m.gameState.items.item_belt = 2; m.gameState.miningBuffUntil = 0;');
    await wait();
    await clickIn('item_belt', 'use');
    let s2 = await st('({ stock: m.gameState.items.item_belt, left: m.gameState.miningBuffUntil - Date.now() })');
    check('S2: активация успешна', s2.stock === 1 && s2.left > 0, s2);

    await clickIn('item_belt', 'use');
    check('S2: баф активен', (await rowText('item_belt')).includes(MSG.buffActive));

    await st('m.gameState.items.item_belt = 0; m.gameState.miningBuffUntil = 0;');
    await wait();
    await clickIn('item_belt', 'use');
    check('S2: нет предмета', (await rowText('item_belt')).includes(MSG.noItem));

    // S3. Мгновенный рецепт
    await st(
        'm.gameState.items.item_bomb = 0; m.gameState.components.scrap = 10; m.gameState.components.crystal = 100; m.gameState.components.core = 100;'
    );
    await wait();
    await clickIn('r_bomb', 'craft');
    let s3 = await st('({ scrap: m.gameState.components.scrap, bomb: m.gameState.items.item_bomb || 0 })');
    check('S3: рецепт создан', s3.scrap === 6 && s3.bomb === 2, s3);

    await st('m.gameState.components.scrap = 0;');
    await wait();
    const rBombDisabled = await page.locator('[data-row="r_bomb"] [data-act="craft"]').isDisabled();
    check('S3: без компонентов кнопка неактивна', rBombDisabled);

    // S4. Рецепт с таймером: запуск, занятость верстака, выдача
    await st(
        'm.gameState.components.crystal = 10; m.gameState.components.core = 10; m.gameState.components.essence = 10;'
    );
    await wait();
    await clickIn('r_hardpick', 'craft');
    let s4 = await st('({ id: m.gameState.crafting && m.gameState.crafting.recipeId })');
    const hpLabel = await page.locator('[data-row="r_hardpick"] .dom-btn-craft').innerText();
    check('S4: рецепт запущен', s4.id === 'r_hardpick' && /\d+:\d\d/.test(hpLabel), { ...s4, hpLabel });

    const batteryDisabled = await page.locator('[data-row="r_battery"] [data-act="craft"]').isDisabled();
    check('S4: верстак занят', batteryDisabled && (await rowText('r_battery')).includes(MSG.benchBusy));

    await st('m.gameState.crafting.endsAt = Date.now() - 1000;');
    await wait(500);
    const claimLabel = await page.locator('[data-row="r_hardpick"] .dom-btn-craft').innerText();
    const claimEnabled = !(await page.locator('[data-row="r_hardpick"] .dom-btn-craft').isDisabled());
    check('S4: готово к выдаче', claimLabel === 'Забрать' && claimEnabled, { claimLabel });

    await clickIn('r_hardpick', 'claim');
    s4 = await st("({ crafting: m.gameState.crafting, owned: m.gameState.artifacts.includes('art_hardpick') })");
    check('S4: артефакт забран', s4.crafting === null && s4.owned, s4);

    // S5. Повторный артефактный крафт запрещён
    const hpDisabled = await page.locator('[data-row="r_hardpick"] .dom-btn-craft').isDisabled();
    check('S5: повторный крафт запрещён', hpDisabled && (await rowText('r_hardpick')).includes(MSG.owned));

    // S6. Подсказка артефакта по тапу, исчезает через 2 с
    await page.locator('[data-art="art_magnet_ring"]').click();
    await wait(250);
    check(
        'S6: подсказка по тапу',
        (await page.locator('[data-art="art_magnet_ring"]').innerText()).includes('Получишь у босса')
    );
    await wait(2300);
    check('S6: подсказка исчезла', (await page.locator('[data-art="art_magnet_ring"]').innerText()).includes('Босс:'));

    // S7. Ресайз/ориентация при открытой мастерской
    await page.evaluate(() => {
        document.querySelector('[data-dom-scroll]').scrollTop = 200;
    });
    await wait(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await wait(700);
    let s7 = await page.evaluate(() => ({
        open: window.__DOM_CRAFT.isOpen(),
        cls: document.getElementById('ui-root').className,
        top: document.querySelector('[data-dom-scroll]').scrollTop
    }));
    check('S7: портрет сохраняет скролл', s7.open && /portrait/.test(s7.cls) && s7.top > 0, s7);

    await page.setViewportSize({ width: 1280, height: 720 });
    await wait(700);
    s7 = await page.evaluate(() => ({
        open: window.__DOM_CRAFT.isOpen(),
        cls: document.getElementById('ui-root').className,
        top: document.querySelector('[data-dom-scroll]').scrollTop
    }));
    check('S7: ландшафт сохраняет скролл', s7.open && /landscape/.test(s7.cls) && s7.top > 0, s7);

    // S8. Закрытие во время тика: без ошибок и дублей
    await st("m.gameState.crafting = { recipeId: 'r_battery', endsAt: Date.now() + 600000 };");
    await wait();
    await page.keyboard.press('Escape');
    await wait(250);
    const errsBefore = errors.length;
    for (let i = 0; i < 5; i++) {
        await openCraft();
        await closeCraft();
    }
    const s8 = await page.evaluate(() => ({
        panels: document.querySelectorAll('[data-dom-panel]').length,
        roots: document.querySelectorAll('#ui-root').length
    }));
    check(
        'S8: тик при закрытии без ошибок и дублей',
        s8.panels === 1 && s8.roots === 1 && errors.length === errsBefore,
        s8
    );

    // S9. Бой при открытой мастерской: боевые предметы доступны, блокировка держится
    await st('m.gameState.items.item_bomb = 3; m.gameState.bossBuffUntil = 0;');
    await page.evaluate(() => window.__GAME.registry.set('bossActive', true));
    await openCraft();
    const bombDim = await page
        .locator('[data-row="item_bomb"] [data-act="use"]')
        .evaluate((el) => el.classList.contains('is-disabled'));
    await clickIn('item_bomb', 'use');
    const s9 = await st('({ stock: m.gameState.items.item_bomb, left: m.gameState.bossBuffUntil - Date.now() })');
    const lockedInCraft = await page.evaluate(() => !!window.__GAME.registry.get('blockLocked'));
    check('S9: боевой предмет в бою доступен', !bombDim && s9.stock === 2 && s9.left > 0 && lockedInCraft, {
        ...s9,
        bombDim,
        lockedInCraft
    });
    await page.evaluate(() => window.__GAME.registry.set('bossActive', false));

    // S10. Паритет данных: DOM-ряды = снимок моста
    await st('m.gameState.bossBuffUntil = 0; m.gameState.miningBuffUntil = 0; m.gameState.itemVeinUntil = 0;');
    await wait(600);
    const parity = await page.evaluate(async () => {
        const bridge = await import(new URL('src/dom/bridge.js', document.baseURI).href);
        const snap = bridge.snapshot({ bossActive: false });
        const text = (el) => (el ? el.textContent.trim() : null);
        const mism = [];
        const counts = {
            items: document.querySelectorAll('[data-dom-list="items"] [data-row]').length,
            recipes: document.querySelectorAll('[data-dom-list="recipes"] [data-row]').length,
            artifacts: document.querySelectorAll('[data-dom-list="artifacts"] [data-art]').length
        };
        if (counts.items !== snap.items.length) mism.push(`items ${counts.items}/${snap.items.length}`);
        if (counts.recipes !== snap.recipes.length) mism.push(`recipes ${counts.recipes}/${snap.recipes.length}`);
        if (counts.artifacts !== snap.artifacts.length)
            mism.push(`artifacts ${counts.artifacts}/${snap.artifacts.length}`);
        for (const it of snap.items) {
            const row = document.querySelector(`[data-row="${it.id}"]`);
            if (!row) {
                mism.push(`нет ряда ${it.id}`);
                continue;
            }
            if (text(row.querySelector('.dom-name')) !== it.name) mism.push(`имя ${it.id}`);
            const hint = row.querySelector('.dom-error') || row.querySelector('.dom-stock');
            if (text(hint) !== it.hint) mism.push(`hint ${it.id}: ${text(hint)} != ${it.hint}`);
        }
        for (const r of snap.recipes) {
            const row = document.querySelector(`[data-row="${r.id}"]`);
            if (!row) {
                mism.push(`нет рецепта ${r.id}`);
                continue;
            }
            if (text(row.querySelector('.dom-name')) !== r.name) mism.push(`имя рецепта ${r.id}`);
            const status = text(row.querySelector('.dom-status')) || '';
            if (status !== r.status) mism.push(`статус ${r.id}: "${status}" != "${r.status}"`);
            if (!(r.mine && !r.ready)) {
                const lbl = text(row.querySelector('.dom-btn-craft'));
                if (lbl !== r.button) mism.push(`кнопка ${r.id}: "${lbl}" != "${r.button}"`);
            }
        }
        for (const a of snap.artifacts) {
            const row = document.querySelector(`[data-art="${a.id}"]`);
            if (!row) {
                mism.push(`нет артефакта ${a.id}`);
                continue;
            }
            if (text(row.querySelector('.dom-name')) !== a.name) mism.push(`имя артефакта ${a.id}`);
            if (text(row.querySelector('.dom-line') || row.querySelector('.dom-error')) !== a.line)
                mism.push(`строка ${a.id}`);
        }
        return { mism, counts };
    });
    check('S10: паритет DOM и данных', parity.mism.length === 0, parity);
    await closeCraft();

    // 4.4. Реклама/фуллскрин Яндекса: панель скрывается и восстанавливается
    await openCraft();
    await page.evaluate(() => window.__GAME.events.emit('yandex-ad-open'));
    await wait(250);
    const adOpen = await page.evaluate(() => ({
        open: window.__DOM_CRAFT.isOpen(),
        sceneOpen: window.__GAME.scene.getScene('UIScene')._craftOpen
    }));
    await page.evaluate(() => window.__GAME.events.emit('yandex-ad-close'));
    await wait(400);
    const adClosed = await page.evaluate(() => {
        const root = document.getElementById('ui-root').getBoundingClientRect();
        const canvas = document.querySelector('#game canvas').getBoundingClientRect();
        return {
            open: window.__DOM_CRAFT.isOpen(),
            sceneOpen: window.__GAME.scene.getScene('UIScene')._craftOpen,
            root: [root.left, root.top, root.width, root.height],
            canvas: [canvas.left, canvas.top, canvas.width, canvas.height]
        };
    });
    const rectOk = adClosed.root.every((v, i) => Math.abs(v - adClosed.canvas[i]) <= 1.5);
    check(
        '4.4 реклама: DOM скрыт и восстановлен',
        !adOpen.open && !adOpen.sceneOpen && adClosed.open && adClosed.sceneOpen && rectOk,
        { adOpen, adClosed }
    );
    await closeCraft();

    // 6) D3: каждый Phaser-оверлей закрывает DOM и виден сам
    const overlays = [
        ['daily', `ui._pendingDaily = { streak: 3, extra: 1200 }; ui.tryShowDailyModal();`, 'ui.hideDailyModal()'],
        [
            'boss-reward',
            `ui.showBossRewardModal({ bounty: 100, comps: { scrap: 2 } });`,
            `ui.hideBossRewardModal ? ui.hideBossRewardModal() : (ui._bossRewardOpen = false, ui.bossRewardDim.setVisible(false), ui.bossRewardModal.setVisible(false))`
        ],
        [
            'player-down',
            `ui.showPlayerDownModal({ bossName: 'Медный страж', dmg: 1000, maxPlayer: 5000 });`,
            'ui.hidePlayerDownModal()'
        ]
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
                daily: ui._dailyOpen,
                bossReward: ui._bossRewardOpen,
                playerDown: ui._playerDownOpen,
                topIsDom: !!(top && top.closest('#ui-root'))
            };
        });
        const flag = name === 'daily' ? st.daily : name === 'boss-reward' ? st.bossReward : st.playerDown;
        if (name === 'daily') {
            // Дневная награда НЕ вытесняет мастерскую (очередь, как в Phaser):
            // копится до закрытия; проверяем оба состояния
            check('D3: daily ждёт закрытия DOM', st.domOpen && !st.daily, st);
            await page.evaluate(() => window.__DOM_CRAFT.close());
            await wait(450);
            const after = await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');
                const top = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
                return {
                    domOpen: window.__DOM_CRAFT.isOpen(),
                    daily: ui._dailyOpen,
                    topIsDom: !!(top && top.closest('#ui-root'))
                };
            });
            check('D3: daily показана после закрытия DOM', !after.domOpen && after.daily && !after.topIsDom, after);
            await page.evaluate(`(() => { const ui = window.__GAME.scene.getScene('UIScene'); ${closeCode} })()`);
            await page.waitForTimeout(200);
            continue;
        }
        check(`D3: ${name} закрывает DOM и виден`, !st.domOpen && flag && !st.topIsDom, st);
        await page.evaluate(`(() => { const ui = window.__GAME.scene.getScene('UIScene'); ${closeCode} })()`);
        await page.waitForTimeout(200);
    }

    check('нет console/pageerror (DOM-режим)', errors.length === 0, { errors: errors.slice(0, 5) });
    await page.screenshot({ path: path.join(OUT, 'verify-dom-craft.png') });
    await ctx.close();
}

// ---- Этап 4.2: тач (тап, дрожание ≤10 CSS px, прокрутка без ложных нажатий) ----
{
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        },
        { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' }
    );
    await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__DOM_CRAFT, null, { timeout: 30000 });
    await page.waitForTimeout(1250);
    await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) ui.hideDailyModal();
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        window.__ST = await import(url);
        for (const id of Object.keys(window.__ST.gameState.levels)) window.__ST.gameState.levels[id] = 0;
        window.__ST.gameState.ore = 1e6;
        window.__ST.gameState.items.item_bomb = 0;
    });
    await page.waitForTimeout(350); // блокировка снимется в следующем кадре
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForFunction(() => window.__DOM_CRAFT.isOpen(), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const st = (code) =>
        page.evaluate((c) => {
            const m = window.__ST;
            return eval(c);
        }, code);
    const wait = (ms = 400) => page.waitForTimeout(ms);

    const buyBtn = page.locator('[data-row="item_bomb"] [data-act="buy"]');
    await buyBtn.scrollIntoViewIfNeeded();
    const style = await buyBtn.evaluate((el) => ({
        touch: getComputedStyle(el).touchAction,
        tap: getComputedStyle(el).webkitTapHighlightColor
    }));
    const box = await buyBtn.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await wait(500);
    let stock = await st('m.gameState.items.item_bomb || 0');
    check('4.2 тап покупает предмет', stock === 1, { stock, ...style });

    // Дрожание пальца: смещение 8x3 CSS px — это тап, а не скролл
    await st('m.gameState.items.item_bomb = 0; m.gameState.ore = 1e6;');
    await wait(400);
    await buyBtn.scrollIntoViewIfNeeded();
    const b2 = await buyBtn.boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const x = Math.round(b2.x + b2.width / 2);
    const y = Math.round(b2.y + b2.height / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 8, y: y + 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(500);
    stock = await st('m.gameState.items.item_bomb || 0');
    check('4.2 дрожание ≤10 px = тап', stock === 1, { stock, jitter: [8, 3] });

    // Прокрутка списка не нажимает кнопки
    await st('m.gameState.items.item_bomb = 0; m.gameState.ore = 1e6;');
    await wait(400);
    const scrollBefore = await page.evaluate(() => document.querySelector('[data-dom-scroll]').scrollTop);
    await page.touchscreen.tap(150, 700); // фокус в области списка (не кнопка)
    const scrollBox = await page.locator('[data-dom-scroll]').boundingBox();
    const sx = Math.round(scrollBox.x + scrollBox.width * 0.4);
    const sy = Math.round(scrollBox.y + scrollBox.height * 0.75);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 22 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(500);
    const scrollAfter = await page.evaluate(() => document.querySelector('[data-dom-scroll]').scrollTop);
    stock = await st('m.gameState.items.item_bomb || 0');
    check('4.2 прокрутка не нажимает кнопки', scrollAfter > scrollBefore && stock === 0, {
        scrollBefore,
        scrollAfter,
        stock
    });
    check('4.2 тач: нет ошибок в консоли', errors.length === 0, { errors: errors.slice(0, 4) });
    await ctx.close();
}

// ---- Этап 4.3: обучение не ломается от мастерской ----
{
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    const save = { ...SEEDS.mid, tutorialDone: false, clicks: 0 };
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        },
        { [SAVE_KEY]: JSON.stringify(save), domUi: '1' }
    );
    await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
    await page.waitForFunction(
        () => {
            const ui = window.__GAME && window.__GAME.scene.getScene('UIScene');
            return !!(ui && ui.L && window.__DOM_CRAFT);
        },
        null,
        { timeout: 30000 }
    );
    await page.waitForTimeout(1000);
    // Ежедневная награда при загрузке откладывает обучение — закрываем её, как игрок
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) ui.hideDailyModal();
    });
    await page.waitForFunction(
        () => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return !!ui.tutDim;
        },
        null,
        { timeout: 10000 }
    );
    await page.waitForTimeout(300); // updateBlockLock снимает блокировку после награды
    const started = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return { step: ui.tutorialStep, dim: !!ui.tutDim };
    });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForTimeout(300);
    const during = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return { open: window.__DOM_CRAFT.isOpen(), step: ui.tutorialStep, dim: !!ui.tutDim };
    });
    await page.evaluate(() => window.__DOM_CRAFT.close({ notify: false }));
    await page.waitForTimeout(200);
    // Пройти шаги штатно: клики → вкладка 1 → вкладка 2 → «Играть»
    const flow = await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        const steps = [];
        m.gameState.clicks = ui.tutClickStart + 3;
        await new Promise((r) => setTimeout(r, 250));
        steps.push(ui.tutorialStep);
        ui.tabBtns[0].c.emit('pointerdown');
        await new Promise((r) => setTimeout(r, 250));
        steps.push(ui.tutorialStep);
        ui.tabBtns[1].c.emit('pointerdown');
        await new Promise((r) => setTimeout(r, 250));
        steps.push(ui.tutorialStep);
        ui.tutBtn.emit('pointerdown');
        await new Promise((r) => setTimeout(r, 200));
        return { steps, done: m.gameState.tutorialDone, dim: !!ui.tutDim };
    });
    check(
        '4.3 мастерская не ломает обучение',
        during.open &&
            during.dim &&
            during.step === started.step &&
            flow.steps.join(',') === '1,2,3' &&
            flow.done &&
            !flow.dim &&
            errors.length === 0,
        { started, during, flow, errors: errors.slice(0, 3) }
    );
    await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(
    path.join(OUT, 'verify-craft-dom.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2) + '\n'
);
console.log(`\n=== ${results.length - failed.length}/${results.length} проверок ok ===`);
process.exitCode = failed.length ? 1 : 0;
