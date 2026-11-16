// Проверка РЕАЛЬНОГО возврата во вкладку (visibilitychange, без перезагрузки
// страницы — как сворачивание мобильного вебвью Яндекса). Ветка visible раньше
// не выполнялась ни одним тестом, и баг перезаписи lastExit до чтения ([1]
// ревью 2026-11-13) не ловил никто. С 2026-11-16: heartbeat счётчика офлайна
// в автосейве + перезапуск счётчика при загрузке (чеки 7/8) — штамп от
// несработавшего hidden/beforeunload больше не даёт «72 ч» вместо минут.
// Dev-сервер поднимается сам.
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('../lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    let failed = 0;
    const origLog = console.log;
    console.log = (...a) => {
        if (String(a.join(' ')).includes('FAIL')) {
            failed++;
        }

        origLog(...a);
    };
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const stateUrl = await page.evaluate(() =>
        performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'))
    );
    // Шахтёр 100 -> пассив 100/с; сеем lastExit «2 часа назад» в оба хранилища
    // (как при уходе со страницы) и РЕАЛЬНО эмитим visibilitychange ОДНИМ
    // evaluate-таском: heartbeat автосейва (тик раз в 5с) не может вклиниться
    // между посевом и чтением видимой ветки
    await page.evaluate(async (url) => {
        const m = await import(url);
        m.gameState.levels.miner = 100;
        m.saveGame();
        const exit = Date.now() - 2 * 3600 * 1000;
        localStorage.setItem('ore-rush-lastExit', String(exit));
        localStorage.setItem('mockStats', JSON.stringify({ lastExit: exit }));
        document.dispatchEvent(new Event('visibilitychange'));
    }, stateUrl);
    await page.waitForTimeout(800);

    const st = await page.evaluate(async (url) => {
        const m = await import(url);
        const ui = window.__GAME.scene.getScene('UIScene');

        return {
            ore: m.gameState.ore,
            lastExit: localStorage.getItem('ore-rush-lastExit'),
            modal: ui.offlineModal.visible
        };
    }, stateUrl);

    // 1. Начисление: 2ч x 20% x gps 100 = 144000 руды (тик пассива даёт сверху ~100-200)
    console.log('1. offline credited on visible:', st.ore >= 144000 ? `OK (ore=${st.ore})` : `FAIL (ore=${st.ore})`);
    // 2. lastExit перезаписан на «сейчас» — начат новый отсчёт
    console.log(
        '2. lastExit restarted:',
        st.lastExit && Number(st.lastExit) > Date.now() - 60 * 1000 ? 'OK' : `FAIL (${st.lastExit})`
    );
    // 3. Модалка офлайна открылась (тот же путь, что и симуляция DevPanel)
    console.log('3. offline modal shown:', st.modal ? 'OK' : 'FAIL');

    // 4. Быстрый тоггл hidden->visible (без 5 минут) не даёт повторного начисления
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    const ore2 = await page.evaluate(async (url) => (await import(url)).gameState.ore, stateUrl);
    console.log('4. quick toggle: no double credit:', ore2 === st.ore ? 'OK' : `FAIL (${st.ore} -> ${ore2})`);

    // 5. page errors
    console.log('5. page errors:', errors.length ? `FAIL (${errors.join(' | ')})` : 'OK (0)');
    if (errors.length) {
        failed++;
    }

    // 6. МИГРАЦИЯ со старого имени игры (переименование 2026-11-13): сейв и
    // lastExit под СТАРЫМИ ключами читаются, зеркало создаётся под новым
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page2 = await ctx2.newPage();
    const errors2 = [];
    page2.on('pageerror', (e) => errors2.push(String(e)));
    const legacySave = JSON.stringify({
        version: 4,
        ore: 12345,
        tier: 0,
        stars: 0,
        clicks: 0,
        lifetimeMined: 12345,
        tierEarned: new Array(12).fill(0),
        levels: { miner: 3 }
    });
    const legacyExit = Date.now() - 3600 * 1000;
    await page2.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        },
        {
            'minecraft-clicker-save': legacySave,
            'minecraft-clicker-lastExit': String(legacyExit),
            mockStats: JSON.stringify({ lastExit: legacyExit })
        }
    );
    await page2.goto('http://localhost:5174', { waitUntil: 'load' });
    await page2.waitForTimeout(3000);
    const mig = await page2.evaluate(async (url) => {
        const m = await import(url);

        return {
            ore: m.gameState.ore,
            miner: m.gameState.levels.miner,
            newKey: localStorage.getItem('ore-rush-save'),
            offlineModal: window.__GAME.scene.getScene('UIScene').offlineModal.visible
        };
    }, stateUrl);
    console.log(
        '6. legacy migration: save applied:',
        mig.ore >= 12345 && mig.miner === 3
            ? `OK (ore=${mig.ore}, miner=${mig.miner})`
            : `FAIL (ore=${mig.ore}, miner=${mig.miner})`
    );
    console.log('6a. legacy migration: new key mirrored:', mig.newKey ? 'OK' : 'FAIL');
    console.log('6b. legacy lastExit -> offline modal:', mig.offlineModal ? 'OK' : 'FAIL');
    if (errors2.length) {
        console.log(`6c. page errors: FAIL (${errors2.join(' | ')})`);
        failed++;
    }

    await ctx2.close();

    // 7. АНТИ-ПРИЗРАК при загрузке: 72-часовой штамп от старого сеанса (kill
    // процесса / вебвью без hidden и beforeunload) начисляется ОДИН раз, счётчик
    // перезапускается; повторная загрузка без офлайн-событий не начисляет снова
    const ctx3 = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page3 = await ctx3.newPage();
    const errors3 = [];
    page3.on('pageerror', (e) => errors3.push(String(e)));
    const v4Save = JSON.stringify({
        version: 4,
        ore: 1000,
        tier: 0,
        stars: 0,
        clicks: 0,
        lifetimeMined: 1000,
        tierEarned: new Array(12).fill(0),
        levels: { miner: 3 }
    });
    const ghostExit = Date.now() - 72 * 3600 * 1000;
    // Посев ОДНОРАЗОВЫЙ (флаг в sessionStorage): addInitScript срабатывает на
    // каждой навигации, и без флага reload в 7b заново сеял бы призрачный штамп
    await page3.addInitScript(
        (s) => {
            if (sessionStorage.getItem('__offlineSeeded')) {
                return;
            }

            sessionStorage.setItem('__offlineSeeded', '1');
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        },
        {
            'ore-rush-save': v4Save,
            'ore-rush-lastExit': String(ghostExit),
            mockStats: JSON.stringify({ lastExit: ghostExit })
        }
    );
    await page3.goto('http://localhost:5174', { waitUntil: 'load' });
    await page3.waitForTimeout(3000);
    const g1 = await page3.evaluate(async (url) => {
        const m = await import(url);

        return {
            ore: m.gameState.ore,
            modal: window.__GAME.scene.getScene('UIScene').offlineModal.visible,
            lastExit: Number(localStorage.getItem('ore-rush-lastExit'))
        };
    }, stateUrl);
    console.log(
        '7. ghost 72h credited once at load:',
        g1.modal && g1.ore >= 8000 ? `OK (ore=${g1.ore})` : `FAIL (ore=${g1.ore}, modal=${g1.modal})`
    );
    console.log('7a. counter restarted at load:', g1.lastExit > Date.now() - 10000 ? 'OK' : `FAIL (${g1.lastExit})`);
    const oreBeforeReload = g1.ore;
    // addInitScript пересеивал бы штамп при каждой навигации — перед reload
    // кладём свежий штамп вручную: обычная перезагрузка (hidden/beforeunload
    // отработали) не должна давать повторного начисления
    await page3.evaluate(() => {
        const now = String(Date.now());
        localStorage.setItem('ore-rush-lastExit', now);
        localStorage.setItem('mockStats', JSON.stringify({ lastExit: Number(now) }));
    });
    await page3.reload({ waitUntil: 'load' });
    await page3.waitForTimeout(2500);
    const g2 = await page3.evaluate(async (url) => {
        const m = await import(url);

        return {
            ore: m.gameState.ore,
            modal: window.__GAME.scene.getScene('UIScene').offlineModal.visible
        };
    }, stateUrl);
    // пассив тикает — допуск 1000; офлайн-повторное начисление дало бы +155K
    console.log(
        '7b. reload: no double credit:',
        g2.ore < oreBeforeReload + 1000 && !g2.modal
            ? `OK (ore ${oreBeforeReload} -> ${g2.ore})`
            : `FAIL (ore ${oreBeforeReload} -> ${g2.ore}, modal=${g2.modal})`
    );
    if (errors3.length) {
        console.log(`7c. page errors: FAIL (${errors3.join(' | ')})`);
        failed++;
    }

    // 8. HEARTBEAT счётчика: штамп, посеянный «2 часа назад» при живой вкладке,
    // автосейв перезаписывает на свежий за 5с — kill процесса оставляет штамп
    // максимум 5-секундной давности, а не недельной
    const exit2h = Date.now() - 2 * 3600 * 1000;
    await page3.evaluate((t) => {
        localStorage.setItem('ore-rush-lastExit', String(t));
        localStorage.setItem('mockStats', JSON.stringify({ lastExit: t }));
    }, exit2h);
    await page3.waitForTimeout(6500);
    const hb = await page3.evaluate(async (url) => {
        const m = await import(url);

        return { lastExit: Number(localStorage.getItem('ore-rush-lastExit')), ore: m.gameState.ore };
    }, stateUrl);
    console.log(
        '8. heartbeat refreshes lastExit:',
        hb.lastExit > exit2h + 4000 ? 'OK' : `FAIL (${hb.lastExit} vs seeded ${exit2h})`
    );
    // 8a. возврат во вкладку со СВЕЖИМ штампом не начисляет офлайн
    await page3.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page3.waitForTimeout(600);
    const hb2 = await page3.evaluate(async (url) => {
        const m = await import(url);

        return { ore: m.gameState.ore, modal: window.__GAME.scene.getScene('UIScene').offlineModal.visible };
    }, stateUrl);
    console.log(
        '8a. fresh stamp: no offline credit:',
        !hb2.modal && hb2.ore < hb.ore + 1000
            ? `OK (ore ${hb.ore} -> ${hb2.ore})`
            : `FAIL (ore ${hb.ore} -> ${hb2.ore}, modal=${hb2.modal})`
    );
    if (errors3.length) {
        console.log(`8b. page errors: FAIL (${errors3.join(' | ')})`);
        failed++;
    }

    await ctx3.close();

    await b.close();
    console.log(failed === 0 ? 'verify-offline: ВСЕ ЧЕКИ ЗЕЛЁНЫЕ' : `verify-offline: ПРОВАЛОВ ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
