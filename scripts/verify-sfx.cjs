// Проверка звуков: ключи собираются из assets/audio (единый источник — файлы),
// воспроизведение не падает, клики/покупка/мутация звучат.
// Dev-сервер поднимается сам и гасится после проверки (чужой не трогается).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');
const SFX = [...new Set(
    fs.readdirSync(path.join(__dirname, '..', 'assets', 'audio'))
        .filter((f) => /\.(ogg|mp3)$/.test(f))
        .map((f) => f.replace(/\.(ogg|mp3)$/, ''))
)];
(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    // Счётчик FAIL — раньше скрипт завершался безусловно с кодом 0, регрессия не роняла прогон
    let failed = 0;
    const origLog = console.log;
    console.log = (...args) => {
        const s = args.map(String).join(' ');
        if (s.includes('FAIL')) failed++;
        origLog(...args);
    };
    const b = await chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    // Свежий сейв выдаёт дневную награду — модалка с затемнением блокирует
    // canvas-клики (настройки/покупки); закрываем, награда уже применена
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(300);

    // 1. Все ключи из assets/audio в audio-кэше
    const missing = await page.evaluate((keys) => keys.filter((k) => !window.__GAME.scene.getScene('GameScene').cache.audio.exists(k)), SFX);
    console.log(`1. all ${SFX.length} keys in cache:`, missing.length === 0 ? 'OK' : `FAIL (missing: ${missing.join(', ')})`);

    // 2. playSfx тихо выходит на отсутствующем ключе (не бросает).
    // URL модуля берём из resource entries: dev-сервер отдаёт '/src/sfx.js?t=...'
    // (HMR-инвалидация), import без query создал бы второй экземпляр.
    await page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/sfx\.js/.test(n)) || '/src/sfx.js';
        const { playSfx } = await import(url);
        const gs = window.__GAME.scene.getScene('GameScene');
        playSfx(gs, 'nope'); // не должно бросить
    });
    console.log('2. playSfx silent on missing key: OK');

    // 3. Клики по блоку: нет ошибок страницы, звук playing
    await page.click('canvas', { position: { x: 400, y: 400 } });
    await page.waitForTimeout(40);
    const playing = await page.evaluate(() => {
        const s = window.__GAME.scene.getScene('GameScene').sound;
        return s.getAllPlaying().length;
    });
    console.log('3. click plays sound:', playing > 0 ? `OK (${playing} playing)` : 'FAIL');

    // 4. Мутация: звук через DevPanel-кнопку (панель открыта)
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(200);
    await page.click('#dev-admin-panel button:has-text("Радужный блок")');
    await page.waitForTimeout(300);
    const mut = await page.evaluate(() => {
        const s = window.__GAME.scene.getScene('GameScene').sound;
        return s.getAllPlaying().map((x) => x.key).some((k) => k.startsWith('mutation'));
    });
    console.log('4. mutation sound:', mut ? 'OK' : 'FAIL');

    // 5. Покупка улучшения: играет sound purchase (панель открыта)
    await page.click('#dev-admin-panel button:has-text("+1M")');
    await page.keyboard.press('Backquote'); // закрыть панель
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => {
        const u = window.__GAME.scene.getScene('UIScene');
        return u.listContent.list.filter((c) => c.visible).length;
    });
    await page.mouse.click(1176, 318); // кнопка «Купить» первого ряда: listCam(934,270) + btn(242,48)
    await page.waitForTimeout(40);
    const bought = await page.evaluate(() => {
        const s = window.__GAME.scene.getScene('GameScene').sound;
        return s.getAllPlaying().map((x) => x.key).some((k) => k.startsWith('purchase'));
    });
    console.log('5. purchase sound:', bought ? 'OK' : 'FAIL');
    console.log('6. rows visible:', rows > 0 ? `OK (${rows})` : 'FAIL');

    // 7. Модалка настроек: тумблеры Звук (SFX) и Музыка (BGM) независимы, слайдер громкости
    // Контейнер модалки (640,360): soundBtn (-105,-34) -> (535,326), musicBtn (105,-34) -> (745,326),
    // крестик (220,-228) -> (860,132), трек громкости y=14 -> 374, левый край 580
    await page.mouse.click(1146, 62); // кнопка «Настройки»
    await page.waitForTimeout(300);
    const modalOpen = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').modal.visible);
    console.log('7. settings modal opens:', modalOpen ? 'OK' : 'FAIL');
    await page.mouse.click(745, 326); // тоггл «Музыка: вкл/выкл»
    await page.waitForTimeout(200);
    const musicOff = await page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        const m = window.__GAME.scene.getScene('UIScene');
        const bgm = gs.sound.getAllPlaying().find((x) => x.key === 'bgm');
        return { on: m.musicText.text, bgmMute: bgm ? bgm.mute : null, bgmPlaying: !!bgm };
    });
    console.log('7a. music toggle -> off:', musicOff.on === 'Музыка: выкл' && musicOff.bgmMute === true && musicOff.bgmPlaying ? 'OK' : `FAIL (${JSON.stringify(musicOff)})`);
    await page.mouse.click(745, 326); // обратно вкл
    await page.waitForTimeout(200);
    const musicOn = await page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        const m = window.__GAME.scene.getScene('UIScene');
        const bgm = gs.sound.getAllPlaying().find((x) => x.key === 'bgm');
        return { on: m.musicText.text, bgmMute: bgm ? bgm.mute : null };
    });
    console.log('7b. music toggle -> on:', musicOn.on === 'Музыка: вкл' && musicOn.bgmMute === false ? 'OK' : `FAIL (${JSON.stringify(musicOn)})`);
    await page.mouse.click(535, 326); // тоггл «Звук: вкл/выкл» — эффекты, музыка НЕ трогается
    await page.waitForTimeout(200);
    const soundOff = await page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        const m = window.__GAME.scene.getScene('UIScene');
        const bgm = gs.sound.getAllPlaying().find((x) => x.key === 'bgm');
        return { lbl: m.soundText.text, bgmMute: bgm ? bgm.mute : null };
    });
    console.log('7c. sound toggle -> off, bgm unmuted:', soundOff.lbl === 'Звук: выкл' && soundOff.bgmMute === false ? 'OK' : `FAIL (${JSON.stringify(soundOff)})`);
    await page.mouse.click(860, 132); // крестик
    await page.waitForTimeout(200);
    const beforeSilent = await page.evaluate(() => window.__GAME.scene.getScene('GameScene').sound.getAllPlaying().map((x) => x.key));
    await page.mouse.click(400, 400); // клик по блоку при выключенном звуке
    await page.waitForTimeout(150);
    const silent = await page.evaluate(() => window.__GAME.scene.getScene('GameScene').sound.getAllPlaying().map((x) => x.key));
    const newKeys = silent.filter((k) => !beforeSilent.includes(k));
    console.log('7d. clicks silent when sound off:', newKeys.length === 0 ? 'OK' : `FAIL (new: ${newKeys.join(', ')})`);
    await page.mouse.click(1146, 62);
    await page.waitForTimeout(300);
    await page.mouse.click(650, 374); // слайдер громкости: x 650 -> v = (650-580)/180 = 0.389
    await page.waitForTimeout(200);
    const vol = await page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        const m = window.__GAME.scene.getScene('UIScene');
        const bgm = gs.sound.getAllPlaying().find((x) => x.key === 'bgm');
        return { pct: m.volPct.text, bgmVol: bgm ? bgm.volume : null };
    });
    const volOk = vol.pct === '39%' && vol.bgmVol !== null && Math.abs(vol.bgmVol - 0.389) < 0.02;
    console.log('7e. volume slider:', volOk ? `OK (${vol.pct}, bgm ${vol.bgmVol.toFixed(2)})` : `FAIL (${JSON.stringify(vol)})`);
    await page.mouse.click(535, 326); // звук обратно вкл
    await page.waitForTimeout(200);
    const backOn = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').soundText.text);
    console.log('7f. sound toggle -> on:', backOn === 'Звук: вкл' ? 'OK' : `FAIL (${backOn})`);
    await page.mouse.click(860, 132);
    await page.waitForTimeout(200);

    // 9. BGM: бесшовный луп играет постоянно и не заглушён после возврата звука
    const bgmOn = await page.evaluate(() => {
        const s = window.__GAME.scene.getScene('GameScene').sound;
        const bgm = s.getAllPlaying().find((x) => x.key === 'bgm');
        return bgm ? { playing: bgm.isPlaying, loop: bgm.loop, mute: bgm.mute } : null;
    });
    console.log('9. bgm loop playing unmuted:', bgmOn && bgmOn.playing && bgmOn.loop && bgmOn.mute === false ? 'OK' : `FAIL (${JSON.stringify(bgmOn)})`);

    // 8. page errors
    console.log('8. page errors:', errors.length === 0 ? 'OK (0)' : `FAIL (${errors.join('; ')})`);

    await b.close();
    console.log(`done, failures: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
