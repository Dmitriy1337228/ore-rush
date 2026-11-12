// Проверка мультипокупки v2: x1/x10/x100 — СТРОГИЕ пакеты (либо весь пакет, либо
// ничего; ужимается только лимитом уровней улучшения), МАКС — максимум доступного.
// Проверяется и чистая экономика state.js, и UI (цикл кнопки, текстуры, цены, клики).
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
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Свежий забег: кирка 5 (клик = 6), остальное 0
    const save = JSON.stringify({ version: 2, ore: 0, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'minecraft-clicker-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // ВАЖНО: dev-сервер инвалидирует модули HMR-таймстампом — резолвим фактический URL
    const state = async (expr) => {
        const u = await page.evaluate(() => {
            const hit = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
            return hit || '/src/state.js';
        });
        return page.evaluate(async ({ u, e }) => {
            const m = await import(u);
            return new Function('m', 'return (' + e + ');')(m);
        }, { u, e: expr });
    };
    const snap = async () => state(`({ ore: m.gameState.ore, lvl: m.gameState.levels.pickaxe })`);
    const setOre = (v) => state(`m.gameState.ore = ${v}, m.gameState.ore`);
    const setLvl = (v) => state(`m.gameState.levels.pickaxe = ${v}, m.gameState.levels.pickaxe`);
    const buy = (want) => state(`m.buyBulk('pickaxe', ${JSON.stringify(want)})`);

    // ---------- Экономика: строгие пакеты ----------
    // Кирка: base 15, growth 2.0, кап 30. Стоимость уровней 5..14 (10 шт) = 15*(2^15-2^5) = 491040
    const bundle10 = await state(`m.getBulkCost('pickaxe', 10)`);
    check('x10: пакет = 10 уровней', bundle10.n === 10, `n=${bundle10.n}`);
    check('x10: стоимость пакета 491040', bundle10.total === 491040, `total=${bundle10.total}`);

    await setOre(bundle10.total);
    check('x10: ровно на пакет — покупается', (await buy(10)) === true);
    let s = await snap();
    check('x10: уровень +10', s.lvl === 15, `lvl=${s.lvl}`);
    check('x10: руда списана до 0', s.ore === 0, `ore=${s.ore}`);

    await setLvl(5);
    await setOre(bundle10.total - 1);
    const before = await snap();
    check('x10: на 1 меньше — ОТКАЗ (без частичной покупки)', (await buy(10)) === false);
    s = await snap();
    check('x10: отказ не меняет уровень', s.lvl === before.lvl, `lvl=${s.lvl}`);
    check('x10: отказ не тратит руду', s.ore === before.ore, `ore=${s.ore}`);

    // x100: кап кирки 30 — от уровня 5 пакет ужимается до 25 уровней
    const bundle100 = await state(`m.getBulkCost('pickaxe', 100)`);
    check('x100: пакет ужимается лимитом до 25', bundle100.n === 25, `n=${bundle100.n}`);
    await setOre(bundle100.total);
    check('x100: ровно на пакет — покупается', (await buy(100)) === true);
    s = await snap();
    check('x100: уровень +25 (до капа)', s.lvl === 30, `lvl=${s.lvl}`);
    check('x100: руда списана до 0', s.ore === 0, `ore=${s.ore}`);

    await setLvl(5);
    await setOre(bundle100.total - 1);
    check('x100: на 1 меньше — ОТКАЗ', (await buy(100)) === false);
    s = await snap();
    check('x100: отказ не меняет уровень', s.lvl === 5, `lvl=${s.lvl}`);

    // ---------- Экономика: МАКС ----------
    await setLvl(5);
    await setOre(491040); // ровно на 10 уровней
    check('МАКС: хватает на 10 — покупает 10', (await buy('max')) === true);
    s = await snap();
    check('МАКС: уровень +10', s.lvl === 15, `lvl=${s.lvl}`);
    check('МАКС: руда до 0', s.ore === 0, `ore=${s.ore}`);

    // МАКС с неполным бюджетом: на 4 уровня (480+960+1920+3840=7200)
    await setLvl(5);
    await setOre(7200);
    check('МАКС: частичный бюджет — покупает сколько хватает', (await buy('max')) === true);
    s = await snap();
    check('МАКС: уровень +4', s.lvl === 9, `lvl=${s.lvl}`);
    check('МАКС: руда до 0', s.ore === 0, `ore=${s.ore}`);

    // МАКС у капа: уровень 28 (остаток 2), руды с горой — докупает ровно 2
    await setLvl(28);
    await setOre(1e12);
    check('МАКС: у капа докупает остаток', (await buy('max')) === true);
    s = await snap();
    check('МАКС: уровень = кап 30', s.lvl === 30, `lvl=${s.lvl}`);
    check('МАКС: максед — повторная покупка отклоняется', (await buy('max')) === false);

    // x1: прежнее поведение
    await setLvl(5);
    await setOre(480);
    check('x1: ровно на 1 уровень — покупается', (await buy(1)) === true);
    s = await snap();
    check('x1: уровень +1', s.lvl === 6, `lvl=${s.lvl}`);

    // ---------- UI ----------
    await setLvl(5);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const ui = () => page.evaluate(() => {
        const sc = window.__GAME.scene.getScene('UIScene');
        const row = sc.rows.find(r => r.def.id === 'pickaxe');
        return { amount: sc.amountLbl.text, btnTex: row.btn.texture.key, btnText: row.btnText.text, price: row.priceText.text, priceVisible: row.priceText.visible };
    });
    const clickAmount = () => page.evaluate(() => {
        const sc = window.__GAME.scene.getScene('UIScene');
        sc.amountLbl.parentContainer.emit('pointerdown');
    });
    const clickRowBuy = () => page.evaluate(() => {
        const sc = window.__GAME.scene.getScene('UIScene');
        sc.rows.find(r => r.def.id === 'pickaxe').btn.emit('pointerdown');
    });

    let u = await ui();
    check('UI: старт x1', u.amount === 'x1', u.amount);
    await clickAmount();
    u = await ui();
    check('UI: цикл -> x10', u.amount === 'x10', u.amount);
    await clickAmount();
    u = await ui();
    check('UI: цикл -> x100', u.amount === 'x100', u.amount);
    await clickAmount();
    u = await ui();
    check('UI: цикл -> МАКС', u.amount === 'МАКС', u.amount);
    await clickAmount();
    u = await ui();
    check('UI: цикл замкнулся -> x1', u.amount === 'x1', u.amount);

    // x10 в UI: не хватает на пакет — кнопка серая, цена = ЦЕНА ПАКЕТА (не 1 уровня)
    await clickAmount(); // x10
    await setOre(480);   // только 1 уровень
    u = await ui();
    const expectBundle = await state(`m.fmt(m.getBulkCost('pickaxe', 10).total)`);
    check('UI x10: не хватает — кнопка серая', u.btnTex === 'buy_button_disabled_gray', u.btnTex);
    check('UI x10: цена показывает пакет', u.price === expectBundle, `price=${u.price}, expect=${expectBundle}`);
    await clickRowBuy();
    s = await snap();
    check('UI x10: клик по серой кнопке НЕ покупает', s.lvl === 5, `lvl=${s.lvl}`);

    // МАКС в UI: тот же бюджет — кнопка активна, покупает 1
    await clickAmount(); // x100
    await clickAmount(); // МАКС
    u = await ui();
    check('UI МАКС: хватает на 1 — кнопка активна', u.btnTex === 'buy_button_normal', u.btnTex);
    await clickRowBuy();
    s = await snap();
    check('UI МАКС: клик покупает доступное (+1)', s.lvl === 6, `lvl=${s.lvl}`);

    // x10 в UI: хватает ровно на пакет — покупает 10
    await clickAmount(); // x1
    await clickAmount(); // x10
    await setLvl(5);
    await setOre(491040);
    await clickRowBuy();
    s = await snap();
    check('UI x10: ровно на пакет — покупает 10', s.lvl === 15, `lvl=${s.lvl}`);

    check('page errors', errors.length === 0, errors.join('; '));
    console.log(`\nИтого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
