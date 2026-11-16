// Проверка карты шахты (П3, редизайн «настолка»): открытие по кнопке, фон-доска
// map_board, 18 кружков с обводками по статусу, тропа (пунктир+шевроны),
// лок/разлок реестра blockLocked, спуск с анимацией и skip-тапом, очередь
// дневной награды под картой, каркас мастерской, аудит вёрстки (дифф против
// бейзлайна настроек-модалки: полноэкранные оверлеи дают одинаковый класс
// пересечений с HUD). Запуск: node scripts/verify-map.cjs — dev-сервер
// поднимается сам (порт 5174) и гасится, если поднят этим скриптом.
const { chromium } = require('playwright');
const { ensureDevServer, releaseDevServer } = require('./lib/dev-server.cjs');

let passed = 0,
    failed = 0;
function check(name, cond, detail = '') {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
    if (cond) passed++;
    else failed++;
}

// Сигнатура нарушения: цифры (координаты/размеры) выпадают — сравниваем классы
// пар «текстура × текстура», а не конкретные точки (панели оверлеев разного
// размера дают одинаковый класс пересечения с HUD).
const sig = (v) => v.replace(/\d+(\.\d+)?/g, '#');

// Аудит вёрстки — копия auditLayout из ui-review.mjs (обход видимых объектов
// сцен, пересечения и вылезания рядов из карточек).
async function auditLayout(page) {
    return page.evaluate(() => {
        const game = window.__GAME;
        if (!game) return { violations: ['window.__GAME не найден'] };
        const items = [];
        const ui = game.scene.getScene('UIScene');
        const listCam = ui ? ui.listCam : null;
        for (const scene of game.scene.getScenes(true)) {
            const inTree = (container, go) => {
                if (container === go) return true;
                if (!container.list) return false;
                for (const ch of container.list) {
                    if (ch === go || inTree(ch, go)) return true;
                }
                return false;
            };
            const walk = (list, parentVisible) => {
                for (const go of list) {
                    if (go.visible === false || parentVisible === false) {
                        if (go.list) walk(go.list, false);
                        continue;
                    }
                    if (go.list) {
                        walk(go.list, true);
                        continue;
                    }
                    if (go.type === 'ParticleEmitter' || go.type === 'Graphics' || go.type === 'Rectangle') continue;
                    if (go.alpha !== undefined && go.alpha < 0.05) continue;
                    try {
                        const b = go.getBounds();
                        if (b.width <= 1 && b.height <= 1) continue;
                        let x = b.x,
                            y = b.y,
                            r = b.right,
                            bt = b.bottom;
                        let inList = false;
                        // Контент скролл-камер переводим в экранные координаты
                        // (ряды списка — listCam, столбец карты — mapCam)
                        if (scene.scene.key === 'UIScene' && ui && ui.listContent && inTree(ui.listContent, go)) {
                            inList = true;
                            const vy = y - listCam.scrollY + listCam.y;
                            if (bt - listCam.scrollY + listCam.y < listCam.y - 2 || vy > listCam.y + listCam.height + 2)
                                continue;
                            y = vy;
                            bt = bt - listCam.scrollY + listCam.y;
                            x = x - listCam.scrollX + listCam.x;
                            r = r - listCam.scrollX + listCam.x;
                        }
                        if (scene.scene.key === 'UIScene' && ui && ui.mapContent && inTree(ui.mapContent, go)) {
                            const cam = ui.mapCam;
                            const vy = y - cam.scrollY + cam.y;
                            if (bt - cam.scrollY + cam.y < cam.y - 2 || vy > cam.y + cam.height + 2) continue;
                            y = vy;
                            bt = bt - cam.scrollY + cam.y;
                            x = x - cam.scrollX + cam.x;
                            r = r - cam.scrollX + cam.x;
                        }
                        if (scene.scene.key === 'UIScene' && ui && ui.craftContent && inTree(ui.craftContent, go)) {
                            const cam = ui.craftCam;
                            const vy = y - cam.scrollY + cam.y;
                            if (bt - cam.scrollY + cam.y < cam.y - 2 || vy > cam.y + cam.height + 2) continue;
                            y = vy;
                            bt = bt - cam.scrollY + cam.y;
                            x = x - cam.scrollX + cam.x;
                            r = r - cam.scrollX + cam.x;
                        }
                        if (go.type === 'Text') {
                            y += 3;
                            bt -= 3;
                        }
                        items.push({
                            scene: scene.scene.key,
                            kind: go.type,
                            text: (go.text || '').slice(0, 26),
                            tex: (go.texture && go.texture.key) || '',
                            x,
                            y,
                            r,
                            bt
                        });
                    } catch (e) {
                        /* нет bounds — пропускаем */
                    }
                }
            };
            walk(scene.children.list, true);
        }
        const violations = [];
        const isContained = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.r <= b.r + 1 && a.b <= b.b + 1;
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i],
                    b = items[j];
                if (a.scene !== b.scene) continue;
                if (isContained(a, b) || isContained(b, a)) continue;
                const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
                const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
                if (ox > 1 && oy > 1) {
                    violations.push(
                        `OVERLAP [${a.scene}] "${a.text || a.tex || a.kind}" x "${b.text || b.tex || b.kind}" ox=${Math.round(ox)} oy=${Math.round(oy)}`
                    );
                }
            }
        }
        if (ui && ui.listContent && listCam) {
            const cards = ui.listContent.list.filter((go) => go.texture && go.texture.key === 'upgrade_row_card_1');
            for (const card of cards) {
                const cb = card.getBounds();
                const csy = cb.y - listCam.scrollY + listCam.y;
                const csby = cb.bottom - listCam.scrollY + listCam.y;
                if (csby < listCam.y - 2 || csy > listCam.y + listCam.height + 2) continue;
                const inner = { x: cb.x + 5, y: csy + 5, r: cb.right - 5, b: csby - 5 };
                for (const go of ui.listContent.list) {
                    if (go === card || go.type === 'Rectangle') continue;
                    const gb = go.getBounds();
                    if (!gb || gb.width === 0) continue;
                    if (gb.bottom < cb.y || gb.y > cb.bottom) continue;
                    const gy = gb.y - listCam.scrollY + listCam.y,
                        gby = gb.bottom - listCam.scrollY + listCam.y;
                    const adj = go.type === 'Text' ? 3 : 0;
                    if (gy + adj < inner.y - 1 || gby - adj > inner.b + 1) {
                        violations.push(
                            `OUTSIDE-CARD row@${Math.round(csy)}: "${go.text || go.texture?.key || go.type}"`
                        );
                    }
                }
            }
        }
        return { violations };
    });
}

const FRESH_SAVE = JSON.stringify({
    version: 5,
    ore: 0,
    tier: 0,
    stars: 0,
    clicks: 0,
    lifetimeMined: 0,
    tierEarned: Array(12).fill(0),
    tutorialDone: true,
    levels: { pickaxe: 5 }
});
// Тир 3 (серебро), Медный страж побеждён: тира 0..2 пройдены, тир 3 текущий,
// boss_silver доступен, boss_amethyst/ruby/platinum/diamond закрыты гейтом тира.
const DEEP_SAVE = JSON.stringify({
    version: 5,
    ore: 50000,
    tier: 3,
    stars: 0,
    clicks: 100,
    lifetimeMined: 5e5,
    tierEarned: [1e5, 1e5, 1e5, 1e5, 0, 0, 0, 0, 0, 0, 0, 0],
    tierAnchorRate: 100,
    tutorialDone: true,
    bossesDefeated: { boss_copper: true },
    levels: { pickaxe: 15, miner: 10, drill: 5 }
});

(async () => {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const b = await chromium.launch();
    const errors = [];

    const newPage = async (save, viewport) => {
        const page = await b.newPage({ viewport });
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.addInitScript((s) => {
            localStorage.setItem('ore-rush-save', s);
        }, save);
        await page.goto('http://localhost:5174', { waitUntil: 'load' });
        await page.waitForTimeout(3000);
        // Свежий сейв выдаёт дневную награду — закрываем (lock снимается
        // updateBlockLock'ом в ближайшем кадре)
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
        await page.waitForTimeout(400);
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
        const state = async (expr) => {
            return page.evaluate(async (e) => {
                const u =
                    performance
                        .getEntriesByType('resource')
                        .map((r) => r.name)
                        .find((n) => /\/src\/state\.js/.test(n)) || '/src/state.js';
                const m = await import(u);
                return new Function('m', 'return (' + e + ');')(m);
            }, expr);
        };
        return { page, state };
    };

    const uiState = (page) =>
        page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                mapOpen: ui._mapOpen,
                craftOpen: ui._craftOpen,
                locked: window.__GAME.registry.get('blockLocked'),
                mapRootVisible: ui.mapRoot.visible,
                contentVisible: ui.mapContent.visible,
                nodes: ui.mapNodes.length,
                scrollY: ui.mapCam.scrollY,
                anim: ui._mapAnim ? 'run' : null,
                minerVisible: ui.mapMiner.visible,
                minerY: ui.mapMiner.y,
                mapCamVisible: ui.mapCam.visible,
                boardTex: ui.mapBoard ? ui.mapBoard.texture.key : null,
                boardVisible: ui.mapBoard ? ui.mapBoard.visible : false,
                trailType: ui.mapTrail ? ui.mapTrail.type : null
            };
        });

    // Координаты кликов берём с живых объектов (центры кнопок, слоты узлов)
    const ptOf = (page, expr) =>
        page.evaluate((e) => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return new Function('ui', 'return (' + e + ');')(ui);
        }, expr);

    // ---------- Страница 1: свежий забег, ландшафт ----------
    {
        const { page, state } = await newPage(FRESH_SAVE, { width: 1280, height: 720 });

        // A: карта по кнопке
        const mapBtnPt = await ptOf(page, '({ x: ui.mapBtn.x, y: ui.mapBtn.y })');
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(300);
        let s = await uiState(page);
        check('A1: карта открылась по кнопке', s.mapOpen && s.mapRootVisible && s.contentVisible, JSON.stringify(s));
        check('A2: registry blockLocked = true', s.locked === true);
        check('A3: 18 узлов (12 тиров + 6 боссов)', s.nodes === 18, String(s.nodes));
        check('A4: карта видна камере', s.mapCamVisible);
        check(
            'A4b: фон-доска map_board внутри панели видна',
            s.boardTex === 'map_board' && s.boardVisible,
            JSON.stringify({ tex: s.boardTex, vis: s.boardVisible })
        );
        check('A4c: тропа-Graphics в mapContent', s.trailType === 'Graphics', String(s.trailType));
        // A1(П2-ревью): зазор тропы валиден для КАЖДОЙ пары соседних узлов —
        // низ подписи + 4s + 6 <= верх следующего кружка − 9s (иначе пунктир
        // не рисуется; ловилось только на сегментах «босс → следующий тир»)
        const trailGaps = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const sc = ui._adaptiveScale || 1;
            const bad = [];
            for (let k = 0; k < ui.mapNodes.length - 1; k++) {
                const a = ui.mapNodes[k],
                    b = ui.mapNodes[k + 1];
                const lbl = a.kind === 'tier' ? a.name : a.status;
                const from = a.root.y + lbl.y + lbl.height + Math.round(4 * sc);
                const to = b.root.y - Math.round(9 * sc);
                if (from + 6 > to) bad.push({ k, from: Math.round(from), to: Math.round(to) });
            }
            return bad;
        });
        check(
            'A4d: тропа — зазор валиден для всех 17 пар соседних узлов',
            trailGaps.length === 0,
            JSON.stringify(trailGaps)
        );
        check('A5: scroll на текущем узле (тир 0)', Math.abs(s.scrollY - 0) < 1, String(s.scrollY));

        const states = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return ui.mapNodes.map((n) => ({
                kind: n.kind,
                tier: n.kind === 'tier' ? n.tier : null,
                id: n.boss ? n.boss.id : null,
                state: n._state,
                status: n.status ? n.status.text : null,
                ringType: n.ring ? n.ring.type : null,
                ringColor: n._ringColor,
                pulsing: !!n.pulse
            }));
        });
        check(
            'A6: тир 1 текущий с пульсом',
            states[0].kind === 'tier' && states[0].tier === 0 && states[0].state === 'current' && states[0].pulsing
        );
        // Порядок по ТЗ: [t0, t1, boss_copper, t2, t3, boss_silver, ...]
        check(
            'A6b: boss_copper стоит после узла тира 1',
            states[1].kind === 'tier' && states[1].tier === 1 && states[2].id === 'boss_copper'
        );
        check(
            'A6c: у каждого узла кружок-Graphics с обводкой по статусу',
            states.every((n) => n.ringType === 'Graphics' && typeof n.ringColor === 'number'),
            JSON.stringify(states.filter((n) => n.ringType !== 'Graphics').length)
        );
        check(
            'A7: тиры 2..12 будущие — тёмная обводка 0x3a3d40',
            states
                .filter((n) => n.kind === 'tier' && n.tier > 0)
                .every((n) => n.state === 'future' && n.ringColor === 0x3a3d40 && !n.pulsing)
        );
        check(
            'A8: все боссы закрыты «нужен: шахта N+1», серая обводка',
            states
                .filter((n) => n.kind === 'boss')
                .every((n) => n.state === 'locked' && /нужен: шахта \d+/.test(n.status) && n.ringColor === 0x6a6a6a)
        );
        check(
            'A9: подпись босса тира 1 «нужен: шахта 2»',
            states.find((n) => n.id === 'boss_copper').status === 'нужен: шахта 2'
        );

        // B: закрытие снимает lock, клик по блоку добывает
        const closePt = await ptOf(page, '({ x: ui.mapRoot.x + ui.mapClose.x, y: ui.mapRoot.y + ui.mapClose.y })');
        await page.mouse.click(closePt.x, closePt.y);
        await page.waitForTimeout(300);
        s = await uiState(page);
        check(
            'B1: карта закрылась, lock снят',
            !s.mapOpen && !s.mapRootVisible && !s.contentVisible && s.locked === false,
            JSON.stringify(s)
        );
        const ore0 = await state('m.gameState.ore');
        await page.mouse.click(400, 400);
        await page.waitForTimeout(300);
        const ore1 = await state('m.gameState.ore');
        check('B2: клик по блоку добывает после закрытия карты', ore1 > ore0, `${ore0} -> ${ore1}`);

        // C: спуск — карта открывается с анимацией, skip-тап мгновенно завершает
        await state('m.gameState.ore = 1000000');
        await page.waitForTimeout(200);
        const unlockPt1 = await ptOf(page, '({ x: ui.unlockBtn.x + 260, y: ui.unlockBtn.y + 26 })');
        await page.mouse.click(unlockPt1.x, unlockPt1.y); // центр живой кнопки спуска
        await page.waitForTimeout(250);
        s = await uiState(page);
        check('C1: спуск открыл карту с анимацией', s.mapOpen && s.anim === 'run', JSON.stringify(s));
        await page.mouse.click(500, 500); // skip-тап по карте
        await page.waitForTimeout(150);
        s = await uiState(page);
        // Цели скролла считаем по живой геометрии узлов (root.y + _r — центр
        // кружка, не верх): target = clamp(centerY - h/2, 0, maxScroll)
        const c2 = await ptOf(
            page,
            `(() => {
            const n = ui.mapNodes.find((x) => x.kind === 'tier' && x.tier === 1);
            return { y: n.root.y + n._r, target: Math.max(0, Math.min(ui._mapMaxScroll, n.root.y + n._r - ui._mapView.h / 2)) };
        })()`
        );
        check(
            'C2: skip завершил анимацию на целевом узле',
            !s.anim && Math.abs(s.scrollY - c2.target) < 1,
            `scrollY=${s.scrollY} target=${c2.target}`
        );
        check(
            'C3: шахтёр на узле нового тира',
            s.minerVisible && Math.abs(s.minerY - c2.y) < 1,
            `y=${s.minerY} узел=${c2.y}`
        );
        const banner = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return ui.mapRoot.list.some((o) => o.type === 'Text' && /Уровень 2: Медь!/.test(o.text));
        });
        check('C4: баннер прибытия «Уровень 2: Медь!»', banner);
        await page.mouse.click(closePt.x, closePt.y);
        await page.waitForTimeout(1200);
        const tier = await state('m.gameState.tier');
        const blockTex = await page.evaluate(() => window.__GAME.scene.getScene('GameScene').block.texture.key);
        check(
            'C5: после closeMap шахта на тире 1 (медь)',
            tier === 1 && blockTex.includes('copper'),
            `tier=${tier} tex=${blockTex}`
        );
        s = await uiState(page);
        check('C6: lock снят после спуска и закрытия', s.locked === false);
        await page.close();
    }

    // ---------- Страница 2: тир 3, побеждённый босс, ландшафт ----------
    {
        const { page, state } = await newPage(DEEP_SAVE, { width: 1280, height: 720 });
        const mapBtnPt = await ptOf(page, '({ x: ui.mapBtn.x, y: ui.mapBtn.y })');
        const closePt = await ptOf(page, '({ x: ui.mapRoot.x + ui.mapClose.x, y: ui.mapRoot.y + ui.mapClose.y })');
        const craftBtnPt = await ptOf(page, '({ x: ui.craftBtn.x, y: ui.craftBtn.y })');

        // D: состояния узлов на глубине
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(300);
        let s = await uiState(page);
        const d1 = await ptOf(
            page,
            `(() => {
            const n = ui.mapNodes.find((x) => x.kind === 'tier' && x.tier === 3);
            return Math.max(0, Math.min(ui._mapMaxScroll, n.root.y + n._r - ui._mapView.h / 2));
        })()`
        );
        check(
            'D1: карта открыта, scroll на тире 3 (по коду)',
            s.mapOpen && Math.abs(s.scrollY - d1) < 1,
            `scrollY=${s.scrollY} target=${d1}`
        );

        // D1b: физический драг двигает скролл (старт — с dim: его stopPropagation
        // гасит scene-level pointerdown)
        await page.mouse.move(500, 400);
        await page.mouse.down();
        await page.mouse.move(500, 300, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const dragScroll = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').mapCam.scrollY);
        check('D1b: драг двигает скролл (+100px)', Math.abs(dragScroll - (d1 + 100)) < 1, `scrollY=${dragScroll}`);

        // D1c: колесо поверх карты докручивает (dy 200 x коэф. 0.5 = +100px)
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(150);
        const wheelScroll = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').mapCam.scrollY);
        check('D1c: колесо докручивает (+100px)', Math.abs(wheelScroll - (d1 + 200)) < 1, `scrollY=${wheelScroll}`);
        const states = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return ui.mapNodes.map((n) => ({
                kind: n.kind,
                tier: n.tier || null,
                id: n.boss ? n.boss.id : null,
                state: n._state,
                status: n.status ? n.status.text : null,
                ringType: n.ring ? n.ring.type : null,
                ringColor: n._ringColor,
                pulsing: !!n.pulse,
                ringPulse: !!n.ringPulse
            }));
        });
        check(
            'D2: тиры 0..2 пройдены — серая обводка 0x6a6a6a',
            states
                .filter((n) => n.kind === 'tier' && n.tier < 3)
                .every((n) => n.state === 'passed' && n.ringColor === 0x6a6a6a && !n.pulsing)
        );
        check(
            'D3: тир 3 текущий с пульсом (жёлтая обводка)',
            states
                .filter((n) => n.kind === 'tier' && n.tier === 3)
                .every((n) => n.state === 'current' && n.ringColor === 0xffd75e && n.pulsing)
        );
        check(
            'D4: boss_copper побеждён — зелёная обводка',
            states.find((n) => n.id === 'boss_copper').state === 'defeated' &&
                states.find((n) => n.id === 'boss_copper').ringColor === 0x7ee787 &&
                states.find((n) => n.id === 'boss_copper').status === 'побеждён'
        );
        const silver = states.find((n) => n.id === 'boss_silver');
        check(
            'D5: boss_silver доступен «Сразиться!» с пульсом текста И обводки',
            silver.state === 'available' &&
                silver.status === 'Сразиться!' &&
                silver.pulsing &&
                silver.ringPulse &&
                silver.ringColor === 0xffd75e
        );
        check(
            'D6: боссы 5..11 закрыты гейтом',
            states
                .filter((n) => n.id && n.id !== 'boss_copper' && n.id !== 'boss_silver')
                .every((n) => n.state === 'locked' && /нужен: шахта \d+/.test(n.status))
        );

        // E: тап доступного босса — closeMap + старт боя (П4 заменил заглушку П3);
        // клик в центр кружка (ring — ребёнок root со сдвигом r вниз)
        const silverPt = await ptOf(
            page,
            `(() => {
            const n = ui.mapNodes.find((x) => x.boss && x.boss.id === 'boss_silver');
            const v = ui._mapView;
            return { x: v.x + n.root.x + n.ring.x, y: v.y + n.root.y + n.ring.y - ui.mapCam.scrollY };
        })()`
        );
        await page.mouse.click(silverPt.x, silverPt.y);
        await page.waitForTimeout(400);
        s = await uiState(page);
        const fightOn = await page.evaluate(() => {
            const gs = window.__GAME.scene.getScene('GameScene');
            return !!gs.boss && gs.boss.def.id === 'boss_silver' && window.__GAME.registry.get('bossActive');
        });
        check(
            'E1: тап босса закрыл карту и начал бой (бой НЕ держит blockLocked)',
            !s.mapOpen && s.locked === false && fightOn,
            JSON.stringify(s)
        );
        // ретрит: босс — мягкий контент, спуск не гейтит; ждём затухания флоата до аудита F
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').retreatBoss());
        await page.waitForTimeout(1500);
        const retreated = await page.evaluate(() => {
            const gs = window.__GAME.scene.getScene('GameScene');
            return !gs.boss && !window.__GAME.registry.get('bossActive') && gs.block.visible;
        });
        check('E2: ретрит вернул блок, lock снят', retreated);

        // F: аудит вёрстки. Полноэкранные оверлеи легитимно перекрывают под-UI
        // (задокументированная слепая зона аудита: depth не проверяется), поэтому
        // класс «панель × что-то под ней» выпадает; фон-доска map_board — часть
        // хрома карты (край под крестиком/заголовком) — тоже выпадает; сравниваем
        // остальное с фоном (карта закрыта) — новые пересечения контента запрещены.
        const baseRelevant = new Set(
            (await auditLayout(page)).violations
                .filter((v) => !v.includes('modal_panel_metal') && !v.includes('map_board'))
                .map(sig)
        );
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(400);
        const mapAudit = (await auditLayout(page)).violations.filter(
            (v) => !v.includes('modal_panel_metal') && !v.includes('map_board')
        );
        const mapNew = mapAudit.filter((v) => !baseRelevant.has(sig(v)));
        check(
            'F1: аудит при открытой карте — новых нарушений нет',
            mapNew.length === 0,
            mapNew.join(' | ') || mapAudit.join(' | ')
        );
        await page.mouse.click(closePt.x, closePt.y);
        await page.waitForTimeout(300);

        // G: очередь дневной награды под картой
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = { streak: 2 };
            ui.tryShowDailyModal();
        });
        const waiting = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { pending: !!ui._pendingDaily, dailyVisible: ui.dailyModal.visible };
        });
        check('G1: дневная награда ждёт под открытой картой', waiting.pending && !waiting.dailyVisible);
        await page.mouse.click(closePt.x, closePt.y);
        await page.waitForTimeout(400);
        const shown = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').dailyModal.visible);
        check('G2: награда показалась после closeMap', shown);
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
        await page.waitForTimeout(300);

        // H: каркас мастерской
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(300);
        const craft = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                open: ui._craftOpen,
                root: ui.craftRoot.visible,
                content: ui.craftContent.visible,
                title: ui.craftTitle.text,
                locked: window.__GAME.registry.get('blockLocked')
            };
        });
        check(
            'H1: крафт-кнопка открыла каркас «Мастерская»',
            craft.open && craft.root && craft.content && craft.title === 'Мастерская' && craft.locked === true,
            JSON.stringify(craft)
        );
        await page.mouse.click(860, 132); // крестик каркаса
        await page.waitForTimeout(300);
        const craftClosed = await uiState(page);
        check('H2: каркас закрылся, lock снят', !craftClosed.craftOpen && craftClosed.locked === false);
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(300);
        const craftAudit = (await auditLayout(page)).violations.filter((v) => !v.includes('modal_panel_metal'));
        const craftNew = craftAudit.filter((v) => !baseRelevant.has(sig(v)));
        check('H3: аудит каркаса крафта — новых нарушений нет', craftNew.length === 0, craftNew.join(' | '));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeCraft());
        await page.waitForTimeout(200);

        // J: глубокий спуск — ненулевая цель скролла: тир 3 -> 4 (золото);
        // цель скролла и позицию шахтёра берём из живой геометрии узла тира 4
        await state('m.gameState.ore = 1000000');
        await page.waitForTimeout(200);
        const unlockPt2 = await ptOf(page, '({ x: ui.unlockBtn.x + 260, y: ui.unlockBtn.y + 26 })');
        await page.mouse.click(unlockPt2.x, unlockPt2.y); // центр живой кнопки спуска
        await page.waitForTimeout(250);
        s = await uiState(page);
        check(
            'J1: спуск открыл карту с анимацией (клик по кнопке не skip-ает)',
            s.mapOpen && s.anim === 'run',
            JSON.stringify(s)
        );
        await page.mouse.click(500, 500); // skip-тап по карте
        await page.waitForTimeout(150);
        s = await uiState(page);
        const j2 = await ptOf(
            page,
            `(() => {
            const n = ui.mapNodes.find((x) => x.kind === 'tier' && x.tier === 4);
            return { y: n.root.y + n._r, target: Math.max(0, Math.min(ui._mapMaxScroll, n.root.y + n._r - ui._mapView.h / 2)) };
        })()`
        );
        check(
            'J2: skip поставил scroll на цель (по коду)',
            !s.anim && Math.abs(s.scrollY - j2.target) < 1,
            `scrollY=${s.scrollY} target=${j2.target}`
        );
        check(
            'J3: шахтёр на узле тира 4',
            s.minerVisible && Math.abs(s.minerY - j2.y) < 1,
            `y=${s.minerY} узел=${j2.y}`
        );
        await page.mouse.click(closePt.x, closePt.y);
        await page.waitForTimeout(1200);
        const deepTier = await state('m.gameState.tier');
        const deepTex = await page.evaluate(() => window.__GAME.scene.getScene('GameScene').block.texture.key);
        check(
            'J4: спуск на тир 4 (золото) выполнен',
            deepTier === 4 && deepTex.includes('gold'),
            `tier=${deepTier} tex=${deepTex}`
        );
        await page.close();
    }

    // ---------- Страница 3: портрет 390x844 ----------
    {
        const { page } = await newPage(DEEP_SAVE, { width: 390, height: 844 });
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').mapBtn.emit('pointerdown'));
        await page.waitForTimeout(300);
        const s = await uiState(page);
        check(
            'I1: карта открылась в портрете',
            s.mapOpen && s.mapRootVisible && s.contentVisible && s.mapCamVisible,
            JSON.stringify(s)
        );
        check('I2: 18 узлов в портрете', s.nodes === 18);
        const view = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const v = ui._mapView;
            return { w: v.w, h: v.h, inGrid: v.w > 100 && v.h > 100 && v.y + v.h <= 1558 };
        });
        check('I3: вьюпорт карты в портрете адекватен', view.inGrid, JSON.stringify(view));
        const ip = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                s: ui._adaptiveScale,
                board: ui.mapBoard.visible && ui.mapBoard.texture.key === 'map_board',
                tierR: ui.mapNodes.find((n) => n.kind === 'tier')._r,
                bossR: ui.mapNodes.find((n) => n.kind === 'boss')._r,
                trail: ui.mapTrail.type
            };
        });
        check(
            'I5: доска/кружки/тропа в портрете (радиусы по s)',
            ip.board &&
                ip.trail === 'Graphics' &&
                ip.tierR === Math.round(28 * ip.s) &&
                ip.bossR === Math.round(34 * ip.s),
            JSON.stringify(ip)
        );
        const trailGapsP = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const sc = ui._adaptiveScale || 1;
            const bad = [];
            for (let k = 0; k < ui.mapNodes.length - 1; k++) {
                const a = ui.mapNodes[k],
                    b = ui.mapNodes[k + 1];
                const lbl = a.kind === 'tier' ? a.name : a.status;
                const from = a.root.y + lbl.y + lbl.height + Math.round(4 * sc);
                const to = b.root.y - Math.round(9 * sc);
                if (from + 6 > to) bad.push({ k, from: Math.round(from), to: Math.round(to) });
            }
            return bad;
        });
        check(
            'I6: тропа в портрете — зазор валиден для всех 17 пар',
            trailGapsP.length === 0,
            JSON.stringify(trailGapsP)
        );
        await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui.mapClose.emit('pointerdown');
        });
        await page.waitForTimeout(300);
        const s2 = await uiState(page);
        check('I4: карта закрылась в портрете', !s2.mapOpen && s2.locked === false);
        await page.close();
    }

    // ---------- Страница 4: смена ориентации при s=1.0 (планшет-портрет) ----------
    {
        const { page } = await newPage(DEEP_SAVE, { width: 720, height: 1500 });
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openMap());
        await page.waitForTimeout(400);
        const before = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { cx: ui._nodeCX, trailCX: ui._trailCX, s: ui._adaptiveScale, open: ui._mapOpen };
        });
        check(
            'K1: портрет-планшет s=1.0, тропа на колонке узлов',
            before.open && Math.abs(before.s - 1) < 0.01 && before.cx === before.trailCX,
            JSON.stringify(before)
        );
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.waitForTimeout(700);
        const after = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                cx: ui._nodeCX,
                trailCX: ui._trailCX,
                s: ui._adaptiveScale,
                open: ui._mapOpen,
                rootsOnCX: ui.mapNodes.every((n) => n.root.x === ui._nodeCX)
            };
        });
        check(
            'K2: ротация при s=1.0 — тропа переехала за узлами (A2 ревью П2)',
            after.open &&
                Math.abs(after.s - 1) < 0.01 &&
                after.cx === 340 &&
                after.cx === after.trailCX &&
                after.rootsOnCX,
            JSON.stringify(after)
        );
        await page.close();
    }

    console.log(`page errors: ${errors.length ? errors.join(' | ') : '0'}`);
    console.log(`итого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(errors.length || failed ? 1 : 0);
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
