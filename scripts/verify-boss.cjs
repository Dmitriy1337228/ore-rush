// Проверка боссов (П4): старт с карты (реальный путь тапа по слоту), HP/имя/таймер,
// слот боссового предмета (бомба), settings-гейт в бою, клик-килл с наградой
// (баунти = 90 сек дохода, дропы, артефакт только за первое убийство), повторный
// файт без дубля артефакта, робо-рука бьёт босса без ручных кликов, ретрит по
// таймеру (укороченный endsAt) и крестиком, снятие лока после модалки награды,
// статус «побеждён» на карте, сохранение стадии блока, портретный оверлей.
// Запуск: node scripts/verify-boss.cjs — dev-сервер поднимается сам (порт 5174).
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
    levels: { pickaxe: 30, sledge: 12, dynamite: 5, lucky: 0, resonance: 0, focuslens: 0, magnet: 0, robotarm: 0, miner: 10, drill: 5, tech: 3 }
}, over));

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
        // (математика баунти/урона рассчитана на чистое состояние)
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
        // LCG: детерминизм без паттерна «константа» (ломает UUID Phaser);
        // значения >= 0.05 => шанс крита 5% (dynamite 0) никогда не срабатывает
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
        const ptOf = (expr) => page.evaluate((e) => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return new Function('ui', 'return (' + e + ');')(ui);
        }, expr);
        const gsOf = (expr) => page.evaluate((e) => {
            const gs = window.__GAME.scene.getScene('GameScene');
            return new Function('gs', 'return (' + e + ');')(gs);
        }, expr);
        return { page, state, ptOf, gsOf };
    };

    // Клик-килл: бьём спрайт, пока босс жив и не в анимации смерти
    const killLoop = async (page, pt) => {
        for (let i = 0; i < 18; i++) {
            const st = await page.evaluate(() => {
                const gs = window.__GAME.scene.getScene('GameScene');
                return gs.boss ? (gs.boss.busy ? 'busy' : 'alive') : 'dead';
            });
            if (st === 'dead') break;
            if (st === 'alive') await page.mouse.click(pt.x, pt.y);
            await page.waitForTimeout(260);
        }
        await page.waitForTimeout(900); // твин смерти 600мс + grantBossKill + очистка
    };

    const rewardInfo = (page) => page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        // подписи компонентов/артефакта — дети bossRewardComps (контейнер внутри модалки)
        const direct = ui.bossRewardModal.list;
        const nested = ui.bossRewardComps ? ui.bossRewardComps.list : [];
        const texts = direct.concat(nested).filter((o) => o.type === 'Text').map((o) => o.text);
        const icons = direct.concat(nested)
            .filter((o) => o.type === 'Image' && o.texture && /^(comp_|art_)/.test(o.texture.key))
            .map((o) => o.texture.key);
        return {
            visible: ui.bossRewardModal.visible,
            open: ui._bossRewardOpen,
            locked: window.__GAME.registry.get('blockLocked'),
            active: window.__GAME.registry.get('bossActive'),
            texts,
            icons
        };
    });

    // ---------- Страница 1: полный цикл через карту (ландшафт) ----------
    {
        const { page, state, ptOf, gsOf } = await newPage(mkSave({ items: { item_bomb: 2 } }), { width: 1280, height: 720 });

        const hpExpected = await state('m.bossHpFor(m.BOSSES[0])');
        check('A1: bossHpFor(тир 1, hpMult 1.0) = 75000', hpExpected === 75000, String(hpExpected));
        // Баунти считается grantBossKill ДО выдачи артефакта — фиксируем ожидание заранее
        const bountyExpected = await state('m.fmt(Math.ceil(90 * m.getEarningRate()))');

        await page.mouse.click(400, 400); await page.waitForTimeout(350);
        await page.mouse.click(400, 400); await page.waitForTimeout(350);
        const stage0 = await gsOf('gs.blockStage');
        check('B1: стадия блока 2 до боя', stage0 === 2, String(stage0));

        const mapBtnPt = await ptOf('({ x: ui.mapBtn.x, y: ui.mapBtn.y })');
        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(400);
        const bossPt = await ptOf(`(() => {
            const n = ui.mapNodes.find((x) => x.boss && x.boss.id === 'boss_copper');
            const v = ui._mapView;
            return { x: v.x + n.root.x - 60, y: v.y + n.root.y - ui.mapCam.scrollY };
        })()`);
        await page.mouse.click(bossPt.x, bossPt.y);
        await page.waitForTimeout(500);

        const fight = await gsOf(`(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                mapOpen: ui._mapOpen,
                bossActive: gs.registry.get('bossActive'),
                locked: gs.registry.get('blockLocked'),
                hasBoss: !!gs.boss,
                bossId: gs.boss && gs.boss.def.id,
                hp: gs.boss && gs.boss.hp,
                maxHp: gs.boss && gs.boss.maxHp,
                blockHidden: !gs.block.visible,
                spriteVisible: gs.bossSprite && gs.bossSprite.visible,
                hpText: gs.bossHpText && gs.bossHpText.text,
                nameText: gs.bossName && gs.bossName.text,
                timeText: gs.bossTime && gs.bossTime.text,
                hasClose: !!gs.bossClose,
                itemBtns: gs.bossItems ? gs.bossItems.map((x) => ({ id: x.id, cnt: x.cnt.text })) : []
            };
        })()`);
        check('C1: тап босса на карте начал бой', !fight.mapOpen && fight.bossActive && fight.locked && fight.hasBoss && fight.bossId === 'boss_copper', JSON.stringify({ mapOpen: fight.mapOpen, bossActive: fight.bossActive, hasBoss: fight.hasBoss }));
        check('C2: блок скрыт на время боя', fight.blockHidden);
        check('C3: HP-текст «75K / 75K»', fight.hpText === '75K / 75K', fight.hpText);
        check('C4: имя босса над баром', fight.nameText === 'Медный страж', fight.nameText);
        check('C5: таймер «60с»', fight.timeText === '60с', fight.timeText);
        check('C6: крестик + слот бомбы «x2»', fight.hasClose && fight.itemBtns.length === 1 && fight.itemBtns[0].id === 'item_bomb' && fight.itemBtns[0].cnt === 'x2', JSON.stringify(fight.itemBtns));

        const setPt = await ptOf('({ x: ui.settingsBtn.x, y: ui.settingsBtn.y })');
        await page.mouse.click(setPt.x, setPt.y);
        await page.waitForTimeout(300);
        const settingsBlocked = await page.evaluate(() => !window.__GAME.scene.getScene('UIScene').modal.visible);
        check('D1: настройки не открываются в бою', settingsBlocked);

        const bombPt = await gsOf('({ x: gs.bossItems[0].btn.x, y: gs.bossItems[0].btn.y })');
        await page.mouse.click(bombPt.x, bombPt.y);
        await page.waitForTimeout(300);
        const bomb = await state('({ n: m.gameState.items.item_bomb, mult: m.gameState.bossBuffMult, active: m.gameState.bossBuffUntil > Date.now() })');
        const bombCnt = await gsOf('gs.bossItems[0].cnt.text');
        check('E1: бомба активирована (2->1, баф x2)', bomb.n === 1 && bomb.mult === 2 && bomb.active && bombCnt === 'x1', JSON.stringify(bomb) + ' cnt=' + bombCnt);

        const bossCenter = await gsOf('({ x: gs.blockX, y: gs.blockY })');
        await page.mouse.click(bossCenter.x, bossCenter.y);
        await page.waitForTimeout(300);
        const hpTextAfterHit = await gsOf('gs.bossHpText.text');
        check('F1: HP-текст уменьшился после удара', hpTextAfterHit !== '75K / 75K', hpTextAfterHit);

        await killLoop(page, bossCenter);
        const after = await gsOf(`(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { dead: !gs.boss, blockVisible: gs.block.visible, stage: gs.blockStage, interactive: gs.block.input.enabled, active: gs.registry.get('bossActive'), locked: gs.registry.get('blockLocked') };
        })()`);
        check('F2: босс убит ручными кликами', after.dead);
        check('F3: блок возвращён, стадия сохранена (2), интерактивен', after.blockVisible && after.stage === 2 && after.interactive, JSON.stringify({ stage: after.stage, interactive: after.interactive }));
        check('F4: bossActive снят, лок держит модалку награды', !after.active && after.locked, JSON.stringify(after));

        const rw = await rewardInfo(page);
        check('F5: модалка награды показана', rw.visible && rw.open, JSON.stringify({ visible: rw.visible, open: rw.open }));
        const bountyLine = rw.texts.find((t) => t.startsWith('Баунти: +'));
        const bountyStr = bountyLine ? bountyLine.slice('Баунти: +'.length).replace(/ руды$/, '') : '';
        check('F6: баунти = 90 сек полного дохода', bountyStr === bountyExpected, `${bountyStr} vs ${bountyExpected}`);
        const scrapLine = rw.texts.find((t) => /Ржавый лом ×(\d+)/.test(t));
        const scrapN = scrapLine ? parseInt(scrapLine.match(/×(\d+)/)[1], 10) : 0;
        const scrapState = await state('m.gameState.components.scrap');
        check('F7: дроп лома в таблице [2..4] и начислен', scrapN >= 2 && scrapN <= 4 && scrapState === scrapN, `text=${scrapN} state=${scrapState}`);
        check('F8: артефакт за первое убийство (иконка+имя+desc, в сейве)',
            rw.icons.includes('art_miner_totem') && rw.texts.includes('Тотем шахтёра') && rw.texts.includes('пассивная добыча x1.1')
            && (await state('m.gameState.artifacts.includes("art_miner_totem")') === true),
            JSON.stringify({ icons: rw.icons, hasName: rw.texts.includes('Тотем шахтёра') }));
        const scrap1 = scrapState;

        const claimPt = await ptOf('({ x: ui.bossRewardModal.x, y: ui.bossRewardModal.y + 150 })');
        await page.mouse.click(claimPt.x, claimPt.y);
        await page.waitForTimeout(400);
        const closed = await rewardInfo(page);
        check('G1: «Забрать» скрыл модалку и снял лок', !closed.visible && !closed.open && !closed.locked, JSON.stringify({ visible: closed.visible, open: closed.open, locked: closed.locked }));

        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(400);
        const nodeState = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const n = ui.mapNodes.find((x) => x.boss && x.boss.id === 'boss_copper');
            return { state: n._state, status: n.status.text };
        });
        check('G2: на карте статус «побеждён»', nodeState.state === 'defeated' && nodeState.status === 'побеждён', JSON.stringify(nodeState));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeMap());
        await page.waitForTimeout(400);

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(400);
        const refight = await gsOf('!!gs.boss');
        check('H1: ре-файт побеждённого босса доступен', refight);
        await killLoop(page, bossCenter);
        const artLen = await state('m.gameState.artifacts.length');
        const scrap2 = await state('m.gameState.components.scrap');
        const rw2 = await rewardInfo(page);
        check('H2: второй дроп есть, артефакт НЕ продублирован', rw2.visible && artLen === 1 && scrap2 >= scrap1 + 2, `art=${artLen} scrap ${scrap1}->${scrap2}`);
        await page.mouse.click(claimPt.x, claimPt.y);
        await page.waitForTimeout(400);
        check('H3: после закрытия награды лок снят', await gsOf('!gs.registry.get("blockLocked")'));

        const ore0 = await state('m.gameState.ore');
        await page.mouse.click(bossCenter.x, bossCenter.y);
        await page.waitForTimeout(300);
        const ore1 = await state('m.gameState.ore');
        check('I1: блок добывает после боя', ore1 > ore0, `${ore0} -> ${ore1}`);
        await page.close();
    }

    // ---------- Страница 2: робо-рука и ретрит (ландшафт) ----------
    {
        const { page, state, gsOf } = await newPage(mkSave({ levels: { pickaxe: 12, sledge: 2, dynamite: 0, lucky: 0, resonance: 0, focuslens: 0, magnet: 0, robotarm: 20, miner: 0, drill: 0, tech: 0 } }), { width: 1280, height: 720 });

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(400);
        const start = await gsOf('({ hpText: gs.bossHpText.text, time: gs.bossTime.text, active: gs.registry.get("bossActive") })');
        check('A1: бой стартовал напрямую, HP полный', start.active && /\/ 75K$/.test(start.hpText) && start.time === '60с', JSON.stringify(start));

        await page.waitForTimeout(2000);
        const auto = await gsOf('({ hp: gs.boss.hp, max: gs.boss.maxHp, time: gs.bossTime.text })');
        check('B1: робо-рука бьёт босса без ручных кликов', auto.hp < auto.max && auto.hp >= 70000, `hp=${Math.round(auto.hp)}`);
        check('B2: таймер боя тикает', parseInt(auto.time, 10) < 60, auto.time);

        await page.evaluate(() => { window.__GAME.scene.getScene('GameScene').boss.hp = 200; });
        await page.waitForTimeout(2500);
        const killed = await gsOf(`(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { dead: !gs.boss, active: gs.registry.get('bossActive'), blockVisible: gs.block.visible, locked: gs.registry.get('blockLocked'), modal: ui.bossRewardModal.visible };
        })()`);
        const defeated = await state('m.gameState.bossesDefeated.boss_copper === true');
        const clicks = await state('m.gameState.clicks');
        check('C1: робо-рука добила босса, награда выдана', killed.dead && defeated && killed.modal && !killed.active && killed.blockVisible, JSON.stringify(killed));
        check('C2: ручных кликов не было (clicks = 50)', clicks === 50, String(clicks));

        await page.mouse.click(640, 510); // «Забрать»
        await page.waitForTimeout(400);
        check('D1: модалка закрыта, лок снят', await gsOf('!gs.registry.get("blockLocked") && !window.__GAME.scene.getScene("UIScene").bossRewardModal.visible'));
        // снимок награды ДО ретрит-теста: награда уже выдана киллом C1 — ретрит не должен ничего добавить
        const rewardBefore = await state('({ art: m.gameState.artifacts.length, scrap: m.gameState.components.scrap || 0 })');

        await state('m.gameState.levels.robotarm = 0');
        for (let t = 0; t < 20 && await gsOf('gs.blockBusy'); t++) await page.waitForTimeout(150);
        await page.evaluate(() => { const gs = window.__GAME.scene.getScene('GameScene'); gs.blockStage = 0; gs.hitProgress = 0; });
        await page.mouse.click(400, 400); await page.waitForTimeout(350);
        await page.mouse.click(400, 400); await page.waitForTimeout(350);
        const stageA = await gsOf('gs.blockStage');
        check('E1: стадия блока 2 перед ретрит-тестом', stageA === 2, String(stageA));

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(300);
        await page.evaluate(() => { const gs = window.__GAME.scene.getScene('GameScene'); gs.boss.endsAt = gs.time.now + 800; });
        await page.waitForTimeout(1600);
        const retreat = await gsOf(`(() => {
            const floatSeen = gs.children.list.some((o) => o.type === 'Text' && o.text === 'Босс восстановился');
            return { gone: !gs.boss, blockVisible: gs.block.visible, stage: gs.blockStage, active: gs.registry.get('bossActive'), floatSeen };
        })()`);
        check('E2: ретрит по таймеру — босс ушёл, блок и стадия возвращены', retreat.gone && retreat.blockVisible && retreat.stage === 2 && !retreat.active, JSON.stringify(retreat));
        check('E3: флоат «Босс восстановился» показан', retreat.floatSeen);
        const noReward = await state('({ art: m.gameState.artifacts.length, scrap: m.gameState.components.scrap || 0 })');
        check('E4: ретрит без награды (дроп и артефакт не изменились)',
            noReward.art === rewardBefore.art && noReward.scrap === rewardBefore.scrap, JSON.stringify({ before: rewardBefore, after: noReward }));

        const ore0 = await state('m.gameState.ore');
        await page.mouse.click(400, 400);
        await page.waitForTimeout(300);
        const ore1 = await state('m.gameState.ore');
        check('E5: блок снова добывает после ретрита', ore1 > ore0, `${ore0} -> ${ore1}`);
        await page.close();
    }

    // ---------- Страница 3: портрет 390x844 ----------
    {
        const { page, gsOf } = await newPage(mkSave({ items: { item_bomb: 1 }, levels: { pickaxe: 30, sledge: 12, dynamite: 5, lucky: 0, resonance: 0, focuslens: 0, magnet: 0, robotarm: 0, miner: 10, drill: 5, tech: 3 } }), { width: 390, height: 844 });

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(400);
        const ovl = await gsOf(`(() => {
            const py = gs.L.panel.py;
            const inX = (x) => x > 0 && x < gs.L.W;
            const inY = (y) => y > 122 && y < py;
            return {
                W: gs.L.W, bx: gs.blockX, by: gs.blockY, py,
                sprite: gs.bossSprite && gs.bossSprite.visible,
                name: gs.bossName && { x: gs.bossName.x, y: gs.bossName.y, ok: inX(gs.bossName.x) && inY(gs.bossName.y) },
                close: gs.bossClose && { x: gs.bossClose.x, y: gs.bossClose.y, ok: inX(gs.bossClose.x) && inY(gs.bossClose.y) },
                item: gs.bossItems && gs.bossItems[0] && { x: gs.bossItems[0].btn.x, y: gs.bossItems[0].btn.y, ok: inX(gs.bossItems[0].btn.x) && inY(gs.bossItems[0].btn.y) },
                hpText: gs.bossHpText && gs.bossHpText.text,
                active: gs.registry.get('bossActive')
            };
        })()`);
        check('P1: портрет — оверлей собран в границах экрана',
            ovl.active && ovl.sprite && ovl.name.ok && ovl.close.ok && ovl.item.ok, JSON.stringify(ovl));
        check('P2: HP-текст и позиция бара от blockX/blockY',
            ovl.hpText === '75K / 75K' && Math.abs(ovl.bx - ovl.W / 2) <= 1, JSON.stringify({ hpText: ovl.hpText, bx: ovl.bx }));

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').bossClose.emit('pointerdown'));
        await page.waitForTimeout(400);
        const done = await gsOf('({ gone: !gs.boss, blockVisible: gs.block.visible, active: gs.registry.get("bossActive") })');
        check('P3: крестик оверлея уходит в ретрит (портрет)', done.gone && done.blockVisible && !done.active, JSON.stringify(done));
        await page.close();
    }

    console.log(`page errors: ${errors.length ? errors.join(' | ') : '0'}`);
    console.log(`итого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(errors.length || failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
