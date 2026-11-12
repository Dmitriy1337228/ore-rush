// Проверка фонов локаций: 12 пиксель-арт фонов (по одному на тир), старт = фон тира,
// кроссфейд 800мс при смене тира (bgNext проявляется поверх bgCurrent), no-op при том же тире,
// затемнение поверх фона, «Полный сброс» возвращает bg_01_coal, пиксельный чек смены фона.
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) passed++; else failed++;
}

const BG_KEYS = ['bg_01_coal', 'bg_02_copper', 'bg_03_iron', 'bg_04_silver', 'bg_05_gold', 'bg_06_amethyst', 'bg_07_emerald', 'bg_08_ruby', 'bg_09_sapphire', 'bg_10_platinum', 'bg_11_uranium', 'bg_12_diamond'];

(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // Свежий забег, тир 0 (уголь)
    const save = JSON.stringify({ version: 2, ore: 0, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'minecraft-clicker-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // HMR-инвалидация: резолвим фактический URL state.js из resource entries
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

    const bg = () => page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        return {
            exists: ['bg_01_coal', 'bg_02_copper', 'bg_03_iron', 'bg_04_silver', 'bg_05_gold', 'bg_06_amethyst', 'bg_07_emerald', 'bg_08_ruby', 'bg_09_sapphire', 'bg_10_platinum', 'bg_11_uranium', 'bg_12_diamond'].map(k => window.__GAME.textures.exists(k)),
            curKey: gs.bgCurrent.texture.key,
            curAlpha: gs.bgCurrent.alpha,
            curVisible: gs.bgCurrent.visible,
            nextKey: gs.bgNext.texture.key,
            nextAlpha: gs.bgNext.alpha,
            nextVisible: gs.bgNext.visible,
            shade: gs.bgShade.fillAlpha
        };
    });

    // --- A: загрузка и старт ---
    let r = await bg();
    check('A1: 6 фонов-текстур загружены', r.exists.every(Boolean), r.exists.join(','));
    check('A2: стартовый фон = bg_01 (тир 0)', r.curKey === 'bg_01_coal', r.curKey);
    check('A3: bgCurrent видимый, alpha 1', r.curVisible && Math.abs(r.curAlpha - 1) < 0.01);
    check('A4: bgNext скрыт', !r.nextVisible, `alpha=${r.nextAlpha}`);
    check('A5: затемнение 0.32', Math.abs(r.shade - 0.32) < 0.001, String(r.shade));

    // --- B: кроссфейд на тир 5 (золото) ---
    await state('m.gameState.tier = 4');
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(250);
    r = await bg();
    check('B1: в середине кроссфейда bgNext = bg_03 и видимый', r.nextVisible && r.nextKey === 'bg_05_gold', `${r.nextKey} alpha=${r.nextAlpha.toFixed(2)}`);
    check('B2: bgNext ещё проявляется (0 < alpha < 1)', r.nextAlpha > 0.01 && r.nextAlpha < 0.99, String(r.nextAlpha.toFixed(2)));
    check('B3: старый фон ещё снизу', r.curKey === 'bg_01_coal', r.curKey);
    await page.waitForTimeout(1100);
    r = await bg();
    check('C1: после кроссфейда bgCurrent = bg_03', r.curKey === 'bg_05_gold', r.curKey);
    check('C2: bgCurrent alpha 1, видимый', r.curVisible && Math.abs(r.curAlpha - 1) < 0.01);
    check('C3: bgNext скрыт', !r.nextVisible);

    // --- D: тот же тир повторно — no-op ---
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(100);
    r = await bg();
    check('D1: повторный tier-changed без смены — фон не трогается', r.curKey === 'bg_05_gold' && !r.nextVisible);

    // --- E: путь «Полного сброса» — тир 0 -> bg_01 ---
    await state('m.gameState.tier = 0');
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(1200);
    r = await bg();
    check('E1: сброс на тир 0 возвращает bg_01', r.curKey === 'bg_01_coal', r.curKey);

    // --- G: визуальный чек (регион без блока/HUD/кнопок — только фон).
    // Свойства (texture/alpha/visible) не ловят «фон стоит, но нарисован ПОД
    // непрозрачным градиентом» — сравниваем пиксели клипа до/после смены тира.
    const clip = { x: 620, y: 545, width: 120, height: 55 };
    const shot0 = await page.screenshot({ clip });
    await state('m.gameState.tier = 4');
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(1300);
    const shot4 = await page.screenshot({ clip });
    let diff = 0;
    for (let i = 0; i < shot0.length; i++) if (shot0[i] !== shot4[i]) diff++;
    check('G1: фон реально меняется на экране (пиксели клипа различаются)', diff > shot0.length * 0.1, `${diff}/${shot0.length} байт`);

    // --- H: двойная смена тира во время кроссфейда — незавершённый фейд
    // мгновенно доводится до конца, новая смена стартует с полного альфа-состояния
    await state('m.gameState.tier = 0');
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(1200);
    await state('m.gameState.tier = 4');
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(150);
    await state('m.gameState.tier = 8');
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').game.events.emit('tier-changed'));
    await page.waitForTimeout(120);
    r = await bg();
    check('H1: прерванный фейд мгновенно завершён (bg_05_gold стал текущим)', r.curKey === 'bg_05_gold' && r.curAlpha > 0.5, `${r.curKey} alpha=${r.curAlpha.toFixed(2)}`);
    check('H2: новый кроссфейд к bg_09_sapphire идёт', r.nextVisible && r.nextKey === 'bg_09_sapphire' && r.nextAlpha > 0 && r.nextAlpha < 1, `alpha=${r.nextAlpha.toFixed(2)}`);
    await page.waitForTimeout(1100);
    r = await bg();
    check('H3: после двойной смены текущий = bg_09_sapphire', r.curKey === 'bg_09_sapphire' && !r.nextVisible, r.curKey);

    check('F: page errors', errors.length === 0, errors.join('; ').slice(0, 300));

    await b.close();
    console.log(`\nИтого: ${passed} OK, ${failed} FAIL`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
