// CHARACTERIZATION-ТЕСТЫ: src/state.js — сейв/миграции v1..v5, офлайн,
// saveLastExit/readLastExit, resetGame; src/sdk-stub.js — слоты сейва.
// Случайности нет; Date.now()-зависимые поля сверяются на «не resurrect»/дельту.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { importState, importSdkStub } from './helpers/globals.mjs';

const S = await importState();
const SDK = await importSdkStub();

beforeEach(() => {
    S.resetGame();
    localStorage.clear();
});

describe('saveGame: формат JSON-сейва под ключом ore-rush-save', () => {
    it('полный снапшот состояния (golden структура и значения)', () => {
        S.gameState.ore = 1500;
        S.gameState.levels.pickaxe = 3;
        S.gameState.levels.miner = 2;
        S.saveGame();
        const raw = localStorage.getItem(S.SAVE_KEY);
        assert.deepEqual(JSON.parse(raw), {
            version: 5,
            ore: 1500,
            tier: 0,
            stars: 0,
            clicks: 0,
            lifetimeMined: 0,
            tierEarned: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            tierAnchorRate: 0,
            tutorialDone: false,
            soundOn: true,
            musicOn: true,
            musicVolume: 0.5,
            dailyStreak: 0,
            lastDailyDay: 0,
            dailyBuffUntil: 0,
            dailyBuffMult: 1,
            dailyCritUntil: 0,
            dailyVeinUntil: 0,
            components: {},
            artifacts: [],
            items: {},
            crafting: null,
            bossesDefeated: {},
            bossFight: null,
            bestBossTimes: {},
            miningBuffUntil: 0,
            miningBuffMult: 1,
            bossBuffUntil: 0,
            bossBuffMult: 1,
            itemVeinUntil: 0,
            rigBuffUntil: 0,
            rigBuffMult: 1,
            oilBuffUntil: 0,
            oilBuffAdd: 0,
            levels: {
                pickaxe: 3,
                sledge: 0,
                hydraulic: 0,
                plasma: 0,
                disintegrator: 0,
                miner: 2,
                robotarm: 0,
                drill: 0,
                excavator: 0,
                factory: 0,
                quarry: 0,
                megafactory: 0,
                orbital: 0,
                quantumlab: 0,
                wormhole: 0,
                singularity: 0,
                dyson: 0,
                tech: 0,
                aicore: 0,
                helmet: 0,
                dynamite: 0,
                lucky: 0,
                resonance: 0,
                focuslens: 0,
                magnet: 0,
                lantern: 0,
                warehouse: 0
            }
        });
    });
});

describe('applySave: миграции v1..v5', () => {
    it('v1 (уголь, 3 улучшения): прочие уровни игнорируются, обучение пропускается', () => {
        S.applySave({
            version: 1,
            coal: 100,
            clicks: 5,
            totalMined: 150,
            levels: { pickaxe: 3, dynamite: 2, miner: 1, sledge: 7 }
        });
        assert.equal(S.gameState.ore, 100);
        assert.equal(S.gameState.tier, 0);
        assert.equal(S.gameState.clicks, 5);
        assert.equal(S.gameState.lifetimeMined, 150);
        assert.equal(S.gameState.tierEarned[0], 150);
        assert.equal(S.gameState.levels.pickaxe, 3);
        assert.equal(S.gameState.levels.dynamite, 2);
        assert.equal(S.gameState.levels.miner, 1);
        // CHARACTERIZATION: current behavior — levels.sledge из v1-сейва молча теряется
        assert.equal(S.gameState.levels.sledge, 0);
        assert.equal(S.gameState.version, 5);
        assert.equal(S.gameState.tutorialDone, true);
    });
    it('v2 (5 тиров): тир и добыча переводятся по ключам руд', () => {
        S.applySave({
            version: 2,
            tier: 4,
            ore: 1000,
            stars: 3,
            clicks: 44,
            lifetimeMined: 999,
            tierEarned: [10, 20, 30, 40, 50],
            levels: { pickaxe: 4, miner: 3 }
        });
        assert.equal(S.gameState.tier, 11); // legacy diamond -> индекс 11
        assert.equal(S.gameState.ore, 1000);
        assert.equal(S.gameState.stars, 3);
        assert.deepEqual(S.gameState.tierEarned, [10, 0, 20, 0, 30, 0, 40, 0, 0, 0, 0, 50]);
        assert.equal(S.gameState.levels.pickaxe, 4);
        assert.equal(S.gameState.levels.miner, 3);
        assert.equal(S.gameState.tutorialDone, true); // сейвы без флага: обучение пропущено
    });
    it('v3 -> v5: якорь добавляется дефолтом 0 (фиксируется лениво)', () => {
        S.applySave({
            version: 3,
            ore: 500,
            tier: 2,
            stars: 1,
            clicks: 10,
            lifetimeMined: 700,
            tierEarned: [700],
            levels: { pickaxe: 2 }
        });
        assert.equal(S.gameState.version, 5);
        assert.equal(S.gameState.tierAnchorRate, 0);
        assert.equal(S.gameState.tier, 2);
        assert.equal(S.gameState.levels.pickaxe, 2);
    });
    it('v4 -> v5: то же без изменений полей', () => {
        S.applySave({
            version: 4,
            ore: 500,
            tier: 2,
            stars: 1,
            clicks: 10,
            lifetimeMined: 700,
            tierEarned: [700],
            levels: { pickaxe: 2 }
        });
        assert.equal(S.gameState.version, 5);
        assert.equal(S.gameState.ore, 500);
    });
    it('неизвестная версия и мусор: состояние не трогается', () => {
        S.applySave({ version: 99, ore: 777 });
        assert.equal(S.gameState.ore, 0);
        S.applySave(null);
        S.applySave('str');
        S.applySave(42);
        assert.equal(S.gameState.ore, 0);
        assert.equal(S.gameState.version, 5);
    });
    it('битые числа клампятся: Infinity/NaN/отрицательные -> 0/капы', () => {
        S.applySave({
            version: 5,
            ore: 1e999,
            tier: 99,
            stars: -5,
            clicks: -3,
            lifetimeMined: -1,
            tierEarned: [-2, 'x'],
            tierAnchorRate: -9
        });
        assert.equal(S.gameState.ore, 0);
        assert.equal(S.gameState.tier, 11);
        assert.equal(S.gameState.stars, 0);
        assert.equal(S.gameState.clicks, 0);
        assert.equal(S.gameState.lifetimeMined, 0);
        assert.deepEqual(
            S.gameState.tierEarned,
            S.TIERS.map(() => 0)
        );
        assert.equal(S.gameState.tierAnchorRate, 0);
        assert.equal(S.gameState.tutorialDone, true); // флага нет = старый игрок
    });
    it('истёкшие бафы: until сбрасывается в 0 (не resurrect); dailyBuffMult остаётся', () => {
        S.applySave({
            version: 5,
            ore: 100,
            dailyBuffUntil: Date.now() - 1000,
            dailyBuffMult: 2,
            dailyCritUntil: Date.now() - 1000,
            dailyVeinUntil: Date.now() - 1000,
            miningBuffUntil: Date.now() - 1000,
            miningBuffMult: 3,
            bossBuffUntil: Date.now() - 1000,
            bossBuffMult: 3,
            itemVeinUntil: Date.now() - 1000,
            rigBuffUntil: Date.now() - 1000,
            rigBuffMult: 3,
            oilBuffUntil: Date.now() - 1000,
            oilBuffAdd: 0.25
        });
        assert.equal(S.gameState.dailyBuffUntil, 0);
        // CHARACTERIZATION: current behavior, may be a bug — dailyBuffMult не
        // обнуляется вместе с истёкшим dailyBuffUntil (в отличие от предметных
        // бафов). Инертен: getDailyMult проверяет until, но в сейве значение живёт.
        assert.equal(S.gameState.dailyBuffMult, 2);
        assert.equal(S.gameState.miningBuffUntil, 0);
        assert.equal(S.gameState.miningBuffMult, 1); // предметные сбрасываются
        assert.equal(S.gameState.bossBuffMult, 1);
        assert.equal(S.gameState.rigBuffMult, 1);
        assert.equal(S.gameState.oilBuffAdd, 0);
        assert.equal(S.gameState.itemVeinUntil, 0);
        assert.equal(S.gameState.dailyCritUntil, 0);
        assert.equal(S.gameState.dailyVeinUntil, 0);
    });
    it('живые бафы загружаются как есть', () => {
        const now = Date.now();
        S.applySave({
            version: 5,
            miningBuffUntil: now + 60000,
            miningBuffMult: 3,
            oilBuffUntil: now + 60000,
            oilBuffAdd: 0.25
        });
        assert.equal(S.gameState.miningBuffMult, 3);
        assert.equal(S.getItemBuffMult(), 3);
        assert.equal(S.getOilBuffAdd(), 0.25);
    });
    it('bossFight в сейве: валидный переживает, playerHp клампится к живучести', () => {
        S.applySave({
            version: 5,
            ore: 100,
            tier: 1,
            levels: { helmet: 2 },
            bossFight: { bossId: 'boss_copper', hp: 74000, playerHp: 999999, elapsedMs: 5000 }
        });
        assert.deepEqual(S.gameState.bossFight, { bossId: 'boss_copper', hp: 74000, playerHp: 21000, elapsedMs: 5000 });
    });
    it('bossFight: чужой босс / hp=0 / hp>max — бой молча сбрасывается', () => {
        S.applySave({ version: 5, bossFight: { bossId: 'boss_unknown', hp: 74000, playerHp: 100, elapsedMs: 5000 } });
        assert.equal(S.gameState.bossFight, null);
        S.applySave({ version: 5, bossFight: { bossId: 'boss_copper', hp: 0, playerHp: 100, elapsedMs: 5000 } });
        assert.equal(S.gameState.bossFight, null);
        S.applySave({ version: 5, bossFight: { bossId: 'boss_copper', hp: 1e9, playerHp: 100, elapsedMs: 5000 } });
        assert.equal(S.gameState.bossFight, null);
    });
    it('мета-прогресс фильтруется: ключи только из каталогов, целые >= 0', () => {
        S.applySave({
            version: 5,
            ore: 100,
            components: { scrap: 5.7, crystal: -3, unknown: 4, core: '2' },
            items: { item_bomb: 2.9, item_coffee: -1, unknown_item: 5 },
            artifacts: ['art_miner_totem', 'art_miner_totem', 'art_unknown', 'art_glove'],
            bossesDefeated: { boss_copper: true, boss_xxx: true },
            bestBossTimes: { boss_copper: 55.9, boss_xxx: 10, boss_silver: 0, boss_amethyst: -4, boss_ruby: 360000 },
            crafting: { recipeId: 'r_hardpick', endsAt: Date.now() + 60000 },
            levels: { pickaxe: 99999, miner: -4, sledge: 3.7, unknown: 5 }
        });
        assert.deepEqual(S.gameState.components, { scrap: 5, crystal: 0, core: 2, relic: 0, essence: 0 });
        assert.deepEqual(S.gameState.items, {
            item_bomb: 2,
            item_belt: 0,
            item_coffee: 0,
            item_ration: 0,
            item_stim: 0,
            item_rig: 0,
            item_oil: 0
        });
        assert.deepEqual(S.gameState.artifacts, ['art_miner_totem', 'art_glove']); // дубликаты/чужие отфильтрованы
        assert.deepEqual(S.gameState.bossesDefeated, { boss_copper: true });
        assert.deepEqual(S.gameState.bestBossTimes, { boss_copper: 55 });
        assert.equal(S.gameState.crafting.recipeId, 'r_hardpick');
        assert.equal(S.gameState.crafting.endsAt > Date.now(), true);
        // CHARACTERIZATION: current behavior, may be a bug — дробный уровень sledge
        // 3.7 из сейва проходит как есть (Math.min(3.7, 10)); getUpgradeCost посчитает
        // цену по дробной степени роста.
        assert.equal(S.gameState.levels.sledge, 3.7);
        assert.equal(S.gameState.levels.pickaxe, 30); // кламп до капа
        assert.equal(S.gameState.levels.miner, 0);
        assert.equal(S.gameState.levels.unknown, undefined);
    });
    it('настройки сейва: 0 сохраняется, дробные клампятся, тумблеры уважаются', () => {
        S.applySave({
            version: 5,
            ore: 100,
            tutorialDone: false,
            soundOn: false,
            musicOn: false,
            musicVolume: 0,
            dailyStreak: 4.9,
            lastDailyDay: 123.7
        });
        assert.equal(S.gameState.tutorialDone, false);
        assert.equal(S.gameState.soundOn, false);
        assert.equal(S.gameState.musicOn, false);
        assert.equal(S.gameState.musicVolume, 0);
        assert.equal(S.gameState.dailyStreak, 4);
        assert.equal(S.gameState.lastDailyDay, 123);
    });
    it('loadGame: roundtrip через стаб; мусор в сейве — тихий старт с нуля', async () => {
        S.gameState.ore = 4242;
        S.gameState.levels.miner = 3;
        S.saveGame();
        const raw = localStorage.getItem(S.SAVE_KEY);
        S.resetGame();
        localStorage.setItem(S.SAVE_KEY, raw);
        await S.loadGame();
        assert.equal(S.gameState.ore, 4242);
        assert.equal(S.gameState.levels.miner, 3);
        localStorage.setItem(S.SAVE_KEY, 'not json');
        await S.loadGame();
        // CHARACTERIZATION: current behavior, may be a bug — битый JSON отдаёт
        // getData()==null и loadGame молча ОСТАВЛЯЕТ ТЕКУЩЕЕ состояние (не сброс
        // в ноль и не console.warn; warn срабатывает только когда applySave бросил).
        assert.equal(S.gameState.ore, 4242);
        assert.equal(S.gameState.levels.miner, 3);
    });
});

describe('resetGame: прогресс сбрасывается, настройки игрока сохраняются', () => {
    it('soundOn/musicVolume переживают сброс, руда — нет', () => {
        S.gameState.soundOn = false;
        S.gameState.musicVolume = 0.25;
        S.gameState.ore = 100;
        S.resetGame();
        assert.equal(S.gameState.soundOn, false);
        assert.equal(S.gameState.musicVolume, 0.25);
        assert.equal(S.gameState.ore, 0);
    });
});

describe('офлайн-доход', () => {
    beforeEach(() => {
        S.resetGame();
    });
    it('ставка = 0.2 + 0.08/фонарь + артефакты; кап по складу', () => {
        assert.equal(S.getOfflineRate(), 0.2);
        assert.equal(S.getOfflineCapSeconds(), 14400); // 4ч
        S.gameState.levels.lantern = 3;
        S.gameState.levels.warehouse = 2;
        assert.equal(S.getOfflineRate(), 0.44);
        assert.equal(S.getOfflineCapSeconds(), 43200); // 12ч
        S.gameState.levels.warehouse = 9;
        assert.equal(S.getOfflineCapSeconds(), 86400); // кламп к последнему элементу (24ч)
    });
    it('computeOfflineReward: гейты < 300с и gps<=0; capped counted', () => {
        S.gameState.levels.miner = 1; // gps 1
        const NOW = 1700000000000;
        assert.equal(S.computeOfflineReward(NOW - 299000, NOW), null);
        assert.deepEqual(S.computeOfflineReward(NOW - 300000, NOW), { seconds: 300, counted: 300, reward: 60 });
        assert.deepEqual(S.computeOfflineReward(NOW - 7200000, NOW), { seconds: 7200, counted: 7200, reward: 1440 });
        // 100ч отсутствия: counted клампится к 4ч капу
        assert.deepEqual(S.computeOfflineReward(NOW - 360000000, NOW), {
            seconds: 360000,
            counted: 14400,
            reward: 2880
        });
        S.gameState.levels.miner = 0;
        assert.equal(S.computeOfflineReward(NOW - 7200000, NOW), null); // нет пассива
    });
});

describe('время выхода: saveLastExit / readLastExit (цепочка фолбэков)', () => {
    it('запись идёт и в localStorage, и в mockStats стаба', async () => {
        assert.equal(await S.readLastExit(), null);
        S.saveLastExit(1234567890);
        assert.equal(localStorage.getItem(S.LAST_EXIT_KEY), '1234567890');
        assert.equal(localStorage.getItem('mockStats'), '{"lastExit":1234567890}');
        assert.equal(await S.readLastExit(), 1234567890);
    });
    it('getStats без данных -> localStorage -> legacy -> null; мусор пропускается', async () => {
        S.saveLastExit(1234567890);
        localStorage.removeItem('mockStats');
        assert.equal(await S.readLastExit(), 1234567890); // из localStorage
        localStorage.removeItem(S.LAST_EXIT_KEY);
        localStorage.setItem(S.LEGACY_LAST_EXIT_KEY, '555555');
        assert.equal(await S.readLastExit(), 555555);
        localStorage.removeItem(S.LEGACY_LAST_EXIT_KEY);
        localStorage.setItem(S.LAST_EXIT_KEY, 'garbage');
        assert.equal(await S.readLastExit(), null); // мусор не превращается в награду
    });
});

describe('src/sdk-stub.js: слоты сейва и статистики', () => {
    it('setData/getData: JSON-строка хранится под ore-rush-save как есть', () => {
        SDK.YandexSDKStub.player.setData('{"a":1}');
        assert.equal(localStorage.getItem(SDK.SAVE_STORAGE_KEY), '{"a":1}');
        assert.deepEqual(SDK.YandexSDKStub.player.getData(), { a: 1 });
    });
    it('legacy-ключ читается как фолбэк и зеркалится, старый остаётся', () => {
        localStorage.removeItem(SDK.SAVE_STORAGE_KEY);
        localStorage.setItem(SDK.LEGACY_SAVE_KEY, '{"legacy":true}');
        assert.deepEqual(SDK.YandexSDKStub.player.getData(), { legacy: true });
        assert.equal(localStorage.getItem(SDK.SAVE_STORAGE_KEY), '{"legacy":true}');
        assert.equal(localStorage.getItem(SDK.LEGACY_SAVE_KEY), '{"legacy":true}');
    });
    it('getData без сейва -> null; битый JSON -> null', () => {
        localStorage.clear();
        assert.equal(SDK.YandexSDKStub.player.getData(), null);
        localStorage.setItem(SDK.SAVE_STORAGE_KEY, 'nope{');
        assert.equal(SDK.YandexSDKStub.player.getData(), null);
    });
    it('setStats/getStats: словарь метаданных и фильтрация ключей', async () => {
        await SDK.YandexSDKStub.player.setStats({ a: 1, b: 2 });
        assert.deepEqual(await SDK.YandexSDKStub.player.getStats(), { a: 1, b: 2 });
        assert.deepEqual(await SDK.YandexSDKStub.player.getStats(['b']), { b: 2 });
        assert.deepEqual(await SDK.YandexSDKStub.player.getStats(['c']), { c: undefined }); // отсутствующий ключ -> undefined
        assert.equal(await SDK.YandexSDKStub.player.setStats({}), true);
        SDK.YandexSDKStub.player.gameplayStart(); // GameplayAPI стаб: no-op
        SDK.YandexSDKStub.player.gameplayStop();
    });
});
