// Проверка мутаций блока (Этап 3): триггер-таймер 300с, радуга x10, заморозка (x3 кликов
// + форсированный крит), взрывной (x2 кликов + бонус при разрушении), заряженный (пассив x3),
// длительность ровно 10с (НЕ спадает при разрушении блока), истечение по таймеру, кнопки DevPanel.
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

    // Свежий забег: кирка 5 (клик = 6), остальное 0 — математика детерминированная
    const save = JSON.stringify({ version: 2, ore: 0, tier: 0, stars: 0, clicks: 0, lifetimeMined: 0, tierEarned: [0, 0, 0, 0, 0], levels: { pickaxe: 5 } });
    await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'ore-rush-save': save });
    await page.goto('http://localhost:5174', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    // Свежий сейв выдаёт дневную награду — модалка с затемнением блокирует
    // canvas-клики по блоку; закрываем И гасим баф x2 (математика кликов теста
    // рассчитана на чистое состояние без дневных бафов)
    await page.evaluate(async () => {
        window.__GAME.scene.getScene('UIScene').hideDailyModal();
        const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
        const m = await import(u);
        m.gameState.dailyBuffUntil = 0;
        m.gameState.dailyCritUntil = 0;
        m.gameState.dailyVeinUntil = 0;
    });
    await page.waitForTimeout(300);

    const gsState = () => page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        return {
            mutation: gs.mutation ? gs.mutation.id : null,
            stage: gs.blockStage,
            progress: gs.hitProgress,
            busy: gs.blockBusy,
            texture: gs.block.texture.key,
            tint: gs.block.tintTopLeft,
            timeLabel: gs.mutationTime ? gs.mutationTime.text : null,
            nameLabel: gs.mutationName ? gs.mutationName.text : null,
            timerDelay: gs.mutationTimer ? gs.mutationTimer.delay : null,
            endsIn: gs.mutation ? Math.round(gs.mutation.endsAt - gs.time.now) : null
        };
    });
    // ВАЖНО: долгоживущий dev-сервер инвалидирует изменённые модули HMR-таймстампом
    // ('/src/state.js?t=...') — import('/src/state.js') без query создал бы ВТОРОЙ
    // экземпляр с дефолтным gameState. Резолвим фактический URL из resource entries.
    const stateUrl = () => page.evaluate(() => {
        const hit = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /\/src\/state\.js/.test(n));
        return hit || '/src/state.js';
    });
    const state = async (expr) => {
        const u = await stateUrl();
        return page.evaluate(async ({ u, e }) => {
            const m = await import(u);
            return new Function('m', 'return (' + e + ');')(m);
        }, { u, e: expr });
    };
    const ore = () => state('m.gameState.ore');
    const clickGain = () => state('m.getClickDamage() + m.getSynergyGain()');
    // Не кликаем во время анимации разрушения
    const clickBlock = async (n, gap = 300) => {
        for (let i = 0; i < n; i++) {
            for (let t = 0; t < 40 && await page.evaluate(() => window.__GAME.scene.getScene('GameScene').blockBusy); t++) await page.waitForTimeout(150);
            await page.mouse.click(400, 400);
            await page.waitForTimeout(gap);
        }
    };

    // --- Сценарий A: старт без мутации + конфиг триггера ---
    let s = await gsState();
    check('A1: мутации нет при старте', s.mutation === null);
    check('A2: триггер 300000 мс', s.timerDelay === 300000, String(s.timerDelay));

    // Детерминизм: без критов/жил. ВАЖНО: значения варьированные (LCG) и >= 0.05 —
    // патч константой или коротким циклом ломает Phaser.Utils.String.UUID
    // (одинаковые ключи текстур -> addCanvas вернёт null -> краш создания Text).
    await page.evaluate(() => {
        window.__origRandom = Math.random;
        window.__rs = 1;
        Math.random = () => {
            window.__rs = (window.__rs * 1103515245 + 12345) % 2147483648;
            return 0.05 + (window.__rs / 2147483648) * 0.95;
        };
    });
    const base = await clickGain();

    // --- Сценарий B: радужный — клик x10, таймер-подпись, сброс при разрушении ---
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startMutation('rainbow'));
    s = await gsState();
    check('B1: радуга активна', s.mutation === 'rainbow');
    check('B2: подпись мутации', s.nameLabel === 'Радужный блок', String(s.nameLabel));
    check('B3: таймер-подпись «Nс»', /^\d{1,2}с$/.test(s.timeLabel || ''), String(s.timeLabel));
    let o0 = await ore();
    await clickBlock(1);
    let o1 = await ore();
    check('B4: клик x10', Math.abs(o1 - o0 - base * 10) < 0.001, `+${o1 - o0}, ожидалось ${base * 10}`);
    await clickBlock(4); // всего 5 кликов -> блок разрушается
    await page.waitForTimeout(800); // анимация разрушения
    s = await gsState();
    check('B5: мутация ПЕРЕЖИЛА разрушение блока', s.mutation === 'rainbow', `mutation=${s.mutation}`);
    check('B6: новый блок стадия 1, tint радуги', s.stage === 0 && s.texture.includes('stage_1') && s.tint !== 0xffffff, `${s.texture} tint=${s.tint}`);

    // --- Сценарий C: замороженный — 3 удара на стадию, каждый удар крит ---
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startMutation('frozen'));
    o0 = await ore();
    await clickBlock(1);
    s = await gsState();
    check('C1: 1 удар не двигает стадию (нужно 3)', s.stage === 0 && s.progress === 1, `stage=${s.stage} progress=${s.progress}`);
    await clickBlock(1);
    s = await gsState();
    check('C2: 2 удара — стадия всё ещё 0', s.stage === 0 && s.progress === 2);
    await clickBlock(1);
    s = await gsState();
    check('C3: 3 удара — стадия 1, текстура _stage_2', s.stage === 1 && s.progress === 0 && s.texture.includes('_stage_2'), `${s.texture}`);
    o1 = await ore();
    check('C4: каждый удар — крит (x5)', Math.abs(o1 - o0 - base * 5 * 3) < 0.001, `+${o1 - o0}, ожидалось ${base * 5 * 3}`);
    // Добиваем блок: с момента C3 нужно 10 ударов (стадии 1->4 по 3 + ломающий)
    await clickBlock(10);
    await page.waitForTimeout(800);
    s = await gsState();
    check('C5: заморозка пережила разрушение, новый блок с нуля', s.mutation === 'frozen' && s.stage === 0 && !s.busy, `mutation=${s.mutation} stage=${s.stage}`);

    // --- Сценарий D: взрывной — 2 удара на стадию, бонус при разрушении ---
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startMutation('explosive'));
    await clickBlock(2);
    s = await gsState();
    check('D1: 2 удара — стадия 1', s.stage === 1 && s.progress === 0, `stage=${s.stage}`);
    o0 = await ore();
    await clickBlock(7); // 7 ударов: 6 на стадии 2..4 + ломающий
    await page.waitForTimeout(800); // анимация разрушения
    s = await gsState();
    const breakBonus = await state(`m.getMutationBreakBonus('explosive')`);
    check('D2: взрывной пережил разрушение блока', s.mutation === 'explosive' && !s.busy, `mutation=${s.mutation}`);
    o1 = await ore();
    check('D3: бонус при разрушении = 25x клик', Math.abs(o1 - o0 - 7 * base - breakBonus) < 0.001, `+${o1 - o0}, ожидалось ${7 * base + breakBonus}`);

    // --- Сценарий E: заряженный — фоновая добыча x3 ---
    await page.evaluate(() => Math.random = window.__origRandom); // снимаем патч
    await state(`m.gameState.levels.miner = 5`); // в ЭКЗЕМПЛЯРЕ сцены (см. stateUrl)
    const gps = await state(`m.getOrePerSecond()`);
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startMutation('charged'));
    o0 = await ore();
    await page.waitForTimeout(4100);
    o1 = await ore();
    const perTick = (o1 - o0) / gps;
    check('E1: пассив x3 (~4 тика = x12)', perTick >= 9 && perTick <= 18, `тик-эквивалент ${perTick.toFixed(2)} (ожидалось ~12)`);
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').clearMutation(true));
    o0 = await ore();
    await page.waitForTimeout(2300);
    o1 = await ore();
    const perTick2 = (o1 - o0) / gps;
    check('E2: после снятия ставка обычная (~2 тика = x2)', perTick2 >= 1.4 && perTick2 <= 3.6, `тик-эквивалент ${perTick2.toFixed(2)} (ожидалось ~2)`);

    // --- Сценарий F: длительность ровно 10с + истечение по таймеру ---
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startMutation('rainbow'));
    s = await gsState();
    check('F1: длительность мутации = 10с', s.endsIn !== null && s.endsIn > 9200 && s.endsIn <= 10000, String(s.endsIn));
    await page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        gs.mutation.endsAt = gs.time.now + 1200; // укорачиваем для быстрого чека
    });
    await page.waitForTimeout(2200);
    s = await gsState();
    check('F2: мутация истекла по таймеру', s.mutation === null && s.timeLabel === null);
    check('F3: текстура стадии восстановлена, tint чистый', s.texture.includes('_stage_') && s.tint === 0xffffff, `${s.texture} tint=${s.tint}`);

    // --- Сценарий G: DevPanel — навесить/снять любую мутацию ---
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(300);
    await page.click('#dev-admin-panel button:text("Радужный блок")');
    s = await gsState();
    check('G1: DevPanel навесил радугу', s.mutation === 'rainbow');
    await page.click('#dev-admin-panel button:text("Замороженный блок")');
    s = await gsState();
    check('G2: DevPanel переключил на заморозку', s.mutation === 'frozen');
    await page.click('#dev-admin-panel button:text("Взрывной блок")');
    await page.click('#dev-admin-panel button:text("Заряженный блок")');
    s = await gsState();
    check('G3: DevPanel переключил на заряд', s.mutation === 'charged');
    await page.click('#dev-admin-panel button:text("Убрать мутацию")');
    s = await gsState();
    check('G4: DevPanel снял мутацию', s.mutation === null);

    console.log(`page errors: ${errors.length ? errors.join(' | ') : '0'}`);
    console.log(`итого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(errors.length || failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
