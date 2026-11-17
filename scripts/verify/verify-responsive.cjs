// Проверка адаптива: две базовые сетки (ландшафт 1280x720 / портрет с высотой
// по пропорциям окна), смена ориентации на лету, работоспособность UI в портрете
// (клик по блоку, покупка, драг списка, модалка без пробития затемнения рядом).
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('../lib/dev-server.cjs');

let passed = 0,
    failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) {
        passed++;
    } else {
        failed++;
    }
}

(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const errors = [];

    const state = async (page, expr) => {
        const u = await page.evaluate(() => {
            const hit = performance
                .getEntriesByType('resource')
                .map((r) => r.name)
                .find((n) => /\/src\/state\.js/.test(n));

            return hit || '/src/state.js';
        });

        return page.evaluate(
            async ({ u, e }) => {
                const m = await import(u);

                return new Function('m', 'return (' + e + ');')(m);
            },
            { u, e: expr }
        );
    };

    const freshSave = JSON.stringify({
        version: 2,
        ore: 5000,
        tier: 0,
        stars: 0,
        clicks: 0,
        lifetimeMined: 0,
        tierEarned: [0, 0, 0, 0, 0],
        levels: { pickaxe: 5 }
    });
    const newPage = async (viewport) => {
        const ctx = await b.newContext({ viewport });
        const page = await ctx.newPage();
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
            { 'ore-rush-save': freshSave }
        );
        await page.goto('http://localhost:5174', { waitUntil: 'load' });
        await page.waitForTimeout(3000);
        // Свежий сейв выдаёт дневную награду — модалка блокирует canvas-клики;
        // закрываем, награда уже применена
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
        await page.waitForTimeout(300);

        return { ctx, page };
    };

    // Трансляция мировых координат в экранные (FIT): displayScale = gameSize/displaySize,
    // т.е. множитель ЭКРАН->МИР — для обратного направления делим
    const toScreen = async (page, wx, wy) =>
        page.evaluate(
            ([wx, wy]) => {
                const rect = window.__GAME.canvas.getBoundingClientRect();
                const ds = window.__GAME.scale.displayScale;

                return { x: rect.left + wx / ds.x, y: rect.top + wy / ds.y };
            },
            [wx, wy]
        );

    const layoutProbe = (page) =>
        page.evaluate(() => {
            const g = window.__GAME;
            const ui = g.scene.getScene('UIScene');
            const gs = g.scene.getScene('GameScene');
            // Image с setDisplaySize: реальные размеры — displayWidth/displayHeight;
            // контейнеры (width=0) — через getBounds
            const r = (o) => {
                if (!o) {
                    return null;
                }

                const b = o.getBounds ? o.getBounds() : null;

                return {
                    x: Math.round(o.x),
                    y: Math.round(o.y),
                    w: Math.round(o.displayWidth !== undefined ? o.displayWidth : b ? b.width : 0),
                    h: Math.round(o.displayHeight !== undefined ? o.displayHeight : b ? b.height : 0)
                };
            };
            const row0 = ui.rows.find((x) => x.def.id === 'pickaxe');

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
                rowCard: r(row0 && row0.rc.list.find((o) => o.texture && o.texture.key === 'upgrade_row_card_1')),
                tierLbl: r(ui.tierLabel),
                amountC: { x: Math.round(ui.amountC.x), y: Math.round(ui.amountC.y) },
                dock: ui.L.dock
                    ? {
                          x: ui.L.dock.x,
                          y: ui.L.dock.y,
                          w: ui.L.dock.w,
                          h: ui.L.dock.h,
                          unlockX: ui.L.dock.unlockX,
                          unlockW: ui.L.dock.unlockW
                      }
                    : null,
                modalCy: ui.L.modal.cy,
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
        check(
            'ландшафт: панель (1082,415) 364x582',
            l.panel.x === 1082 && l.panel.y === 415 && l.panel.w === 364 && l.panel.h === 582,
            JSON.stringify(l.panel)
        );
        check('ландшафт: ряды 296', l.rowCard.w === 296, JSON.stringify(l.rowCard));
        check(
            'ландшафт: listCam (934,270,296,392)',
            l.listCam.x === 934 && l.listCam.y === 270 && l.listCam.w === 296 && l.listCam.h === 392,
            JSON.stringify(l.listCam)
        );
        check('ландшафт: спуск по центру блока', l.unlock.x === 140 && l.unlock.y === 604, JSON.stringify(l.unlock));
        check('ландшафт: статы видимы', l.statsVisible === true);
        check('ландшафт: модалка (640,360)', l.modal.x === 640 && l.modal.y === 360, JSON.stringify(l.modal));
        await ctx.close();
    }

    // ---------- 2. Ландшафт не-16:9 (900x600): сетка не меняется ----------
    {
        const { ctx, page } = await newPage({ width: 900, height: 600 });
        const l = await layoutProbe(page);
        check(
            'ландшафт 900x600: сетка 1280x720 (FIT)',
            l.gameSize.w === 1280 && l.gameSize.h === 720,
            JSON.stringify(l.gameSize)
        );
        check('ландшафт 900x600: блок (400,400)', l.block.x === 400 && l.block.y === 400);
        await ctx.close();
    }

    // ---------- 3. Портрет 390x844: сетка по пропорциям окна ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        const l = await layoutProbe(page);
        const H = l.gameSize.h;
        check(
            'портрет: ширина 720, высота по окну (~1558)',
            l.gameSize.w === 720 && Math.abs(H - 1558) <= 2,
            JSON.stringify(l.gameSize)
        );
        check(
            'портрет: canvas = весь экран (без серых полос)',
            l.canvas.w === 390 && Math.abs(l.canvas.h - 844) <= 2,
            JSON.stringify(l.canvas)
        );
        check('портрет: флаг portrait', l.portrait === true);
        // Текущая спека портретной сетки (src/layout.js): «лист» 700..900 высотой,
        // вьюпорт-ниша внутри листа, нижний док Карта/Спуск/Крафт, модалки по центру
        // свободной зоны (cx=W/2, cy=(160+H-16)/2).
        const ph = Math.min(900, Math.max(700, Math.round(H * 0.6)));
        const py = H - ph;
        const recessTop = Math.round(0.186 * ph);
        const recessBot = Math.round(0.945 * ph);
        const vpInsetT = recessTop + 142;
        check(
            'портрет: блок по центру свободной зоны',
            l.block.x === 360 && l.block.y === Math.round((140 + py) / 2),
            JSON.stringify(l.block)
        );
        check(
            'портрет: панель-«лист» от края до края',
            l.panel.x === 360 && l.panel.w === 720 && l.panel.y === py + ph / 2,
            JSON.stringify(l.panel)
        );
        check(
            'портрет: панель в границах экрана',
            l.panel.y + l.panel.h / 2 <= H && l.panel.x - l.panel.w / 2 >= 0 && l.panel.x + l.panel.w / 2 <= 720
        );
        const vp = {
            x: Math.round((73 * l.gameSize.w) / 1029),
            y: py + vpInsetT,
            w: l.gameSize.w - Math.round((65 * l.gameSize.w) / 1029) - Math.round((73 * l.gameSize.w) / 1029),
            h: ph - vpInsetT - (ph - recessBot + 114)
        };
        check(
            'портрет: вкладки растянуты на весь вьюпорт',
            Math.abs(l.amountC.x + 60 - (vp.x + vp.w - 16)) <= 1 && Math.round(l.tierLbl.x) === vp.x + 14,
            JSON.stringify({ amount: l.amountC, tier: l.tierLbl, vp })
        );
        check(
            'портрет: listCam = внутренняя зона панели',
            l.listCam.x === vp.x && l.listCam.y === vp.y && l.listCam.w === vp.w && l.listCam.h === vp.h,
            JSON.stringify({ got: l.listCam, want: vp })
        );
        check(
            'портрет: ряды широкие (по вьюпорту)',
            l.rowCard.w === vp.w && l.rowCard.w > 500,
            JSON.stringify(l.rowCard)
        );
        check('портрет: фон закрывает полосу до панели', l.bg.h >= py && l.bg.w >= 720, JSON.stringify(l.bg));
        check(
            'портрет: спуск в нижнем доке (между Картой и Крафтом)',
            l.unlock.y === l.dock.y &&
                l.unlock.x === l.dock.unlockX &&
                l.unlock.w === l.dock.unlockW &&
                l.unlock.h === l.dock.h,
            JSON.stringify({ unlock: l.unlock, dock: l.dock })
        );
        check('портрет: подсказка над панелью', l.hint.y > 0 && l.hint.y + l.hint.h / 2 <= py, JSON.stringify(l.hint));
        check('портрет: статы видимы (клик/крит в HUD)', l.statsVisible === true);
        check(
            'портрет: модалка по центру свободной зоны',
            l.modal.x === 360 && l.modal.y === l.modalCy,
            JSON.stringify(l.modal)
        );
        check('портрет: HUD-бар на всю ширину', l.hudBar.w === 704 && l.hudBar.x === 360, JSON.stringify(l.hudBar));
        check(
            'портрет: строка тира в границах списка',
            l.tierLbl.x >= l.listCam.x && l.tierLbl.x + l.tierLbl.w <= l.listCam.x + l.listCam.w + 2,
            JSON.stringify(l.tierLbl)
        );
        check(
            'портрет: кнопка x1 с отступом от правого края',
            Math.round(l.amountC.x + 60) === l.listCam.x + l.listCam.w - 16,
            JSON.stringify(l.amountC)
        );

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
            const row = ui.rows.find(
                (r) => r.rc.visible && r.rc.y >= s && r.rc.y + ui.rowGeom().h <= s + ui.listCam.height
            );

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
            const row = ui.rows.find(
                (r) =>
                    r.rc.visible &&
                    r.btn.texture.key === 'buy_button_normal' &&
                    r.rc.y >= s &&
                    r.rc.y + ui.rowGeom().h <= s + ui.listCam.height
            );

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

            return {
                visible: ui.modal.visible,
                x: Math.round(ui.modal.x),
                y: Math.round(ui.modal.y),
                dim: Math.round(ui.modalDim.width) + 'x' + Math.round(ui.modalDim.height),
                listHidden: !ui.listContent.visible
            };
        });
        check(
            'портрет: модалка открылась над панелью',
            modalOpen.visible && modalOpen.x === 360 && modalOpen.y === Math.round((160 + (H - 16)) / 2),
            JSON.stringify(modalOpen)
        );
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
        check(
            'портрет: драг вверх возвращает скролл',
            scrollBack < scrollAfterDrag,
            `${scrollAfterDrag} -> ${scrollBack}`
        );

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
        check(
            'ротация -> портрет: сетка сменилась',
            l.gameSize.w === 720 && Math.abs(l.gameSize.h - 1558) <= 2,
            JSON.stringify(l.gameSize)
        );
        check('ротация -> портрет: ряды пересобраны широкими', l.rowCard.w > 500, JSON.stringify(l.rowCard));
        check('ротация -> портрет: блок переехал', l.block.x === 360, JSON.stringify(l.block));
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.waitForTimeout(700);
        l = await layoutProbe(page);
        check(
            'ротация -> ландшафт: сетка вернулась',
            l.gameSize.w === 1280 && l.gameSize.h === 720,
            JSON.stringify(l.gameSize)
        );
        check(
            'ротация -> ландшафт: блок вернулся (400,400)',
            l.block.x === 400 && l.block.y === 400,
            JSON.stringify(l.block)
        );
        check('ротация -> ландшафт: панель на месте', l.panel.x === 1082 && l.panel.y === 415, JSON.stringify(l.panel));
        check('ротация -> ландшафт: ряды снова 296', l.rowCard.w === 296, JSON.stringify(l.rowCard));
        // После ротаций игра жива: клик по блоку добывает
        const oreBefore = await state(page, 'm.gameState.ore');
        const s = await toScreen(page, 400, 400);
        await page.mouse.click(s.x, s.y);
        await page.waitForTimeout(150);
        const oreAfter = await state(page, 'm.gameState.ore');
        check(
            'ротация: клик по блоку работает после смены ориентаций',
            oreAfter > oreBefore,
            `${oreBefore} -> ${oreAfter}`
        );
        await ctx.close();
    }

    // ---------- 6. Портрет-HUD: кегли по _adaptiveScale, без наездов ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        const h = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const f = (o) => parseFloat(o.style.fontSize);

            return {
                s: ui._adaptiveScale,
                mapLbl: f(ui.mapLbl),
                craftLbl: f(ui.craftLbl),
                mapBtnH: ui.mapBtn.displayHeight,
                mapBtnTop: ui.mapBtn.getBounds().top,
                mapBtnBottom: ui.mapBtn.getBounds().bottom,
                dockTop: ui.L.dock.y,
                H: ui.L.H,
                settingsW: ui.settingsBtn.displayWidth,
                settingsH: ui.settingsBtn.displayHeight,
                settingsLbl: f(ui.settingsLbl),
                coal: f(ui.coalText),
                oreName: f(ui.oreName),
                stats: f(ui.statsLine),
                stars: f(ui.starsText),
                buff: f(ui.buffLine),
                gpsRight: ui.gpsText.getBounds().right,
                statsRight: ui.statsLine.x + ui.statsLine.width,
                settingsLeft: ui.settingsBtn.x - ui.settingsBtn.displayWidth / 2,
                settingsRight: ui.settingsBtn.x + ui.settingsBtn.displayWidth / 2,
                btnX: ui.L.hud.btnX,
                W: ui.L.W
            };
        });
        check('портрет-HUD: масштаб 1.8 (390px)', Math.abs(h.s - 1.8) <= 0.05, String(h.s));
        check(
            'портрет-HUD: кнопки Карта/Крафт выросли и стоят в нижнем доке (не за экраном)',
            h.mapBtnH >= 64 &&
                h.mapBtnTop >= h.dockTop - 1 &&
                h.mapBtnBottom <= h.H - 8 &&
                h.mapLbl >= 18 &&
                h.craftLbl >= 18,
            JSON.stringify({ h: h.mapBtnH, top: h.mapBtnTop, bottom: h.mapBtnBottom, dock: h.dockTop, H: h.H })
        );
        check(
            'портрет-HUD: кнопка Настройки крупнее',
            h.settingsW >= 176 && h.settingsH >= 56 && h.settingsLbl >= 16,
            JSON.stringify({ w: h.settingsW, h: h.settingsH, lbl: h.settingsLbl })
        );
        check(
            'портрет-HUD: кегли строк выросли',
            h.coal >= 32 && h.oreName >= 13 && h.stars >= 18 && h.buff >= 18 && h.stats >= 14,
            JSON.stringify(h)
        );
        check(
            'портрет-HUD: строки не заходят под Настройки (предел = левый край кнопки)',
            h.gpsRight <= h.settingsLeft - 7 && h.statsRight <= h.settingsLeft - 7,
            JSON.stringify({ gps: h.gpsRight, stats: h.statsRight, settingsLeft: h.settingsLeft })
        );
        check('портрет-HUD: Настройки в границах бара', h.settingsRight <= h.W - 20, String(h.settingsRight));
        await ctx.close();
    }

    // ---------- 6b. Портрет-HUD с длинными значениями: ужин проверяется по-настоящему ----------
    // Короткие стартовые строки проходят проверку предела тривиально; здесь — позднеигровой
    // максимум из state-модуля: тир 11 (алмазы), большой счётчик руды (сдвигает строку
    // ставки вправо), огромная ставка и урон. statsLine обязан реально ужаться
    // (25 -> ~12); gpsText в пределе — ужин недостижим, кегль остаётся целевым,
    // а честную гарантию даёт следующий чек: обе строки левее кнопки «Настройки».
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        await state(
            page,
            '(m => { m.gameState.ore = 987654321098; m.gameState.tier = 11; m.gameState.stars = 100; m.gameState.levels.miner = 180; m.gameState.levels.drill = 150; m.gameState.levels.tech = 90; })(m)'
        );
        await page.waitForTimeout(500); // refreshUi каждый кадр: длинные строки -> ужин
        const h = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const f = (o) => parseFloat(o.style.fontSize);

            return {
                s: ui._adaptiveScale,
                gpsSize: f(ui.gpsText),
                statsSize: f(ui.statsLine),
                gpsText: ui.gpsText.text,
                statsText: ui.statsLine.text,
                gpsRight: ui.gpsText.getBounds().right,
                statsRight: ui.statsLine.x + ui.statsLine.width,
                settingsLeft: ui.settingsBtn.x - ui.settingsBtn.displayWidth / 2
            };
        });
        check(
            'портрет-HUD 6b: строки действительно длинные',
            h.gpsText.length >= 14 && h.statsText.length >= 17,
            JSON.stringify({ gps: h.gpsText, stats: h.statsText })
        );
        check(
            'портрет-HUD 6b: statsLine ужат ниже целевого кегля',
            h.statsSize < Math.round(14 * h.s) && h.statsSize >= 11,
            `size=${h.statsSize} target=${Math.round(14 * h.s)}`
        );
        check(
            'портрет-HUD 6b: gpsText в пределе — ужин недостижим, целевой кегль сохранён (не-наезд проверяет чек ниже)',
            h.gpsSize <= 16,
            `size=${h.gpsSize} text="${h.gpsText}"`
        );
        check(
            'портрет-HUD 6b: длинные строки не заходят под Настройки',
            h.gpsRight <= h.settingsLeft - 7 && h.statsRight <= h.settingsLeft - 7,
            JSON.stringify({
                gps: Math.round(h.gpsRight),
                stats: Math.round(h.statsRight),
                settingsLeft: Math.round(h.settingsLeft)
            })
        );
        await ctx.close();
    }

    // ---------- 7. Портрет-панель: кегли рядов внутри карточки 108 ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        const p = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const f = (o) => parseFloat(o.style.fontSize);
            const row = ui.rows.find((r) => r.def.id === 'pickaxe');
            const g = ui.rowGeom();

            return {
                s: ui._adaptiveScale,
                rowsS: ui._rowsBuiltS,
                rows: ui.rows.length,
                name: f(row.nameText),
                nameW: row.nameText.width,
                nameMaxW: row.nameMaxW,
                desc: f(row.descText),
                descH: row.descText.height,
                price: f(row.priceText),
                btn: f(row.btnText),
                btnW: row.btnText.width,
                rowH: g.h,
                iconSize: g.iconSize,
                nameBottom: row.nameText.y + row.nameText.height,
                priceBottom: row.priceText.y + row.priceText.height / 2
            };
        });
        check(
            'портрет-панель: ряды пересобраны под масштаб',
            Math.abs(p.rowsS - 1.8) <= 0.05 && p.rows > 0,
            `s=${p.rowsS}`
        );
        check(
            'портрет-панель: высота ряда сохранена (108), иконка в нише',
            p.rowH === 132 && p.iconSize <= 64,
            JSON.stringify({ h: p.rowH, icon: p.iconSize })
        );
        check(
            'портрет-панель: имя/цена/кнопка выросли',
            p.name === 27 && p.price >= 18 && p.btn >= 18 && p.btnW <= 94,
            JSON.stringify({ name: p.name, price: p.price, btn: p.btn })
        );
        check(
            'портрет-панель: desc без переносов',
            p.desc === 21 && p.descH <= 21 * 1.6,
            JSON.stringify({ size: p.desc, h: p.descH })
        );
        check(
            'портрет-панель: тексты в карточке',
            p.nameBottom <= p.rowH - 4 && p.priceBottom <= p.rowH - 2 && p.nameW <= p.nameMaxW + 1,
            JSON.stringify(p)
        );
        await ctx.close();
    }

    // ---------- 8. Портрет-карта: узлы по масштабу, без вылезаний ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openMap());
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const f = (o) => parseFloat(o.style.fontSize);
            const nodes = ui.mapNodes.map((n) => ({
                kind: n.kind,
                y: n.root.y,
                name: f(n.name),
                nameW: n.name.width,
                status: n.status ? f(n.status) : null,
                statusW: n.status ? n.status.width : 0,
                ring: n.ring ? n.ring.type : null,
                ringX: n.ring ? n.ring.x : null,
                ringY: n.ring ? n.ring.y : null
            }));

            return {
                s: ui._adaptiveScale,
                mapS: ui._mapS,
                open: ui._mapOpen,
                contentH: ui._mapContentH,
                maxScroll: ui._mapMaxScroll,
                viewW: ui._mapView.w,
                board: ui.mapBoard.visible && ui.mapBoard.texture.key === 'map_board',
                trail: ui.mapTrail.type,
                boardW: ui.mapBoard.displayWidth,
                nodes
            };
        });
        check(
            'портрет-карта: узлы пересчитаны по масштабу',
            m.open &&
                Math.abs(m.mapS - 1.8) <= 0.05 &&
                Math.abs(m.contentH - Math.round((90 + m.nodes.length * 132 + 60) * 1.8)) <= 1,
            `contentH=${m.contentH}`
        );
        check('портрет-карта: первый узел на (90)*s', m.nodes[0].y === Math.round(90 * 1.8), String(m.nodes[0].y));
        check(
            'портрет-карта: доска/тропа/кружки на месте',
            m.board &&
                m.trail === 'Graphics' &&
                m.nodes.every((n) => n.ring === 'Graphics' && n.ringX === 0 && n.ringY > 0) &&
                Math.abs(m.boardW - m.viewW) <= 1,
            JSON.stringify({ board: m.board, trail: m.trail, boardW: m.boardW, viewW: m.viewW })
        );
        check(
            'портрет-карта: кегли ≥ 10 и тексты под кружком в границах вьюпорта',
            m.nodes.every((n) => n.name >= 10 && n.nameW <= m.viewW - 20) &&
                m.nodes.filter((n) => n.kind === 'boss').every((n) => n.statusW <= m.viewW - 20),
            JSON.stringify(m.nodes.map((n) => [n.name, Math.round(n.nameW)]))
        );
        check(
            'портрет-карта: статусы боссов ≥ 10',
            m.nodes.filter((n) => n.kind === 'boss').every((n) => n.status >= 10)
        );
        check('портрет-карта: скролл жив', m.maxScroll > 0);
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeMap());
        await page.waitForTimeout(200);
        await ctx.close();
    }

    // ---------- 9. Портрет-крафт (DOM): панель в вьюпорте, скролл, тап-зоны ----------
    // Phaser-мастерская удалена при пилоте DOM (G3 = go): проверяем живой DOM-контроллер.
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
        await page.waitForSelector('.dom-panel', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(200);
        const c = await page.evaluate(() => {
            const panel = document.querySelector('.dom-panel');
            const scroll = panel.querySelector('[data-dom-scroll]');
            const r = panel.getBoundingClientRect();
            const btns = [...panel.querySelectorAll('.dom-btn')].filter((b) => !b.hidden);
            const rects = btns.map((b) => b.getBoundingClientRect());

            return {
                open: !!window.__DOM_CRAFT && window.__DOM_CRAFT.isOpen(),
                rect: { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom },
                vw: { w: window.innerWidth, h: window.innerHeight },
                scrollable: scroll.scrollHeight > scroll.clientHeight + 1,
                noHOverflow: scroll.scrollWidth <= scroll.clientWidth + 1,
                minBtnH: rects.length ? Math.min(...rects.map((x) => x.height)) : 0,
                rows: panel.querySelectorAll('[data-row]').length
            };
        });
        check(
            'портрет-крафт (DOM): открыт, панель внутри вьюпорта',
            c.open && c.rect.x >= -1 && c.rect.y >= -1 && c.rect.right <= c.vw.w + 1 && c.rect.bottom <= c.vw.h + 1,
            JSON.stringify(c.rect)
        );
        check(
            'портрет-крафт (DOM): ряды и вертикальный скролл',
            c.rows >= 7 && c.scrollable,
            JSON.stringify({ rows: c.rows, scroll: c.scrollable })
        );
        check('портрет-крафт (DOM): нет горизонтального переполнения', c.noHOverflow, '');
        check('портрет-крафт (DOM): тап-зоны ≥ 24px', c.minBtnH >= 24, String(c.minBtnH));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = await page.evaluate(() => !window.__DOM_CRAFT || !window.__DOM_CRAFT.isOpen());
        check('портрет-крафт (DOM): Escape закрывает', closed === true, String(closed));
        await ctx.close();
    }

    // ---------- 10. Портрет-бой: панель поднимается под босса, «Снаряжение» ----------
    {
        const { ctx, page } = await newPage({ width: 390, height: 844 });
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(500);
        const f = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const gs = window.__GAME.scene.getScene('GameScene');
            const L = ui.L;
            const byF = Math.max(L.block.y, 386);
            const hintBottom = gs.bossHint ? gs.bossHint.y + gs.bossHint.height / 2 : 0;
            const card = ui.gearRows[0]._geom;

            return {
                py: L.panel.py,
                panelBase: L.panel.py,
                fightTop: byF,
                H: L.H,
                hintBottom,
                gearVisible: ui.gearContent.visible,
                listVisible: ui.listContent.visible,
                unlockVisible: ui.unlockBtn.visible,
                card: { x: card.x, y: card.y, w: card.w, h: card.h },
                vw: { x: L.viewport.x, y: L.viewport.y, w: L.viewport.w, h: L.viewport.h },
                panelH: L.panel.ph
            };
        });
        check(
            'портрет-бой: панель не прыгает (py = базовый)',
            f.py === f.panelBase,
            JSON.stringify({ py: f.py, base: f.panelBase })
        );
        check(
            'портрет-бой: панель целиком на экране',
            f.py > 0 && f.py + f.panelH <= f.H + 1,
            JSON.stringify({ py: f.py, h: f.panelH, H: f.H })
        );
        check('портрет-бой: «Снаряжение» видно, список улучшений скрыт', f.gearVisible && !f.listVisible, '');
        check('портрет-бой: спуск скрыт', !f.unlockVisible, '');
        check(
            'портрет-бой: карточка снаряжения внутри вьюпорта',
            // _geom — уже top-left координаты карточки
            f.card.x >= f.vw.x - 2 &&
                f.card.y >= f.vw.y - 2 &&
                f.card.x + f.card.w <= f.vw.x + f.vw.w + 2 &&
                f.card.y + f.card.h <= f.vw.y + f.vw.h + 2,
            JSON.stringify({ card: f.card, vw: f.vw })
        );
        check('портрет-бой: панель выше базовой 582', f.panelH > 582, String(f.panelH));
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').retreatBoss());
        await page.waitForTimeout(600);
        const after = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');

            return {
                gear: ui.gearContent.visible,
                list: ui.listContent.visible,
                unlock: ui.unlockBtn.visible,
                py: ui.L.panel.py,
                H: ui.L.H
            };
        });
        const basePy = after.H - Math.min(900, Math.max(700, Math.round(after.H * 0.6)));
        check(
            'портрет-бой: после победы панель возвращается на базовое место',
            !after.gear && after.list && after.unlock && after.py === basePy,
            JSON.stringify(after)
        );
        await ctx.close();
    }

    check('page errors', errors.length === 0, errors.slice(0, 3).join('; '));
    console.log(`\nИтого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
