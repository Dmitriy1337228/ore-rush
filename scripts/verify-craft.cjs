// Проверка мастерской (П5): открытие по HUD-кнопке, шапка компонентов, три секции,
// крафт бомбы (+2 в стаки), активация пояса (gps x3, buffLine «x3», слот-конфликт
// кофе), гейт бомбы вне боя («только в бою»), таймированный крафт (бур/батарея):
// старт → «Забрать» недоступно → подмотка endsAt → claim → артефакт в коллекции
// (бур: урон боссам x1.25; батарея: passiveMult 1.15 — рост getOrePerSecond),
// занятый верстак блокирует прочие рецепты, закрытие крафта снимает lock,
// карта/награда босса не конфликтуют по updateBlockLock, портретная геометрия.
// Запуск: node scripts/verify-craft.cjs — dev-сервер поднимается сам (порт 5174).
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) passed++; else failed++;
}

const mkSave = (over = {}) => JSON.stringify(Object.assign({
    version: 5, ore: 100000, tier: 1, stars: 0, clicks: 50, lifetimeMined: 5e5,
    tierEarned: [1e5, 5000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tierAnchorRate: 50, tutorialDone: true,
    bossesDefeated: {}, components: {}, artifacts: [], items: {}, crafting: null,
    levels: { pickaxe: 12, miner: 10, dynamite: 0, lucky: 0, resonance: 0, focuslens: 0, magnet: 0, robotarm: 0, drill: 0, tech: 0 }
}, over));

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const errors = [];

    const newPage = async (save, viewport) => {
        const page = await b.newPage({ viewport });
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.addInitScript((s) => { localStorage.setItem('ore-rush-save', s); }, save);
        await page.goto('http://localhost:5174', { waitUntil: 'load' });
        await page.waitForTimeout(3000);
        // Свежий сейв выдаёт дневную награду — закрываем и гасим дневные бафы
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
        await page.waitForTimeout(400);
        await page.evaluate(async () => {
            const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n)) || '/src/state.js';
            const m = await import(u);
            m.gameState.dailyBuffUntil = 0;
            m.gameState.dailyCritUntil = 0;
            m.gameState.dailyVeinUntil = 0;
        });
        await page.waitForTimeout(200);
        // LCG: детерминизм без паттерна «константа» (ломает UUID Phaser)
        await page.evaluate(() => {
            window.__origRandom = Math.random;
            window.__rs = 7;
            Math.random = () => {
                window.__rs = (window.__rs * 1103515245 + 12345) % 2147483648;
                return 0.05 + (window.__rs / 2147483648) * 0.95;
            };
        });
        // state-модуль: URL из resource-entries (HMR-таймстамп dev-сервера)
        const state = async (expr) => page.evaluate(async (e) => {
            const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n)) || '/src/state.js';
            const m = await import(u);
            return new Function('m', 'return (' + e + ');')(m);
        }, expr);
        // Игровые координаты -> CSS (FIT-масштаб; в ландшафте 1280x720 масштаб 1)
        const livePt = (expr) => page.evaluate((e) => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const p = new Function('ui', 'return (' + e + ');')(ui);
            const sc = window.__GAME.scale;
            return {
                x: p.x * sc.displaySize.width / sc.gameSize.width,
                y: p.y * sc.displaySize.height / sc.gameSize.height
            };
        }, expr);
        const uiState = () => page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                craftOpen: ui._craftOpen,
                rootVisible: ui.craftRoot.visible,
                contentVisible: ui.craftContent.visible,
                camVisible: ui.craftCam.visible,
                locked: window.__GAME.registry.get('blockLocked'),
                mapOpen: ui._mapOpen,
                title: ui.craftTitle.text,
                headerY: ui.craftRoot.y + ui.craftHeader.y,
                compIcons: ui.craftHeader.list.filter((o) => o.type === 'Image').map((o) => o.texture.key),
                compCounts: ui.craftCompRow.map((c) => c.text.text),
                itemIds: Object.keys(ui.craftItemRows),
                recipeIds: Object.keys(ui.craftRecipeRows),
                artIds: Object.keys(ui.craftArtCells),
                // Тексты секций живут в контейнерах-заголовках — обходим рекурсивно
                texts: (() => {
                    const out = [];
                    const walk = (o) => {
                        if (o.list) o.list.forEach(walk);
                        if (o.type === 'Text') out.push(o.text);
                    };
                    walk(ui.craftContent);
                    return out;
                })(),
                view: { x: ui._craftView.x, y: ui._craftView.y, w: ui._craftView.w, h: ui._craftView.h },
                scrollY: ui.craftCam.scrollY,
                contentH: ui._craftContentH
            };
        });
        // Точка кнопки ряда: скроллим контент так, чтобы ряд был виден, и
        // пересчитываем мировые координаты в экранные через craftCam (там же —
        // перевод в CSS-пиксели). Пауза после скролла обязательна: hit-test
        // читает camera.matrix прошлого кадра (у живого игрока такого окна нет —
        // скролл и клик разнесены на кадры)
        const rowPt = async (kind, id, dy = -120) => {
            const pt = await page.evaluate(([k, i, off]) => {
                const ui = window.__GAME.scene.getScene('UIScene');
                const row = (k === 'item' ? ui.craftItemRows[i] : ui.craftRecipeRows[i]);
                const worldY = row.rc.y + row.btn.y;
                const target = Math.max(0, Math.min(worldY + off, ui._craftMaxScroll));
                ui.craftCam.scrollY = target;
                const sc = window.__GAME.scale;
                return {
                    x: (row.btn.x + ui.craftCam.x) * sc.displaySize.width / sc.gameSize.width,
                    y: (worldY - ui.craftCam.scrollY + ui.craftCam.y) * sc.displaySize.height / sc.gameSize.height
                };
            }, [kind, id, dy]);
            await page.waitForTimeout(120);
            return pt;
        };
        const rowInfo = (kind, id) => page.evaluate(([k, i]) => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const row = (k === 'item' ? ui.craftItemRows[i] : ui.craftRecipeRows[i]);
            return {
                btnTex: row.btn.texture.key,
                btnText: row.btnText.text,
                btnColor: row.btnText.style.color,
                sub: row.sub ? row.sub.text : null,
                hint: row.hint ? row.hint.text : null,
                buyTex: row.buyBtn ? row.buyBtn.texture.key : null,
                buyText: row.buyBtnText ? row.buyBtnText.text : null,
                buyColor: row.buyBtnText ? row.buyBtnText.style.color : null,
                desc: row.desc ? row.desc.text : null,
                need: row.needLbl ? row.needLbl.text : null,
                src: row.src ? row.src.text : null,
                status: row.status ? row.status.text : null
            };
        }, [kind, id]);
        const cellInfo = (id) => page.evaluate((i) => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const c = ui.craftArtCells[i];
            return { alpha: c.rc.alpha, line: c.line.text, owned: c._owned };
        }, id);
        const buyPt = async (id, dy = -140) => {
            const pt = await page.evaluate(([i, off]) => {
                const ui = window.__GAME.scene.getScene('UIScene');
                const row = ui.craftItemRows[i];
                const worldY = row.rc.y + row.buyBtn.y;
                const target = Math.max(0, Math.min(worldY + off, ui._craftMaxScroll));
                ui.craftCam.scrollY = target;
                const sc = window.__GAME.scale;
                return {
                    x: (row.buyBtn.x + ui.craftCam.x) * sc.displaySize.width / sc.gameSize.width,
                    y: (worldY - ui.craftCam.scrollY + ui.craftCam.y) * sc.displaySize.height / sc.gameSize.height
                };
            }, [id, dy]);
            await page.waitForTimeout(120);
            return pt;
        };
        const cellPt = (id) => page.evaluate((i) => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const c = ui.craftArtCells[i];
            const worldY = c.rc.y;
            const target = Math.max(0, Math.min(worldY - 120, ui._craftMaxScroll));
            ui.craftCam.scrollY = target;
            const sc = window.__GAME.scale;
            return {
                x: (40 + ui.craftCam.x) * sc.displaySize.width / sc.gameSize.width,
                y: (worldY - ui.craftCam.scrollY + ui.craftCam.y) * sc.displaySize.height / sc.gameSize.height
            };
        }, id).then((pt) => { return page.waitForTimeout(120).then(() => pt); });
        return { page, state, uiState, livePt, rowPt, rowInfo, cellInfo, buyPt, cellPt };
    };

    // ---------- Страница 1: полный цикл (ландшафт) ----------
    {
        const { page, state, uiState, livePt, rowPt, rowInfo, cellInfo, buyPt, cellPt } = await newPage(mkSave(), { width: 1280, height: 720 });

        // A: структура
        const craftBtnPt = await livePt('({ x: ui.craftBtn.x, y: ui.craftBtn.y })');
        const mapBtnPt = await livePt('({ x: ui.mapBtn.x, y: ui.mapBtn.y })');
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(400);
        let s = await uiState();
        check('A1: крафт открыт по HUD-кнопке, lock выставлен',
            s.craftOpen && s.rootVisible && s.contentVisible && s.camVisible && s.locked, JSON.stringify(s));
        check('A2: заголовок «Мастерская», 5 компонентов в шапке',
            s.title === 'Мастерская' && s.compIcons.length === 5
            && ['comp_scrap', 'comp_crystal', 'comp_core', 'comp_relic', 'comp_essence'].every((k) => s.compIcons.includes(k))
            && s.compCounts.length === 5 && s.compCounts.every((t) => t === '0'), JSON.stringify(s.compCounts));
        check('A3: три секции с заголовками', ['Активируемые', 'Рецепты', 'Артефакты'].every((t) => s.texts.includes(t)), s.texts.slice(0, 6).join(' | '));
        check('A4: 7 предметов / 10 рецептов / 9 артефактов',
            s.itemIds.length === 7 && s.recipeIds.length === 10 && s.artIds.length === 9,
            `${s.itemIds.length}/${s.recipeIds.length}/${s.artIds.length}`);
        check('A5: подпись «крафт нельзя отменить» в секции рецептов', s.texts.includes('крафт нельзя отменить'));
        check('A6: шапка компонентов над вьюпортом (зазор >= 4px)',
            s.headerY + 12 <= s.view.y - 4, `headerBottom=${s.headerY + 12} viewTop=${s.view.y}`);
        const bombCell0 = await cellInfo('art_miner_totem');
        const hardCell0 = await cellInfo('art_hardpick');
        check('A7: не-владелец — alpha 0.5 и строка-источник',
            near(bombCell0.alpha, 0.5) && bombCell0.line === 'Босс: Медный страж'
            && near(hardCell0.alpha, 0.5) && hardCell0.line === 'Крафт',
            JSON.stringify({ bomb: bombCell0, hard: hardCell0 }));

        // B: крафт бомбы
        await state('m.gameState.components = { scrap: 12, crystal: 4, core: 3 }');
        await page.waitForTimeout(300);
        s = await uiState();
        check('B1: счётчики шапки обновились диффом',
            s.compCounts.join(',') === '12,4,3,0,0', s.compCounts.join(','));
        let pt = await rowPt('recipe', 'r_bomb');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const bombStock = await state('m.gameState.items.item_bomb');
        check('B2: «Создать» r_bomb дал +2 бомбы, верстак свободен', bombStock === 2 && await state('m.gameState.crafting') === null, String(bombStock));
        s = await uiState();
        check('B3: счётчик лома 8 после списания', s.compCounts[0] === '8', s.compCounts.join(','));
        let ri = await rowInfo('item', 'item_bomb');
        check('B4: бомба вне боя — запас 2, кнопка disabled, «только в бою»',
            ri.sub === 'эффект: урон боссу x2 на 30 сек' && ri.btnTex === 'buy_button_disabled_gray'
            && ri.hint === 'в запасе: 2 · только в бою',
            JSON.stringify(ri));

        // C: пояс — активация и баф x3
        const gps0 = await state('m.getOrePerSecond()'); // 10 (miner 10, без артефактов/бафов)
        pt = await rowPt('recipe', 'r_belt');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        ri = await rowInfo('item', 'item_belt');
        check('C1: пояс скрафчен (кнопка снова «Активировать», запас 1)',
            ri.btnText === 'Активировать' && ri.btnTex === 'buy_button_normal' && ri.hint === 'в запасе: 1', JSON.stringify(ri));
        pt = await rowPt('item', 'item_belt');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const belt = await state('({ n: m.gameState.items.item_belt, mult: m.gameState.miningBuffMult, until: m.gameState.miningBuffUntil > Date.now() })');
        check('C2: пояс активирован (запас 0, miningBuffMult = 3)', belt.n === 0 && belt.mult === 3 && belt.until, JSON.stringify(belt));
        const gps1 = await state('m.getOrePerSecond()');
        check('C3: пассив вырос x3', near(gps1 / gps0, 3), `${gps0} -> ${gps1}`);
        const buffText = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').buffLine.text);
        check('C4: buffLine содержит «x3»', buffText.includes('x3'), buffText);
        ri = await rowInfo('item', 'item_belt');
        check('C5: таймер бафа под рядом пояса «в запасе: 0 · x3 m:ss»', /^в запасе: 0 · x3 \d+:\d{2}$/.test(ri.hint), ri.hint);
        pt = await rowPt('recipe', 'r_coffee');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        ri = await rowInfo('item', 'item_coffee');
        check('C5b: кофе скрафчен (запас 1, таймер слота добычи)', ri.sub === 'эффект: добыча x2 на 5 минут' && /^в запасе: 1 · x3 \d+:\d{2}$/.test(ri.hint), JSON.stringify(ri));
        ri = await rowInfo('item', 'item_coffee');
        check('C6: кофе disabled — слот добычи занят (остаток > 30с)',
            ri.btnTex === 'buy_button_disabled_gray', JSON.stringify(ri));
        const beltDisabled = await rowInfo('item', 'item_belt');
        check('C7: пустой пояс — кнопка снова disabled, таймер слота тикает', beltDisabled.btnTex === 'buy_button_disabled_gray' && /^в запасе: 0 · x3 \d+:\d{2}$/.test(beltDisabled.hint), JSON.stringify(beltDisabled));

        // D: таймированный крафт — «Закалённый бур»
        await state('m.gameState.components = { scrap: 12, crystal: 5, core: 3 }');
        await page.waitForTimeout(300);
        pt = await rowPt('recipe', 'r_hardpick');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const crafting1 = await state('({ id: m.gameState.crafting && m.gameState.crafting.recipeId, endsAt: m.gameState.crafting && m.gameState.crafting.endsAt, now: Date.now() })');
        check('D1: старт «Крафт 10 мин» — верстак занят рецептом бура',
            crafting1.id === 'r_hardpick' && crafting1.endsAt - crafting1.now > 590e3, JSON.stringify(crafting1));
        ri = await rowInfo('recipe', 'r_hardpick');
        check('D2: «Забрать» недоступно — идёт обратный отсчёт на серой кнопке',
            /^\d+:\d{2}$/.test(ri.btnText) && ri.btnTex === 'buy_button_disabled_gray', JSON.stringify(ri));
        ri = await rowInfo('recipe', 'r_bomb');
        check('D3: занятый верстак блокирует прочие рецепты (кнопка серая, «верстак занят»)',
            ri.btnTex === 'buy_button_disabled_gray' && ri.status === 'верстак занят', JSON.stringify(ri));
        const bombStill = await state('m.gameState.items.item_bomb');
        await state('m.gameState.crafting.endsAt = Date.now() - 5');
        await page.waitForTimeout(300);
        ri = await rowInfo('recipe', 'r_hardpick');
        check('D4: после подмотки endsAt — «Забрать» на активной кнопке',
            ri.btnText === 'Забрать' && ri.btnTex === 'buy_button_normal', JSON.stringify(ri));
        pt = await rowPt('recipe', 'r_hardpick', -60);
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const art1 = await state('({ has: m.gameState.artifacts.includes("art_hardpick"), crafting: m.gameState.crafting })');
        check('D5: «Забрать» — артефакт в коллекции, верстак свободен', art1.has && art1.crafting === null, JSON.stringify(art1));
        // art_hardpick даёт bossDamageMult (пассива нет — рост добычи даёт батарея, E2)
        const bossMult = await state('m.getArtifactBonus("bossDamageMult")');
        check('D6: артефакт дал урон боссам x1.25', near(bossMult, 1.25), String(bossMult));
        check('D7: бомбы не задеты крафтом бура', bombStill === 2, String(bombStill));

        // E: батарея — второй таймированный крафт (passiveMult 1.15 — рост добычи)
        await state('m.gameState.components.essence = 1');
        await page.waitForTimeout(200);
        const p1 = await state('m.getOrePerSecond()');
        pt = await rowPt('recipe', 'r_battery');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const crafting2 = await state('m.gameState.crafting && m.gameState.crafting.recipeId');
        check('E1: старт крафта батареи', crafting2 === 'r_battery', String(crafting2));
        await state('m.gameState.crafting.endsAt = Date.now() - 5');
        await page.waitForTimeout(300);
        pt = await rowPt('recipe', 'r_battery', -60);
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const art2 = await state('({ a: m.gameState.artifacts.includes("art_core_battery"), p: m.getOrePerSecond() })');
        check('E2: батарея в коллекции, пассив вырос x1.15', art2.a && near(art2.p / p1, 1.15), `${p1} -> ${art2.p}`);
        const hardCell = await cellInfo('art_hardpick');
        check('E3: ячейка бура стала яркой с desc бонуса',
            near(hardCell.alpha, 1) && hardCell.line === 'урон боссам x1.25' && hardCell.owned === true, JSON.stringify(hardCell));

        // G: покупка предметов за руду (R1, цена-снапшот) + инлайн-подсказки (R5)
        await state('(() => { m.gameState.levels.miner = 0; m.gameState.miningBuffUntil = 0; m.gameState.miningBuffMult = 1; })()');
        await page.waitForTimeout(400);
        const price0 = await state('m.getItemPrice("item_belt")');
        const expectedBuy = await state('`Купить ${m.fmt(m.getItemPrice("item_belt"))}`');
        ri = await rowInfo('item', 'item_belt');
        check('G1: кнопка «Купить N руды» показывает динамическую цену',
            ri.buyText === expectedBuy && ri.buyTex === 'buy_button_normal', `${ri.buyText} vs ${expectedBuy}`);
        check('G1b: строка «Нужно:» и источник компонентов в рецептах',
            (await rowInfo('recipe', 'r_bomb')).desc === 'Получишь: урон боссу x2 на 30 сек'
            && (await rowInfo('recipe', 'r_bomb')).need === 'Нужно:'
            && (await rowInfo('recipe', 'r_bomb')).src === 'дроп: Медный страж'
            && (await rowInfo('recipe', 'r_hardpick')).src === 'крафт',
            JSON.stringify(await rowInfo('recipe', 'r_bomb')));
        // Пары стоимости РИСУЮТСЯ: раньше они добавлялись в контейнер до карточки
        // и перекрывались ею целиком («Нужно:» с пустотой — скриншот игрока).
        // Чек: иконки пар выше карточки по z-order и левее кнопки крафта.
        const pairZ = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const row = ui.craftRecipeRows['r_hardpick'];
            const idx = (o) => row.rc.getIndex(o);
            const cardObj = row.rc.list.find((o) => o.texture && o.texture.key === 'upgrade_row_card_1');
            return row.costPairs.map((p, i) => {
                const iconObj = row.rc.list.filter((o) => o.type === 'Image' && o.texture && o.texture.key.startsWith('comp_'))[i];
                return { id: p.id, aboveCard: idx(iconObj) > idx(cardObj), x: Math.round(p.text.x + p.text.parentContainer.x), txtRight: Math.round(p.text.x + p.text.parentContainer.x + p.text.width), btnLeft: Math.round(row.btn.x - row.btn.displayWidth / 2 + row.rc.x) };
            });
        });
        check('G1c: пары стоимости выше карточки (z-order) и не под кнопкой',
            pairZ.length >= 1 && pairZ.every((p) => p.aboveCard && p.txtRight <= p.btnLeft + 1),
            JSON.stringify(pairZ));
        // Новые боевые предметы (робо-рама / точильный камень): ряды, цены, рецепты
        const rigRow = await rowInfo('item', 'item_rig');
        const oilRow = await rowInfo('item', 'item_oil');
        check('G1d: ряды «Робо-рама»/«Точильный камень» с эффектами и ценой',
            rigRow.sub === 'эффект: урон робо-руки x3 на 30 сек' && /^Купить /.test(rigRow.buyText)
            && oilRow.sub === 'эффект: крит-шанс +25% на 60 сек' && /^Купить /.test(oilRow.buyText),
            JSON.stringify({ rig: rigRow.sub, oil: oilRow.sub }));
        check('G1e: рецепты новых предметов в каталоге (мгновенные)',
            (await rowInfo('recipe', 'r_rig')).desc === 'Получишь: урон робо-руки x3 на 30 сек'
            && (await rowInfo('recipe', 'r_oil')).desc === 'Получишь: крит-шанс +25% на 60 сек',
            '');
        const ore0 = await state('m.gameState.ore');
        pt = await buyPt('item_belt');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const buy1 = await state('({ n: m.gameState.items.item_belt, ore: m.gameState.ore })');
        check('G2: покупка пояса кладёт в стак и списывает цену-снапшот',
            buy1.n === 1 && buy1.ore === ore0 - price0, `ore ${ore0} -> ${buy1.ore}, price ${price0}`);
        ri = await rowInfo('item', 'item_belt');
        check('G3: подсказка показала новый запас', ri.hint === 'в запасе: 1', ri.hint);
        await state('m.gameState.ore = 1');
        await page.waitForTimeout(300);
        ri = await rowInfo('item', 'item_belt');
        check('G4: при нехватке руды кнопка покупки серая', ri.buyTex === 'buy_button_disabled_gray', JSON.stringify(ri));
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const nG5 = await state('m.gameState.items.item_belt');
        check('G5: клик по серой кнопке покупки не покупает', nG5 === 1, String(nG5));
        ri = await rowInfo('item', 'item_belt');
        check('G6: инлайн-подсказка «не хватает руды» красным', ri.hint === 'не хватает руды', ri.hint);
        await page.waitForTimeout(2300);
        ri = await rowInfo('item', 'item_belt');
        check('G7: подсказка ошибки исчезла через 2с', ri.hint === 'в запасе: 1', ri.hint);
        await state('(() => { m.gameState.ore = 1e9; m.gameState.items.item_belt = 5; })()');
        await page.waitForTimeout(300);
        ri = await rowInfo('item', 'item_belt');
        check('G8: полный стак — покупка заблокирована', ri.buyTex === 'buy_button_disabled_gray' && ri.hint === 'в запасе: 5', JSON.stringify(ri));
        ri = await rowInfo('item', 'item_ration');
        check('G9: пустой ряд — «нет предмета» красным', ri.hint === 'нет предмета' && ri.btnTex === 'buy_button_disabled_gray', JSON.stringify(ri));
        let cpt = await cellPt('art_miner_totem');
        await page.mouse.click(cpt.x, cpt.y);
        await page.waitForTimeout(300);
        let ci = await cellInfo('art_miner_totem');
        check('G10: тап по серой ячейке — инлайн «Получишь у босса: …»', ci.line === 'Получишь у босса: Медный страж', ci.line);
        await page.waitForTimeout(2300);
        ci = await cellInfo('art_miner_totem');
        check('G11: ячейка вернулась к строке-источнику', ci.line === 'Босс: Медный страж', ci.line);

        // F: лок и конфликты updateBlockLock
        const closePt = await livePt('({ x: ui.craftRoot.x + ui.craftClose.x, y: ui.craftRoot.y + ui.craftClose.y })');
        await page.mouse.click(closePt.x, closePt.y);
        await page.waitForTimeout(300);
        s = await uiState();
        check('F1: закрытие крафта крестиком сняло lock', !s.craftOpen && !s.rootVisible && !s.contentVisible && !s.locked, JSON.stringify({ open: s.craftOpen, locked: s.locked }));
        const s0 = await state('m.gameState.ore');
        await page.mouse.click(400, 400);
        await page.waitForTimeout(300);
        check('F2: блок добывает после закрытия крафта', await state('m.gameState.ore') > s0, `${s0} -> `);
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(300);
        s = await uiState();
        check('F3: повторное открытие — состояние рядов актуально',
            s.craftOpen && s.locked && s.compCounts.join(',') === '12,2,0,0,0', s.compCounts.join(','));
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y); // кнопка «Карта» при открытом крафте
        await page.waitForTimeout(300);
        s = await uiState();
        check('F4: карта не открывается под lock крафта', !s.mapOpen && s.craftOpen && s.locked, JSON.stringify({ mapOpen: s.mapOpen, craftOpen: s.craftOpen }));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeCraft());
        await page.waitForTimeout(300);
        check('F5: после closeCraft лок снят', await page.evaluate(() => !window.__GAME.registry.get('blockLocked')));
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(300);
        s = await uiState();
        check('F6: карта открылась после закрытия крафта, lock держит карта', s.mapOpen && s.locked && !s.craftOpen, JSON.stringify({ mapOpen: s.mapOpen, craftOpen: s.craftOpen, locked: s.locked }));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeMap());
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').showBossRewardModal({ bounty: 5, comps: {}, artifactId: null }));
        await page.waitForTimeout(300);
        let lockedState = await page.evaluate(() => ({
            locked: window.__GAME.registry.get('blockLocked'),
            reward: window.__GAME.scene.getScene('UIScene')._bossRewardOpen
        }));
        check('F7: окно награды босса держит lock', lockedState.locked && lockedState.reward, JSON.stringify(lockedState));
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(300);
        check('F8: крафт не открывается под lock награды', await page.evaluate(() => !window.__GAME.scene.getScene('UIScene')._craftOpen));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideBossRewardModal());
        await page.waitForTimeout(300);
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(300);
        check('F9: после закрытия награды крафт открывается (конфликтов нет)',
            await page.evaluate(() => {
                const ui = window.__GAME.scene.getScene('UIScene');
                return ui._craftOpen && window.__GAME.registry.get('blockLocked') && !ui._bossRewardOpen;
            }));

        await page.close();
    }

    // ---------- Страница 2: портрет 390x844 (геометрия) ----------
    {
        const { page, state, uiState, rowPt, livePt } = await newPage(mkSave({ components: { scrap: 12, crystal: 4, core: 3 } }), { width: 390, height: 844 });
        const craftPt = await livePt('({ x: ui.craftBtn.x, y: ui.craftBtn.y })');
        await page.mouse.click(craftPt.x, craftPt.y);
        await page.waitForTimeout(400);
        const s = await uiState();
        check('P1: портрет — экран собран, вьюпорт в границах сетки',
            s.craftOpen && s.view.w > 100 && s.view.h > 100 && s.view.y + s.view.h <= 1558
            && s.itemIds.length === 7 && s.recipeIds.length === 10, JSON.stringify(s.view));
        check('P2: портрет — ряды пересобраны под широкие карточки', s.view.w > 500, String(s.view.w));
        const pt = await rowPt('recipe', 'r_bomb');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(300);
        const stock = await state('m.gameState.items.item_bomb');
        check('P3: портрет — крафт бомбы работает тапом', stock === 2, String(stock));
        await page.close();
    }

    console.log(`page errors: ${errors.length ? errors.join(' | ') : '0'}`);
    console.log(`итого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(errors.length || failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
