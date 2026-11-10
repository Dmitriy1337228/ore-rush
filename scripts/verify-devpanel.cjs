// Проверка DevPanel: активация, ресурсы, тиры, офлайн-симуляция, полный сброс.
// Dev-сервер поднимается сам и гасится после проверки (чужой не трогается).
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const panelVisible = () => page.evaluate(() => {
        const p = document.getElementById('dev-admin-panel');
        return p ? p.style.display !== 'none' : false;
    });
    const panelState = () => page.evaluate(() => JSON.parse(document.querySelector('#dev-admin-panel .dev-state').textContent));

    // 1. Панель скрыта по умолчанию
    console.log('1. hidden by default:', !(await panelVisible()) ? 'OK' : 'FAIL');

    // 2. Backquote открывает
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    console.log('2. Backquote opens:', (await panelVisible()) ? 'OK' : 'FAIL');

    // 3. +1M прибавляет ресурсы
    const before = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').coalText.text);
    await page.click('#dev-admin-panel button:has-text("+1M")');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').coalText.text);
    console.log('3. +1M works:', (before !== after) ? `OK (${before} -> ${after})` : 'FAIL');

    // 4. Макс всё: динамит на макс, бесконечные на 50 (кирка/шахтёр не ограничены)
    await page.click('#dev-admin-panel button:has-text("Макс всё")');
    await page.waitForTimeout(300);
    const st1 = await panelState();
    console.log('4. max all:', (st1.levels.pickaxe === 50 && st1.levels.dynamite === 23 && st1.levels.miner === 50) ? `OK (pickaxe=${st1.levels.pickaxe}, dynamite=${st1.levels.dynamite}, miner=${st1.levels.miner})` : `FAIL (pickaxe=${st1.levels.pickaxe}, dynamite=${st1.levels.dynamite}, miner=${st1.levels.miner})`);

    // 5. След. тир: принудительный переход (без оплаты)
    await page.click('#dev-admin-panel button:has-text("След. тир")');
    await page.waitForTimeout(400);
    const tierText = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').tierLabel.text);
    console.log('5. force tier:', tierText.includes('2') ? `OK (${tierText})` : `FAIL (${tierText})`);
    await page.screenshot({ path: 'shots_devpanel/01_tier2_maxed.png' });

    // 6. Офлайн 4ч: та же логика, что и реальный возврат во вкладку
    await page.click('#dev-admin-panel button:has-text("Офлайн 4ч")');
    await page.waitForTimeout(500);
    const modalShown = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').offlineModal.visible);
    console.log('6. offline sim modal:', modalShown ? 'OK' : 'FAIL');
    await page.screenshot({ path: 'shots_devpanel/02_offline_sim.png' });
    await page.click('canvas', { position: { x: 640, y: 456 } }); // Забрать
    await page.waitForTimeout(300);
    const modalClosed = await page.evaluate(() => !window.__GAME.scene.getScene('UIScene').offlineModal.visible);
    console.log('6b. modal closed after claim:', modalClosed ? 'OK' : 'FAIL');

    // 7. Ресурсы обнуляются до 0
    await page.click('#dev-admin-panel button:has-text("Ресурсы в 0")');
    await page.waitForTimeout(300);
    const st2 = await panelState();
    console.log('7. ore reset:', st2.ore === 0 ? 'OK' : `FAIL (${st2.ore})`);

    // 7b. Полный сброс: руда/тир/звёзды/улучшения на нули, блок угольный
    await page.click('#dev-admin-panel button:has-text("Полный сброс")');
    await page.waitForTimeout(400);
    const st3 = await panelState();
    const blockKey = await page.evaluate(() => window.__GAME.scene.getScene('GameScene').block.texture.key);
    const okReset = st3.ore === 0 && st3.tier === 0 && st3.stars === 0 && st3.levels.pickaxe === 0
        && st3.levels.miner === 0 && blockKey === 'block_stage_1_intact';
    console.log('7b. full reset:', okReset ? 'OK' : `FAIL (${JSON.stringify({ st3, blockKey })})`);

    // 8. JSON состояния сериализуется
    const jsonOk = await page.evaluate(() => {
        const t = document.querySelector('#dev-admin-panel .dev-state').textContent;
        try { const o = JSON.parse(t); return typeof o.ore === 'number' && typeof o.levels === 'object'; } catch (e) { return false; }
    });
    console.log('8. state JSON:', jsonOk ? 'OK' : 'FAIL');

    // 9. Shift+D закрывает панель
    await page.keyboard.press('Shift+KeyD');
    await page.waitForTimeout(200);
    console.log('9. Shift+D closes:', !(await panelVisible()) ? 'OK' : 'FAIL');

    // 10. Скрытая зона 20x20 в углу открывает панель
    await page.click('#dev-click-zone');
    await page.waitForTimeout(200);
    console.log('10. click zone opens:', (await panelVisible()) ? 'OK' : 'FAIL');
    await page.screenshot({ path: 'shots_devpanel/03_panel_state.png' });

    console.log('page errors:', errors.length ? errors.join(' | ') : '0');
    await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
