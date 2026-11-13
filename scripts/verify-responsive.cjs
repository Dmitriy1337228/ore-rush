// Проверка адаптива: две базовые сетки (ландшафт 1280x720 / портрет с высотой
// по пропорциям окна), смена ориентации на лету, работоспособность UI в портрете
// (клик по блоку, покупка, драг списка, модалка без пробития затемнения рядом).
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) passed++; else failed++;
}

(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const errors = [];

    const state = async (page, expr) => {
        const u = await page.evaluate(() => {
            const hit = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
            return hit || '/src/state.js';
        });
        return page.evaluate(async ({ u, e }) => {
            const m = await import(u);
            return new Function('m', 'return (' + e + ');')(m);
        }, { u, e: expr });
    };

    const freshSave = JSON.stringify({ version: 2, ore: 5000, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5 } });
    const newPage = async (viewport) => {
        const ctx = await b.newContext({ viewport });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'minecraft-clicker-save': freshSave });
        await page.goto('http://localhost:5174', { waitUntil: 'load' });
        await page.waitForTimeout(3000);
        return { ctx, page };
    };

    // Трансляция мировых координат в экранные (FIT): displayScale = gameSize/displaySize,
    // т.е. множитель ЭКРАН->МИР — для обратного направления делим
    const toScreen = async (page, wx, wy) => page.evaluate(([wx, wy]) => {
        const rect = window.__GAME.canvas.getBoundingClientRect();
        const ds = window.__GAME.scale.displayScale;
        return { x: rect.left + wx / ds.x, y: rect.top + wy / ds.y };
    }, [wx, wy]);

    const layoutProbe = (page) => page.evaluate(() => {
        const g = window.__GAME;
        const ui = g.scene.getScene('UIScene');
        const gs = g.scene.getScene('GameScene');
        // Image с setDisplaySize: реальные размеры — displayWidth/displayHeight;
        // контейнеры (width=0) — через getBounds
        const r = (o) => {
            if (!o) return null;
            const b = o.getBounds ? o.getBounds() : null;
            return {
                x: Math.round(o.x),
                y: Math.round(o.y),
                w: Math.round(o.displayWidth !== undefined ? o.displayWidth : (b ? b.width : 0)),
                h: Math.round(o.displayHeight !== undefined ? o.displayHeight : (b ? b.height : 0))
            };
        };
        const row0 = ui.rows.find(x => x.def.id === 'pickaxe');
        return {
            gameSize: { w: g.scale.gameSize.width, h: g.scale.gameSize.height },
            portrait: ui.L.portrait,
            block: { x: Math.round(gs.blockX), y: Math.round(gs.blockY) },
            bg: { w: Math.round(gs.bgCurrent.displayWidth), h: Math.round(gs.bgCurrent.displayHeight) },
            hudBar: r(ui.hudBar),
            panel: r(ui.panelImg),
            listCam: { x: ui.listCam.x, y: ui.listCam.y, w: ui.listCam.width, h: ui.listCam.height },
            unlock: r(ui.unlockBtn),
            hint: r(ui.hint),
            modal: { x: Math.round(ui.modal.x), y: Math.round(ui.modal.y) },
            statsVisible: ui.statsLine.visible,
            rowCard: r(row0 && row0.rc.list.find(o => o.texture && o.texture.key === 'upgrade_row_card_1')),
            tierLbl: r(ui.tierLabel),
            amountC: { x: Math.round(ui.amountC.x), y: Math.round(ui.amountC.y) },
            canvas: { w: Math.round(g.scale.displaySize.width), h: Math.round(g.scale.displaySize.height) }
        };
    });

    // ---------- 1. Ландшафт 1280x720: прежняя раскладка 1:1 ----------
    {
        const { ctx, page } = await newPage({ width: 1280, height: 720 });
        const l = await layoutProbe(page);
        check('ландшафт: сетка 1280x720', l.gameSize.w === 1280 && l.gameSize.h === 720, JSON.stringify(l.gameSize));
        check('ландшафт: не портрет', l.portrait === false);
        check('ландшафт: блок (400,400)', l.block.x === 400 && l.block.y === 400, JSON.stringify(l.block));
        check('ландшафт: фон 1382x778', l.bg.w === 1382 && l.bg.h === 778, JSON.stringify(l.bg));
        check('ландшафт: панель (1082,415) 364x582', l.panel.x === 1082 && l.panel.y === 415 && l.panel.w === 364 && l.panel.h === 582, JSON.stringify(l.panel));
        check('ландшафт: ряды 296', l.rowCard.w === 296, JSON.stringify(l.rowCard));
        check('ландшафт: listCam (934,270,296,392)', l.listCam.x === 934 && l.listCam.y === 270 && l.listCam.w === 296 && l.listCam.h === 392, JSON.stringify(l.listCam));
        check('ландшафт: спуск по центру блока', l.unlock.x === 140 && l.unlock.y === 604, JSON.stringify(l.unlock));
        check('ландшафт: статы видимы', l.statsVisible === true);
        check('ландшафт: модалка (640,360)', l.modal.x === 640 && l.modal.y === 360, JSON.stringify(l.modal));
        await ctx.close();
    }

    // ---------- 2. Ландшафт не-16:9 (900x600): сетка не меняется ----------
    {
        const { ctx, page } = await newPage({ width: 900, height: 600 });
        const l = await layoutProbe(page);
        check('ландшафт 900x600: сетка 1280x720 (FIT)', l.gameSize.w === 1280 && l.gameSize.h === 720, JSON.stringify(l.gameSize));
        check('ландшафт 900x600: блок (400,400)', l.block.x === 400 && l.block.y === 400);
        await ctx.close();
    }

    // ---------- 3. Портрет 390x844: сетка по пропорциям окна ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        const l = await layoutProbe(page);
        const H = l.gameSize.h;
        check('портрет: ширина 720, высота по окну (~1558)', l.gameSize.w === 720 && Math.abs(H - 1558) <= 2, JSON.stringify(l.gameSize));
        check('портрет: canvas = весь экран (без серых полос)', l.canvas.w === 390 && Math.abs(l.canvas.h - 844) <= 2, JSON.stringify(l.canvas));
        check('портрет: флаг portrait', l.portrait === true);
        const py = H - 582; // верх панели (лист вровень с низом экрана)
        check('портрет: блок по центру свободной зоны', l.block.x === 360 && l.block.y === Math.round((140 + (py - 124)) / 2), JSON.stringify(l.block));
        check('портрет: панель-«лист» от края до края', l.panel.x === 360 && l.panel.w === 720 && l.panel.y === py + 291, JSON.stringify(l.panel));
        check('портрет: панель в границах экрана', l.panel.y + l.panel.h / 2 <= H && l.panel.x - l.panel.w / 2 >= 0 && l.panel.x + l.panel.w / 2 <= 720);
        const vp = { x: Math.round(73 * l.gameSize.w / 1029), y: py + 156, w: l.gameSize.w - Math.round(65 * l.gameSize.w / 1029) - Math.round(73 * l.gameSize.w / 1029), h: 394 };
        check('портрет: вкладки растянуты на весь вьюпорт', Math.abs((l.amountC.x + 46) - (vp.x + vp.w - 18)) <= 1 && Math.round(l.tierLbl.x) === vp.x + 2, JSON.stringify({ amount: l.amountC, tier: l.tierLbl, vp }));
        check('портрет: listCam = внутренняя зона панели', l.listCam.x === vp.x && l.listCam.y === vp.y && l.listCam.w === vp.w && l.listCam.h === vp.h, JSON.stringify({ got: l.listCam, want: vp }));
        check('портрет: ряды широкие (по вьюпорту)', l.rowCard.w === vp.w && l.rowCard.w > 500, JSON.stringify(l.rowCard));
        check('портрет: фон закрывает полосу до панели', l.bg.h >= py && l.bg.w >= 720, JSON.stringify(l.bg));
        check('портрет: спуск над панелью', l.unlock.y + l.unlock.h / 2 <= py, JSON.stringify(l.unlock));
        check('портрет: подсказка между кнопкой и панелью', l.hint.y > l.unlock.y + l.unlock.h / 2 && l.hint.y + l.hint.h / 2 <= py, JSON.stringify(l.hint));
        check('портрет: статы видимы (клик/крит в HUD)', l.statsVisible === true);
        check('портрет: модалка в свободной зоне над панелью', l.modal.x === 360 && l.modal.y === Math.max(Math.round(py / 2), 302) && l.modal.y + 300 <= py, JSON.stringify(l.modal));
        check('портрет: HUD-бар на всю ширину', l.hudBar.w === 704 && l.hudBar.x === 360, JSON.stringify(l.hudBar));
        check('портрет: строка тира в границах списка', l.tierLbl.x >= l.listCam.x && l.tierLbl.x + l.tierLbl.w <= l.listCam.x + l.listCam.w + 2, JSON.stringify(l.tierLbl));
        check('портрет: кнопка x1 с отступом от правого края', Math.round(l.amountC.x + 46) === l.listCam.x + l.listCam.w - 18, JSON.stringify(l.amountC));


        // Клик по блоку в портрете (мировые -> экранные)
        const oreBefore = await state(page, 'm.gameState.ore');
        const s = await toScreen(page, l.block.x, l.block.y);
        await page.mouse.click(s.x, s.y);
        await page.waitForTimeout(150);
        const oreAfter = await state(page, 'm.gameState.ore');
        check('портрет: клик по блоку добывает руду', oreAfter > oreBefore, `${oreBefore} -> ${oreAfter}`);

        // ДРАГ списка пальцем: жест, начатый на кнопке ряда, — скроллит и НЕ покупает.
        // Позиция кнопки в координатах канваса: listCam viewport + позиция ряда - скролл.
        const btnCanvas = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const s = ui.listCam.scrollY;
            const row = ui.rows.find(r => r.rc.visible && r.rc.y >= s && r.rc.y + ui.rowGeom().h <= s + ui.listCam.height);
            return { x: ui.listCam.x + row.btn.x, y: ui.listCam.y + row.rc.y + row.btn.y - s };
        });
        const bs = await toScreen(page, btnCanvas.x, btnCanvas.y);
        const lvlBefore = await state(page, `Object.values(m.gameState.levels).reduce((a, b) => a + b, 0)`);
        await page.mouse.move(bs.x, bs.y);
        await page.mouse.down();
        await page.mouse.move(bs.x, bs.y - 97, { steps: 8 }); // ~180 игровых px вверх
        await page.mouse.up();
        await page.waitForTimeout(250);
        const scrollAfterDrag = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').scrollPos);
        const lvlAfterDrag = await state(page, `Object.values(m.gameState.levels).reduce((a, b) => a + b, 0)`);
        check('портрет: драг от кнопки скроллит список', scrollAfterDrag >= 160, `scroll=${scrollAfterDrag}`);
        check('портрет: драг от кнопки НЕ покупает', lvlAfterDrag === lvlBefore, `lvl=${lvlAfterDrag}`);

        // ТАП по кнопке ПОКУПАЕМОГО ряда (после скролла) — покупает
        const tapCanvas = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const s = ui.listCam.scrollY;
            const row = ui.rows.find(r => r.rc.visible && r.btn.texture.key === 'buy_button_normal'
                && r.rc.y >= s && r.rc.y + ui.rowGeom().h <= s + ui.listCam.height);
            return { x: ui.listCam.x + row.btn.x, y: ui.listCam.y + row.rc.y + row.btn.y - s };
        });
        const ts = await toScreen(page, tapCanvas.x, tapCanvas.y);
        await page.mouse.click(ts.x, ts.y);
        await page.waitForTimeout(250);
        const lvlAfterTap = await state(page, `Object.values(m.gameState.levels).reduce((a, b) => a + b, 0)`);
        check('портрет: тап по кнопке покупает', lvlAfterTap > lvlAfterDrag, `sum=${lvlAfterTap}`);

        // Модалка поверх портрета: ряды скрыты, затемнение на весь экран
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown'));
        await page.waitForTimeout(300);
        const modalOpen = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { visible: ui.modal.visible, x: Math.round(ui.modal.x), y: Math.round(ui.modal.y), dim: Math.round(ui.modalDim.width) + 'x' + Math.round(ui.modalDim.height), listHidden: !ui.listContent.visible };
        });
        check('портрет: модалка открылась над панелью', modalOpen.visible && modalOpen.x === 360 && modalOpen.y === Math.max(Math.round(py / 2), 302), JSON.stringify(modalOpen));
        check('портрет: затемнение 720xH', modalOpen.dim === `720x${H}`, modalOpen.dim);
        check('портрет: ряды скрыты под модалкой (не пробивают dim)', modalOpen.listHidden === true);
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeModal());
        await page.waitForTimeout(150);

        // Драг работает и после модалки
        const s2 = await toScreen(page, l.listCam.x + vp.w / 2, vp.y + 200);
        await page.mouse.move(s2.x, s2.y);
        await page.mouse.down();
        await page.mouse.move(s2.x, s2.y + 120, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        const scrollBack = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').scrollPos);
        check('портрет: драг вверх возвращает скролл', scrollBack < scrollAfterDrag, `${scrollAfterDrag} -> ${scrollBack}`);

        await page.screenshot({ path: 'C:\\Users\\Dmitriy Rogov\\AppData\\Local\\Temp\\kilo\\resp_portrait.png' });
        await ctx.close();
    }

    // ---------- 4. Первичная загрузка сразу в портрете ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        const l = await layoutProbe(page);
        check('портрет со старта: сетка по окну', l.gameSize.w === 720 && Math.abs(l.gameSize.h - 1558) <= 2);
        check('портрет со старта: canvas без полос', Math.abs(l.canvas.h - 844) <= 2);
        await ctx.close();
    }

    // ---------- 5. Ротация на лету: ландшафт -> портрет -> ландшафт ----------
    {
        const { ctx, page } = await newPage({ width: 1280, height: 720 });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(700);
        let l = await layoutProbe(page);
        check('ротация -> портрет: сетка сменилась', l.gameSize.w === 720 && Math.abs(l.gameSize.h - 1558) <= 2, JSON.stringify(l.gameSize));
        check('ротация -> портрет: ряды пересобраны широкими', l.rowCard.w > 500, JSON.stringify(l.rowCard));
        check('ротация -> портрет: блок переехал', l.block.x === 360, JSON.stringify(l.block));
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.waitForTimeout(700);
        l = await layoutProbe(page);
        check('ротация -> ландшафт: сетка вернулась', l.gameSize.w === 1280 && l.gameSize.h === 720, JSON.stringify(l.gameSize));
        check('ротация -> ландшафт: блок вернулся (400,400)', l.block.x === 400 && l.block.y === 400, JSON.stringify(l.block));
        check('ротация -> ландшафт: панель на месте', l.panel.x === 1082 && l.panel.y === 415, JSON.stringify(l.panel));
        check('ротация -> ландшафт: ряды снова 296', l.rowCard.w === 296, JSON.stringify(l.rowCard));
        // После ротаций игра жива: клик по блоку добывает
        const oreBefore = await state(page, 'm.gameState.ore');
        const s = await toScreen(page, 400, 400);
        await page.mouse.click(s.x, s.y);
        await page.waitForTimeout(150);
        const oreAfter = await state(page, 'm.gameState.ore');
        check('ротация: клик по блоку работает после смены ориентаций', oreAfter > oreBefore, `${oreBefore} -> ${oreAfter}`);
        await ctx.close();
    }

    check('page errors', errors.length === 0, errors.slice(0, 3).join('; '));
    console.log(`\nИтого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
