// Проверка боссов (П4 + R2/R3/R4): старт с карты (реальный путь тапа по слоту),
// HP/имя/счётчик прошедшего времени, слот боссового предмета (бомба), клик-килл
// с наградой (баунти = 90 сек дохода, дропы, артефакт только за первое убийство),
// повторный файт без дубля артефакта, робо-рука бьёт босса без ручных кликов,
// экраны карта/крафт/настройки открываются В бою, спуск/престиж/сброс заблокированы,
// бой жив «дольше 65с» (симуляция: startedAt/endsAt в прошлом — ретрита по времени нет),
// босс-тема замещает BGM на время боя и возвращается после (kill/ретрит DevPanel),
// SFX удара boss_hit_1..3, снятие лока после модалки награды, статус «побеждён»,
// сохранение стадии блока, портретный оверлей.
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

// «1:07» -> секунды (счётчик прошедшего времени боя m:ss)
const parseElapsed = (t) => {
    const m = /^(\d+):(\d{2})$/.exec(t || '');
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
};

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

    const bgmState = (page) => page.evaluate(() => {
        const s = window.__GAME.scene.getScene('GameScene').sound;
        const playing = s.getAllPlaying().map((x) => x.key);
        const theme = s.getAllPlaying().find((x) => x.key === 'boss_theme');
        return {
            themePlaying: !!theme && theme.isPlaying,
            themeLoop: !!theme && theme.loop,
            bgmPlaying: playing.includes('bgm'),
            playing
        };
    });

    // Текущий BGM сцены: ключ + mute (WebAudioSound/HTML5AudioSound имеют getter mute)
    const bgmMuteState = (page) => page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');
        return gs.bgm ? { key: gs.bgm.key, muted: !!gs.bgm.mute, playing: !!gs.bgm.isPlaying } : null;
    });

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
        // Баунти считается grantBossKill ДО выдачи артефакта — фиксируем ожидание заранее.
        // Клик-килл укладывается в <45 c -> бонус за скорость x1.5
        const bountyExpected = await state('m.fmt(Math.ceil(90 * m.getEarningRate() * m.bossSpeedMult(30000)))');

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
            return { x: v.x + n.root.x + n.ring.x, y: v.y + n.root.y + n.ring.y - ui.mapCam.scrollY };
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
        check('C1: тап босса на карте начал бой (бой НЕ держит blockLocked)',
            !fight.mapOpen && fight.bossActive && fight.locked === false && fight.hasBoss && fight.bossId === 'boss_copper',
            JSON.stringify({ mapOpen: fight.mapOpen, bossActive: fight.bossActive, locked: fight.locked, hasBoss: fight.hasBoss }));
        check('C2: блок скрыт на время боя', fight.blockHidden);
        check('C3: HP-текст «75K / 75K»', fight.hpText === '75K / 75K', fight.hpText);
        check('C4: имя босса над баром', fight.nameText === 'Медный страж', fight.nameText);
        check('C5: счётчик прошедшего времени стартует с «0:00»', fight.timeText === '0:00', fight.timeText);
        // Три боевых слота: бомба с запасом «x2», рама/точило пустые — «купить …»
        check('C6: крестика нет, 3 слота: бомба «x2», рама/точило — «купить»',
            !fight.hasClose && fight.itemBtns.length === 3
            && fight.itemBtns[0].id === 'item_bomb' && fight.itemBtns[0].cnt === 'x2'
            && fight.itemBtns[1].id === 'item_rig' && !fight.itemBtns[1].cnt
            && fight.itemBtns[2].id === 'item_oil' && !fight.itemBtns[2].cnt,
            JSON.stringify(fight));

        // R2: настройки/карта/крафт открываются В бою; спуск/престиж/сброс заблокированы
        await state('m.gameState.tierEarned[11] = 1e12');
        const canPr = await state('m.canPrestige()');
        check('D2a: предусловие — canPrestige=true (disabled-текстура в бою именно от боя)', canPr === true, String(canPr));
        const setPt = await ptOf('({ x: ui.settingsBtn.x, y: ui.settingsBtn.y })');
        await page.mouse.click(setPt.x, setPt.y);
        await page.waitForTimeout(300);
        const settings = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { open: ui.modal.visible, presTex: ui.prestigeBtn.texture.key, presText: ui.prestigeText.text, resetText: ui.resetText.text };
        });
        check('D1: настройки открываются в бою', settings.open, JSON.stringify(settings));
        check('D2: престиж в бою — disabled-текстура, клик не активирует',
            settings.presTex === 'buy_button_disabled_gray',
            settings.presTex);
        await page.mouse.click(640, 518); // prestigeBtn (0,158) от модалки (640,360)
        await page.waitForTimeout(200);
        const presAfter = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { text: ui.prestigeText.text, armed: ui.prestigeArmed };
        });
        check('D3: клик престижа в бою глотается (не armed)', presAfter.text === 'Сбросить шахту' && presAfter.armed === false, JSON.stringify(presAfter));
        await page.mouse.click(640, 576); // resetBtn (0,216)
        await page.waitForTimeout(200);
        const resetAfter = await page.evaluate(() => window.__GAME.scene.getScene('UIScene').resetText.text);
        check('D4: клик сброса в бою глотается', resetAfter === 'Сбросить весь прогресс', resetAfter);
        await page.mouse.click(860, 132); // крестик настроек
        await page.waitForTimeout(300);
        const afterSettings = await gsOf('({ alive: !!gs.boss, sprite: gs.bossSprite && gs.bossSprite.visible, active: gs.registry.get("bossActive") })');
        check('D5: после закрытия настроек бой жив, оверлей цел', afterSettings.alive && afterSettings.sprite && afterSettings.active, JSON.stringify(afterSettings));

        // Фикспак: музыка выключается В бою — syncBgm глушит активную босс-тему;
        // после kill вернувшийся BGM обязан остаться заглушённым (syncBgm в stopBossBgm)
        await state('m.gameState.musicOn = false');
        await page.evaluate(() => window.__GAME.events.emit('music-changed'));
        await page.waitForTimeout(250);
        const bgmOffFight = await bgmMuteState(page);
        check('D8b: музыка «выкл» в бою — босс-тема заглушена',
            !!bgmOffFight && bgmOffFight.key === 'boss_theme' && bgmOffFight.muted, JSON.stringify(bgmOffFight));

        await page.mouse.click(mapBtnPt.x, mapBtnPt.y);
        await page.waitForTimeout(300);
        const mapInFight = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { open: ui._mapOpen, active: window.__GAME.registry.get('bossActive'), alive: !!window.__GAME.scene.getScene('GameScene').boss };
        });
        check('D6: карта открывается в бою, бой продолжается', mapInFight.open && mapInFight.active && mapInFight.alive, JSON.stringify(mapInFight));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeMap());
        await page.waitForTimeout(250);
        const aliveAfterMap = await gsOf('!!gs.boss && gs.bossSprite.visible');
        check('D7: после закрытия карты бой жив', aliveAfterMap === true, String(aliveAfterMap));

        const craftBtnPt = await ptOf('({ x: ui.craftBtn.x, y: ui.craftBtn.y })');
        await page.mouse.click(craftBtnPt.x, craftBtnPt.y);
        await page.waitForTimeout(300);
        const craftInFight = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { open: ui._craftOpen, active: window.__GAME.registry.get('bossActive'), alive: !!window.__GAME.scene.getScene('GameScene').boss };
        });
        check('D8: крафт открывается в бою', craftInFight.open && craftInFight.active && craftInFight.alive, JSON.stringify(craftInFight));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeCraft());
        await page.waitForTimeout(250);

        const bombPt = await gsOf('({ x: gs.bossItems[0].btn.x, y: gs.bossItems[0].btn.y })');
        await page.mouse.click(bombPt.x, bombPt.y);
        await page.waitForTimeout(300);
        const bomb = await state('({ n: m.gameState.items.item_bomb, mult: m.gameState.bossBuffMult, active: m.gameState.bossBuffUntil > Date.now() })');
        const bombCnt = await gsOf('gs.bossItems[0].cnt.text');
        // Слот в состоянии активного бафа: иконка + таймер «0:30» (иконка больше
        // не «пропадает» после активации — замечание игрока)
        check('E1: бомба активирована (2->1, баф x2, слот показывает таймер)',
            bomb.n === 1 && bomb.mult === 2 && bomb.active && /^\d+:\d{2}$/.test(bombCnt || ''), JSON.stringify(bomb) + ' cnt=' + bombCnt);

        const bossCenter = await gsOf('({ x: gs.blockX, y: gs.blockY })');
        await page.mouse.click(bossCenter.x, bossCenter.y);
        await page.waitForTimeout(120);
        const hitSfx = await page.evaluate(() => {
            const s = window.__GAME.scene.getScene('GameScene').sound;
            return s.getAllPlaying().map((x) => x.key).some((k) => k.startsWith('boss_hit'));
        });
        const hpTextAfterHit = await gsOf('gs.bossHpText.text');
        check('F1: HP-текст уменьшился после удара', hpTextAfterHit !== '75K / 75K', hpTextAfterHit);
        check('F1b: ручной удар звучит boss_hit_1..3 (не pickaxe)', hitSfx);

        await killLoop(page, bossCenter);
        const after = await gsOf(`(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { dead: !gs.boss, blockVisible: gs.block.visible, stage: gs.blockStage, interactive: gs.block.input.enabled, active: gs.registry.get('bossActive'), locked: gs.registry.get('blockLocked') };
        })()`);
        check('F2: босс убит ручными кликами', after.dead);
        check('F3: блок возвращён, стадия сохранена (2), интерактивен', after.blockVisible && after.stage === 2 && after.interactive, JSON.stringify({ stage: after.stage, interactive: after.interactive }));
        check('F4: bossActive снят, лок держит модалка награды', !after.active && after.locked, JSON.stringify(after));

        const bgmAfterKill = await bgmState(page);
        check('F9: после убийства босс-тема ушла, обычный BGM вернулся',
            !bgmAfterKill.themePlaying && bgmAfterKill.bgmPlaying, JSON.stringify(bgmAfterKill));
        const bgmAfterKillMute = await bgmMuteState(page);
        check('F9b: mute, выставленный в бою, применён к вернувшемуся BGM',
            !!bgmAfterKillMute && bgmAfterKillMute.key === 'bgm' && bgmAfterKillMute.muted, JSON.stringify(bgmAfterKillMute));
        await state('m.gameState.musicOn = true');
        await page.evaluate(() => window.__GAME.events.emit('music-changed'));
        await page.waitForTimeout(250);

        const rw = await rewardInfo(page);
        check('F5: модалка награды показана', rw.visible && rw.open, JSON.stringify({ visible: rw.visible, open: rw.open }));
        const bountyLine = rw.texts.find((t) => t.startsWith('Баунти: +'));
        const bountyStr = bountyLine ? bountyLine.slice('Баунти: +'.length).replace(/ руды$/, '') : '';
        check('F6: баунти = 90 сек дохода x бонус за скорость (<45с -> x1.5)', bountyStr === bountyExpected, `${bountyStr} vs ${bountyExpected}`);
        const scrapLine = rw.texts.find((t) => /Ржавый лом ×(\d+)/.test(t));
        const scrapN = scrapLine ? parseInt(scrapLine.match(/×(\d+)/)[1], 10) : 0;
        const scrapState = await state('m.gameState.components.scrap');
        check('F7: дроп лома в таблице [2..4] и начислен', scrapN >= 2 && scrapN <= 4 && scrapState === scrapN, `text=${scrapN} state=${scrapState}`);
        check('F8: артефакт за первое убийство (иконка+имя+desc, в сейве)',
            rw.icons.includes('art_miner_totem') && rw.texts.includes('Тотем шахтёра') && rw.texts.includes('пассивная добыча x1.1')
            && (await state('m.gameState.artifacts.includes("art_miner_totem")') === true),
            JSON.stringify({ icons: rw.icons, hasName: rw.texts.includes('Тотем шахтёра') }));
        const speedLine = rw.texts.find((t) => t.startsWith('Время:'));
        check('F6b: в награде время боя и бонус за скорость', /^Время: \d+:\d{2} · бонус x1\.5$/.test(speedLine || ''), speedLine);
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
        // Статус с рекордом скорости: «побеждён · m:ss» (рекорд пишется grantBossKill)
        check('G2: на карте статус «побеждён» с рекордом времени',
            nodeState.state.startsWith('defeated') && /^побеждён · \d+:\d{2}$/.test(nodeState.status), JSON.stringify(nodeState));
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

    // ---------- Страница 2: робо-рука, бой без лимита, спуск/ретрит (ландшафт) ----------
    {
        const { page, state, ptOf, gsOf } = await newPage(mkSave({ levels: { pickaxe: 12, sledge: 2, dynamite: 0, lucky: 0, resonance: 0, focuslens: 0, magnet: 0, robotarm: 20, miner: 0, drill: 0, tech: 0 } }), { width: 1280, height: 720 });

        // База для D2: вне боя (canPrestige) престиж — normal-текстура,
        // т.е. disabled в бою на странице 1 обусловлен именно боем
        await state('m.gameState.tierEarned[11] = 1e12');
        const setPt2 = await ptOf('({ x: ui.settingsBtn.x, y: ui.settingsBtn.y })');
        await page.mouse.click(setPt2.x, setPt2.y);
        await page.waitForTimeout(300);
        const presNormal = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { open: ui.modal.visible, tex: ui.prestigeBtn.texture.key };
        });
        check('A1b: вне боя престиж — normal-текстура (база для D2)', presNormal.open && presNormal.tex === 'buy_button_normal', JSON.stringify(presNormal));
        await page.mouse.click(860, 132); // крестик настроек
        await page.waitForTimeout(300);

        // Фикспак: музыка выключена ДО боя, включается В бою — после kill
        // вернувшийся BGM обязан размьючиться (иначе «тишина» при включённой музыке)
        await state('m.gameState.musicOn = false');
        await page.evaluate(() => window.__GAME.events.emit('music-changed'));
        await page.waitForTimeout(250);
        const bgmOffPre = await bgmMuteState(page);
        check('A0: музыка «выкл» до боя — обычный BGM заглушен',
            !!bgmOffPre && bgmOffPre.key === 'bgm' && bgmOffPre.muted, JSON.stringify(bgmOffPre));

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(400);
        const start = await gsOf('({ hpText: gs.bossHpText.text, time: gs.bossTime.text, active: gs.registry.get("bossActive") })');
        check('A1: бой стартовал напрямую, HP полный, таймер «0:00»', start.active && /\/ 75K$/.test(start.hpText) && start.time === '0:00', JSON.stringify(start));

        const keys = await page.evaluate(() => {
            const c = window.__GAME.scene.getScene('GameScene').cache.audio;
            return ['boss_hit_1', 'boss_hit_2', 'boss_hit_3', 'boss_theme'].filter((k) => !c.exists(k));
        });
        check('A2: ключи boss_hit_1..3 и boss_theme в аудио-кэше', keys.length === 0, `missing: ${keys.join(', ')}`);

        await page.waitForTimeout(2000);
        const auto = await gsOf('({ hp: gs.boss.hp, max: gs.boss.maxHp, time: gs.bossTime.text })');
        check('B1: робо-рука бьёт босса без ручных кликов', auto.hp < auto.max && auto.hp >= 70000, `hp=${Math.round(auto.hp)}`);
        const elapsed = parseElapsed(auto.time);
        check('B2: счётчик прошедшего времени тикает (m:ss)', elapsed >= 1 && elapsed <= 6, auto.time);

        const bgmFight = await bgmState(page);
        check('B3: босс-тема играет лупом, обычный BGM остановлен',
            bgmFight.themePlaying && bgmFight.themeLoop && !bgmFight.bgmPlaying, JSON.stringify(bgmFight));

        await state('m.gameState.musicOn = true');
        await page.evaluate(() => window.__GAME.events.emit('music-changed'));
        await page.waitForTimeout(250);
        const bgmOnFight = await bgmMuteState(page);
        check('B3b: музыка включена в бою — босс-тема играет без mute',
            !!bgmOnFight && bgmOnFight.key === 'boss_theme' && !bgmOnFight.muted && bgmOnFight.playing, JSON.stringify(bgmOnFight));

        await page.mouse.click(400, 400);
        await page.waitForTimeout(120);
        const hitSfx = await page.evaluate(() => {
            const s = window.__GAME.scene.getScene('GameScene').sound;
            return s.getAllPlaying().map((x) => x.key).some((k) => k.startsWith('boss_hit'));
        });
        check('B4: ручной удар играет boss_hit_1..3', hitSfx);

        await page.evaluate(() => { window.__GAME.scene.getScene('GameScene').boss.hp = 200; });
        await page.waitForTimeout(2500);
        const killed = await gsOf(`(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { dead: !gs.boss, active: gs.registry.get('bossActive'), blockVisible: gs.block.visible, locked: gs.registry.get('blockLocked'), modal: ui.bossRewardModal.visible };
        })()`);
        const defeated = await state('m.gameState.bossesDefeated.boss_copper === true');
        const clicks = await state('m.gameState.clicks');
        check('C1: робо-рука добила босса, награда выдана', killed.dead && defeated && killed.modal && !killed.active && killed.blockVisible, JSON.stringify(killed));
        check('C2: ручных кликов не было (clicks = 50; удары по боссу счётчик кликов не растят)', clicks === 50, String(clicks));

        await page.mouse.click(640, 510); // «Забрать»
        await page.waitForTimeout(400);
        check('D1: модалка закрыта, лок снят', await gsOf('!gs.registry.get("blockLocked") && !window.__GAME.scene.getScene("UIScene").bossRewardModal.visible'));
        const bgmRestored = await bgmMuteState(page);
        check('D1b: музыка, включённая в бою, применена к вернувшемуся BGM (не тишина)',
            !!bgmRestored && bgmRestored.key === 'bgm' && !bgmRestored.muted && bgmRestored.playing, JSON.stringify(bgmRestored));

        // Фикспак: робо-рука добивает босса при открытой мастерской — окно награды
        // вытесняет крафт (флаг до closeCraft; daily не вскроется поверх), «Забрать»
        // кликается по кнопке награды, ряды крафта не срабатывают, крафт переоткрывается
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(400);
        const craftBtnPt2 = await ptOf('({ x: ui.craftBtn.x, y: ui.craftBtn.y })');
        await page.mouse.click(craftBtnPt2.x, craftBtnPt2.y);
        await page.waitForTimeout(300);
        const k1 = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { open: ui._craftOpen, root: ui.craftRoot.visible };
        });
        check('K1: крафт открыт в бою', k1.open && k1.root, JSON.stringify(k1));
        await page.evaluate(() => { window.__GAME.scene.getScene('GameScene').boss.hp = 200; });
        await page.waitForTimeout(2500);
        const k2 = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return {
                reward: ui.bossRewardModal.visible, open: ui._bossRewardOpen,
                craftOpen: ui._craftOpen, craftRoot: ui.craftRoot.visible, craftDim: ui.craftDim.visible,
                mapOpen: ui._mapOpen, locked: window.__GAME.registry.get('blockLocked')
            };
        });
        check('K2: добитие робо-рукой при открытом крафте — окно награды вытеснило мастерскую',
            k2.reward && k2.open && !k2.craftOpen && !k2.craftRoot && !k2.craftDim && !k2.mapOpen && k2.locked, JSON.stringify(k2));
        const claimHit = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            const btn = ui.bossRewardModal.list.find((o) => o.texture && o.texture.key === 'buy_button_normal');
            return { x: ui.bossRewardModal.x + btn.x, y: ui.bossRewardModal.y + btn.y };
        });
        const invBefore = await state('JSON.stringify({ i: m.gameState.items, c: m.gameState.components, cr: m.gameState.crafting })');
        await page.mouse.click(claimHit.x, claimHit.y);
        await page.waitForTimeout(400);
        const k3 = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { visible: ui.bossRewardModal.visible, open: ui._bossRewardOpen, locked: window.__GAME.registry.get('blockLocked') };
        });
        check('K3: «Забрать» кликается по кнопке награды (хит-тест центра кнопки)', !k3.visible && !k3.open && !k3.locked, JSON.stringify(k3));
        const invAfter = await state('JSON.stringify({ i: m.gameState.items, c: m.gameState.components, cr: m.gameState.crafting })');
        check('K4: ряды крафта не сработали (предметы/компоненты/крафт не изменились от клика)', invAfter === invBefore, `${invBefore} -> ${invAfter}`);
        await page.mouse.click(craftBtnPt2.x, craftBtnPt2.y);
        await page.waitForTimeout(300);
        const k5 = await page.evaluate(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { open: ui._craftOpen, root: ui.craftRoot.visible };
        });
        check('K5: после закрытия награды крафт открывается заново', k5.open && k5.root, JSON.stringify(k5));
        await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeCraft());
        await page.waitForTimeout(250);
        // снимок награды ДО ретрит-теста: награды выданы киллами C1 и K — ретрит не должен ничего добавить
        const rewardBefore = await state('({ art: m.gameState.artifacts.length, scrap: m.gameState.components.scrap || 0 })');

        await state('m.gameState.levels.robotarm = 0');
        for (let t = 0; t < 20 && await gsOf('gs.blockBusy'); t++) await page.waitForTimeout(150);
        await page.evaluate(() => { const gs = window.__GAME.scene.getScene('GameScene'); gs.blockStage = 0; gs.hitProgress = 0; });
        await page.mouse.click(400, 400); await page.waitForTimeout(350);
        await page.mouse.click(400, 400); await page.waitForTimeout(350);
        const stageA = await gsOf('gs.blockStage');
        check('E1: стадия блока 2 перед проверкой боя без лимита', stageA === 2, String(stageA));

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(300);
        // Симуляция «бой > 65с»: часы боя в прошлом (и endsAt тоже — по нему
        // ретрита больше нет) — бой обязан продолжаться, счётчик показать 1:07
        await page.evaluate(() => {
            const gs = window.__GAME.scene.getScene('GameScene');
            gs.boss.startedAt = gs.time.now - 67000;
            gs.boss.endsAt = gs.time.now - 1000;
        });
        await page.waitForTimeout(400);
        const longFight = await gsOf(`(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            return { alive: !!gs.boss, active: gs.registry.get('bossActive'), time: gs.bossTime.text, locked: gs.registry.get('blockLocked') };
        })()`);
        const longSecs = parseElapsed(longFight.time);
        check('E2: бой жив «>65с» — ретрита по времени нет, счётчик 1:07',
            longFight.alive && longFight.active && longSecs >= 66 && longSecs <= 69 && longFight.locked === false,
            JSON.stringify(longFight));

        await state('m.gameState.ore = 1000000000');
        await page.waitForTimeout(300);
        const canUnlock = await state('m.canUnlockTier()');
        check('E3a: предусловие — спуск доступен по руде (canUnlockTier)', canUnlock === true, String(canUnlock));
        const unlockVis = await ptOf('({ visible: ui.unlockBtn.visible, textVisible: ui.unlockText.visible })');
        check('E3b: спуск в бою скрыт (серая кнопка рядом с боссом вводила в заблуждение)',
            !unlockVis.visible && !unlockVis.textVisible, JSON.stringify(unlockVis));
        // Клик в зоне, где кнопка спуска была бы, ничего не меняет (гвард в хендлере)
        const unlockPt = await ptOf('({ x: ui.unlockBtn.x + 260, y: ui.unlockBtn.y + 26 })');
        const tierBefore = await state('m.gameState.tier');
        await page.mouse.click(unlockPt.x, unlockPt.y);
        await page.waitForTimeout(400);
        const tierAfter = await state('m.gameState.tier');
        check('E3: спуск заблокирован в бою (клик в зоне спуска глотается)', tierAfter === tierBefore, `${tierBefore} -> ${tierAfter}`);

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').retreatBoss());
        await page.waitForTimeout(600); // флоат «Босс восстановился» живёт 1100мс — ловим до затухания
        const retreat = await gsOf(`(() => {
            const floatSeen = gs.children.list.some((o) => o.type === 'Text' && o.text === 'Босс восстановился');
            return { gone: !gs.boss, blockVisible: gs.block.visible, stage: gs.blockStage, active: gs.registry.get('bossActive'), floatSeen };
        })()`);
        check('E4: DevPanel-ретрит — босс ушёл, блок и стадия возвращены', retreat.gone && retreat.blockVisible && retreat.stage === 2 && !retreat.active, JSON.stringify(retreat));
        check('E5: флоат «Босс восстановился» показан', retreat.floatSeen);
        const unlockBack = await ptOf('ui.unlockBtn.visible');
        check('E3c: после боя спуск снова виден', unlockBack === true, String(unlockBack));
        const bgmAfterRetreat = await bgmState(page);
        check('E6: после ретрита босс-тема ушла, обычный BGM вернулся',
            !bgmAfterRetreat.themePlaying && bgmAfterRetreat.bgmPlaying, JSON.stringify(bgmAfterRetreat));
        const noReward = await state('({ art: m.gameState.artifacts.length, scrap: m.gameState.components.scrap || 0 })');
        check('E7: ретрит без награды (дроп и артефакт не изменились)',
            noReward.art === rewardBefore.art && noReward.scrap === rewardBefore.scrap, JSON.stringify({ before: rewardBefore, after: noReward }));

        const ore0 = await state('m.gameState.ore');
        await page.mouse.click(400, 400);
        await page.waitForTimeout(300);
        const ore1 = await state('m.gameState.ore');
        check('E8: блок снова добывает после ретрита', ore1 > ore0, `${ore0} -> ${ore1}`);
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
                close: gs.bossClose,
                time: gs.bossTime && gs.bossTime.text,
                item: gs.bossItems && gs.bossItems[0] && { x: gs.bossItems[0].btn.x, y: gs.bossItems[0].btn.y, ok: inX(gs.bossItems[0].btn.x) && inY(gs.bossItems[0].btn.y) },
                hpText: gs.bossHpText && gs.bossHpText.text,
                active: gs.registry.get('bossActive')
            };
        })()`);
        check('P1: портрет — оверлей собран в границах экрана, крестика нет',
            ovl.active && ovl.sprite && ovl.name.ok && !ovl.close && ovl.item.ok && ovl.time === '0:00', JSON.stringify({ ...ovl, close: !!ovl.close }));
        check('P2: HP-текст и позиция бара от blockX/blockY',
            ovl.hpText === '75K / 75K' && Math.abs(ovl.bx - ovl.W / 2) <= 1, JSON.stringify({ hpText: ovl.hpText, bx: ovl.bx }));

        const bgmPortrait = await bgmState(page);
        check('P3: босс-тема играет и в портрете', bgmPortrait.themePlaying && !bgmPortrait.bgmPlaying, JSON.stringify(bgmPortrait));

        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').retreatBoss());
        await page.waitForTimeout(1300);
        const done = await gsOf('({ gone: !gs.boss, blockVisible: gs.block.visible, active: gs.registry.get("bossActive") })');
        check('P4: ретрит (DevPanel) в портрете возвращает блок', done.gone && done.blockVisible && !done.active, JSON.stringify(done));
        await page.close();
    }

    // ---------- Страница 4: персист боя (F5 продолжает) + секция «Снаряжение» ----------
    // Тир 1 (медь, 75K HP): ОДИН клик (~13K урона) наносит урон, не убивая.
    // Руда 5M покрывает динамическую цену бомбы (60с дохода, ~1.8M на этой сетке).
    {
        const { page, state, gsOf, ptOf } = await newPage(mkSave({ ore: 5e6, tier: 1, tierEarned: [1e5, 5000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), { width: 1280, height: 720 });
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_copper'));
        await page.waitForTimeout(500);

        // Панель в бою: «Снаряжение» вместо списка улучшений (замечание игрока)
        const gear = await ptOf('({ gear: ui.gearContent.visible, list: ui.listContent.visible, stock: ui.gearRows[0].stock.text, buyLbl: ui.gearRows[0].buyLbl.text, useLbl: ui.gearRows[0].useLbl.text })');
        check('G1: в бою панель показывает «Снаряжение» вместо улучшений', gear.gear && !gear.list, JSON.stringify(gear));
        check('G2: ряд снаряжения — запас и динамическая цена', /^в запасе: \d+$/.test(gear.stock) && /^Купить · /.test(gear.buyLbl) && gear.useLbl === 'Использовать', JSON.stringify(gear));

        // Слот под боссом (пока пуст): «купить N», подсказка эффекта под слотами
        const slot = await gsOf('({ buyLbl: gs.bossItems[0].buyLbl.visible ? gs.bossItems[0].buyLbl.text : null, cnt: gs.bossItems[0].cnt.visible ? gs.bossItems[0].cnt.text : null, hint: gs.bossHint && gs.bossHint.text })');
        check('G4: слот бомбы — понятная подпись покупки', /^купить \d/.test(slot.buyLbl || ''), JSON.stringify(slot));
        check('G5: под слотами подсказка эффекта (что даёт покупка)', /урон/i.test(slot.hint || ''), slot.hint);

        // Покупка кликом по кнопке снаряжения (add.image — x/y уже центр кнопки)
        const buyPt = await ptOf('({ x: ui.gearRows[0].buyBtn.x, y: ui.gearRows[0].buyBtn.y })');
        await page.mouse.click(buyPt.x, buyPt.y);
        await page.waitForTimeout(400);
        const afterBuy = await state('({ stock: m.gameState.items.item_bomb || 0 })');
        check('G3: покупка снаряжения из панели работает', afterBuy.stock === 1, JSON.stringify(afterBuy));

        // Персист: один клик по боссу -> форс-сейв -> F5 -> бой продолжается
        const sprite0 = await gsOf('({ x: gs.bossSprite.x, y: gs.bossSprite.y })');
        await page.mouse.click(sprite0.x, sprite0.y);
        await page.waitForTimeout(400);
        const beforeReload = await gsOf('({ hp: gs.boss.hp, maxHp: gs.boss.maxHp, elapsed: Math.floor((gs.time.now - gs.boss.startedAt) / 1000) })');
        check('G6: урон засчитан до перезагрузки', beforeReload.hp < beforeReload.maxHp, JSON.stringify(beforeReload));
        await state('m.saveGame()'); // форсируем персист вне троттлинга 3с
        await page.waitForTimeout(200);
        // F5 = перезагрузка с ТЕКУЩИМ сейвом: читаем его из localStorage и
        // открываем новую страницу с ним (addInitScript исходной страницы при
        // reload перезаписал бы localStorage стартовым сейвом)
        const savedJson = await page.evaluate(() => localStorage.getItem('ore-rush-save'));
        await page.close();
        const p2 = await newPage(savedJson, { width: 1280, height: 720 });
        await p2.page.waitForTimeout(1000);
        const restored = await p2.gsOf('({ alive: !!gs.boss, hp: gs.boss && gs.boss.hp, maxHp: gs.boss && gs.boss.maxHp, active: gs.registry.get("bossActive"), blockHidden: !gs.block.visible, time: gs.bossTime && gs.bossTime.text })');
        check('G7: F5 продолжает бой (босс жив, HP восстановлен)',
            restored.alive && restored.active && restored.blockHidden && Math.abs(restored.hp - beforeReload.hp) <= 1 && restored.maxHp === beforeReload.maxHp,
            JSON.stringify({ restored, beforeReload }));
        check('G8: счётчик времени продолжается с сохранённого', parseElapsed(restored.time) >= beforeReload.elapsed - 1, restored.time);

        // После продолжения боя убийство чистит персист-запись
        const pt2 = await p2.gsOf('({ x: gs.bossSprite.x, y: gs.bossSprite.y })');
        await killLoop(p2.page, pt2);
        const after = await p2.state('({ bossFight: m.gameState.bossFight, items: m.gameState.items.item_bomb || 0 })');
        check('G9: после победы персист-запись боя очищена', after.bossFight === null, JSON.stringify(after));
        await p2.page.close();
    }

    // ---------- Страница 5: боевые предметы №2-3 (робо-рама / точильный камень) ----------
    // Платиновый босс (HP ~1.38 млрд) + НУЛЕВЫЕ апгрейды (урон ~9 x 3^9 ≈ 177K за
    // авто-удар): статистические замеры 3с его не убивают, ratio читается.
    // Рама усиливает ТОЛЬКО авто-удары — меряем средний авто-урон за окно.
    {
        const { page, state, gsOf } = await newPage(mkSave({ ore: 5e6, tier: 9, tierEarned: [1e5, 5000, 0, 0, 0, 0, 0, 0, 0, 3e5, 0, 0], items: { item_rig: 2, item_oil: 2 }, levels: { robotarm: 50 } }), { width: 1280, height: 720 });
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').startBossFight('boss_platinum'));
        await page.waitForTimeout(500);
        const slots = await gsOf('({ n: gs.bossItems.length, ids: gs.bossItems.map((s) => s.id) })');
        check('H1: в бою три боевых слота (бомба/рама/точило)', slots.n === 3 && slots.ids.includes('item_bomb') && slots.ids.includes('item_rig') && slots.ids.includes('item_oil'), JSON.stringify(slots));

        // Средний авто-урон за окно: d(hp) / (rate x время) — крит-шум усредняется
        const measureAuto = async () => {
            const alive = await gsOf('({ alive: !!gs.boss, active: gs.registry.get("bossActive"), hp: gs.boss && gs.boss.hp, blocked: gs.registry.get("blockLocked") })');
            if (!alive.alive) return { dead: alive };
            const hp0 = alive.hp;
            const rate = await state('m.getAutoClicksPerSecond()');
            const t0 = Date.now();
            await page.waitForTimeout(3000);
            const hp1 = await gsOf('gs.boss.hp');
            const dt = (Date.now() - t0) / 1000;
            return { avg: (hp0 - hp1) / (rate * dt), rate, dt, hp0, hp1 };
        };
        const m1 = await measureAuto();
        await state('m.useItem("item_rig", true)');
        const rigOn = await state('({ mult: m.getRigBuffMult(), n: m.gameState.items.item_rig })');
        const m2 = await measureAuto();
        const ratio = m2.avg / m1.avg;
        check('H2: робо-рама усиливает авто-удар x3',
            rigOn.mult === 3 && rigOn.n === 1 && ratio > 2.4 && ratio < 3.6,
            JSON.stringify({ ratio: Math.round(ratio * 100) / 100, m1: Math.round(m1.avg), m2: Math.round(m2.avg), rigOn }));
        // Точильный камень: баф-слот и таймер в слоте (обновление из update())
        await state('m.useItem("item_oil", true)');
        await page.waitForTimeout(300);
        const oil = await state('({ add: m.getOilBuffAdd(), n: m.gameState.items.item_oil })');
        const oilSlot = await gsOf('gs.bossItems.find((s) => s.id === "item_oil").cnt.text');
        check('H3: точильный камень — +25% крит и таймер в слоте',
            oil.add === 0.25 && oil.n === 1 && /^\d+:\d{2}$/.test(oilSlot || ''), JSON.stringify({ oil, oilSlot }));
        // Детерминированный крит: мок между базовым шансом и шансом с бафом
        const critProbe = await state(`(() => {
            const base = m.getCritChance();
            const realRandom = Math.random;
            Math.random = () => Math.min(0.999, base + 0.1);
            const noBuff = m.rollClickGain(null).crit;
            const withBuff = m.rollBossHit().crit;
            Math.random = realRandom;
            return { base, noBuff, withBuff };
        })()`);
        check('H4: точильный камень даёт крит там, где без него не было',
            critProbe.noBuff === false && critProbe.withBuff === true, JSON.stringify(critProbe));
        await page.evaluate(() => window.__GAME.scene.getScene('GameScene').retreatBoss());
        await page.waitForTimeout(600);
        await page.close();
    }

    console.log(`page errors: ${errors.length ? errors.join(' | ') : '0'}`);
    console.log(`итого: ${passed} OK, ${failed} FAIL`);
    await b.close();
    process.exit(errors.length || failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
