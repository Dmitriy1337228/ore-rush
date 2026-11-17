// CHARACTERIZATION-ТЕСТЫ: src/state.js — каталоги, константы, форматирование,
// экономика, мультипокупка, видимость, тики спуска.
//
// Правила: источник истины — ТЕКУЩЕЕ поведение продового кода. Значения сняты
// tools/capture_goldens.mjs на коммите с набором characterization-тестов.
// Помечено `// CHARACTERIZATION: current behavior, may be a bug` там, где
// поведение выглядит багом/квирком — фиксируем КАК ЕСТЬ, ничего не чиним.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importState } from './helpers/globals.mjs';

const S = await importState();
const GOLDEN = JSON.parse(
    fs.readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), 'golden/state_catalog.json'), 'utf8')
);

beforeEach(() => {
    S.resetGame();
});

describe('каталоги state.js (golden-снапшот)', () => {
    it('TIERS: 12 тиров, поля и порядок', () => {
        assert.equal(S.TIERS.length, 12);
        assert.deepEqual(S.TIERS, GOLDEN.tiers);
    });
    it('UPGRADES: 27 улучшений, цены/росты/гейты', () => {
        assert.equal(S.UPGRADES.length, 27);
        assert.deepEqual(S.UPGRADES, GOLDEN.upgrades);
    });
    it('ARTIFACTS: 9 артефактов', () => {
        assert.equal(S.ARTIFACTS.length, 9);
        assert.deepEqual(S.ARTIFACTS, GOLDEN.artifacts);
    });
    it('ITEMS: 7 предметов', () => {
        assert.equal(S.ITEMS.length, 7);
        assert.deepEqual(S.ITEMS, GOLDEN.items);
    });
    it('CRAFT_RECIPES: 10 рецептов', () => {
        assert.equal(S.CRAFT_RECIPES.length, 10);
        assert.deepEqual(S.CRAFT_RECIPES, GOLDEN.craftRecipes);
    });
    it('DAILY_REWARDS: 7-дневный цикл', () => {
        assert.equal(S.DAILY_REWARDS.length, 7);
        assert.deepEqual(S.DAILY_REWARDS, GOLDEN.dailyRewards);
    });
    it('BOSSES: 6 боссов', () => {
        assert.equal(S.BOSSES.length, 6);
        assert.deepEqual(S.BOSSES, GOLDEN.bosses);
    });
    it('COMPONENTS: 5 компонентов', () => {
        assert.deepEqual(S.COMPONENTS, GOLDEN.components);
    });
    it('MUTATIONS: 4 мутации', () => {
        assert.deepEqual(S.MUTATIONS, GOLDEN.mutations);
    });
    it('константы экономики/боссов/дейли', () => {
        assert.deepEqual(S.SAVE_VERSION, GOLDEN.constants.SAVE_VERSION);
        for (const [k, v] of Object.entries(GOLDEN.constants)) {
            assert.deepEqual(S[k], v, `константа ${k}`);
        }
    });
    it('createInitialState: полный набор дефолтов', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(S.createInitialState())), GOLDEN.initialState);
    });
    it('DIAMOND_INDEX вычисляется из ключа diamond (11)', () => {
        assert.equal(S.DIAMOND_INDEX, 11);
    });
});

describe('fmt / fmtDuration (golden)', () => {
    it('fmt: порог 10000, суффиксы, экспонента, infinity, отрицательные, NaN', () => {
        assert.equal(S.fmt(0), '0');
        // CHARACTERIZATION: current behavior, may be a bug — 0.5 -> '0' (floor), а -0.5 -> '-0'
        assert.equal(S.fmt(0.5), '0');
        assert.equal(S.fmt(-0.5), '-0');
        assert.equal(S.fmt(9999), '9999');
        assert.equal(S.fmt(10000), '10K');
        assert.equal(S.fmt(1500), '1500');
        assert.equal(S.fmt(123456), '123K');
        assert.equal(S.fmt(1e6), '1M');
        assert.equal(S.fmt(1.234e9), '1.2B');
        assert.equal(S.fmt(1.5e12), '1.5T');
        assert.equal(S.fmt(1e15), '1Qa');
        assert.equal(S.fmt(1e16), '10Qa');
        assert.equal(S.fmt(1e17), '100Qa');
        assert.equal(S.fmt(1e18), '1Qi');
        assert.equal(S.fmt(123456789), '123M');
        assert.equal(S.fmt(1e45), '1.0e45');
        assert.equal(S.fmt(Infinity), '∞');
        // CHARACTERIZATION: current behavior, may be a bug — NaN рендерится как '∞'
        assert.equal(S.fmt(NaN), '∞');
        assert.equal(S.fmt(-5), '-5');
    });
    it('fmtDuration: ч/мин, нулевые и отрицательные', () => {
        assert.equal(S.fmtDuration(0), '0 мин');
        assert.equal(S.fmtDuration(59), '0 мин');
        assert.equal(S.fmtDuration(60), '1 мин');
        assert.equal(S.fmtDuration(3661), '1 ч 1 мин');
        assert.equal(S.fmtDuration(3600), '1 ч');
        assert.equal(S.fmtDuration(7200), '2 ч');
        assert.equal(S.fmtDuration(3660), '1 ч 1 мин');
        assert.equal(S.fmtDuration(90000), '25 ч');
        // CHARACTERIZATION: current behavior, may be a bug — отрицательное время -> '-1 мин'
        assert.equal(S.fmtDuration(-10), '-1 мин');
    });
});

describe('цены улучшений и множители тиров', () => {
    it('getUpgradeCost: базовая формула ceil(base*growth^lvl*tierMult)', () => {
        assert.equal(S.getUpgradeCost('pickaxe'), 15);
        assert.equal(S.getUpgradeCost('miner'), 60);
        S.gameState.levels.miner = 5;
        assert.equal(S.getUpgradeCost('miner'), 1920); // ceil(60 * 2^5)
    });
    it('TIER_COST_MULT / TIER_INCOME_MULT: x3 за тир', () => {
        assert.equal(S.TIER_COST_MULT(0), 1);
        assert.equal(S.TIER_COST_MULT(2), 9);
        assert.equal(S.TIER_INCOME_MULT(5), 243);
    });
    it('цены на тире 2 с уровнями (x9 к стоимости и к доходу)', () => {
        S.gameState.tier = 2;
        S.gameState.levels.pickaxe = 3;
        S.gameState.levels.miner = 2;
        assert.equal(S.getUpgradeCost('pickaxe'), 1080); // ceil(15*8)*9
        assert.equal(S.getUpgradeCost('miner'), 2160); // ceil(60*4)*9
        assert.equal(S.getClickDamage(), 36); // (1+3)*9
        assert.equal(S.getOrePerSecond(), 18); // 2*9
        assert.equal(S.getExpectedClickGain(), 43.199999999999996); // 36*1.2
        // якорь лениво фиксируется от текущей ставки: gps 18 + 3 клика * 43.2
        assert.equal(S.getNextUnlockPrice(), 231209);
        assert.equal(S.gameState.tierAnchorRate, 147.6);
    });
    it('unlockSecondsFor: 180 * 2.95^tier (golden)', () => {
        const want = GOLDEN.constants && {
            0: 180,
            1: 531,
            2: 1566.45,
            3: 4621.027500000001,
            4: 13632.031125000003,
            5: 40214.491818750015,
            6: 118632.75086531254,
            7: 349966.61505267204,
            8: 1032401.5144053826,
            9: 3045584.4674958787,
            10: 8984474.179112842,
            11: 26504198.828382887
        };
        for (let t = 0; t <= 11; t++) {
            assert.equal(S.unlockSecondsFor(t), want[t]);
        }
    });
    it('свежее состояние: доходы и цены', () => {
        assert.equal(S.getClickDamage(), 1);
        assert.equal(S.getOrePerSecond(), 0);
        assert.equal(S.getAutoClicksPerSecond(), 0);
        assert.equal(S.getExpectedClickGain(), 1.2); // 1 * critF(1.2)
        assert.equal(S.getEarningRate(), 3.5999999999999996); // gps 0 + 3 клика * 1.2
        assert.equal(S.getCritChance(), 0.05);
        assert.equal(S.getLuckyChance(), 0);
        assert.equal(S.getPrestigeMult(), 1);
        assert.equal(S.getNextUnlockPrice(), 2500); // пол UNLOCK_FLOOR
        assert.equal(S.getUnlockEtaSeconds(), 694.4444444444445);
        assert.equal(S.getSynergyGain(), 0);
    });
    it('цена спуска = ceil(N(tier) x якорь), пол UNLOCK_FLOOR; последний тир -> null', () => {
        S.gameState.tierAnchorRate = 100;
        assert.equal(S.getNextUnlockPrice(), 18000); // ceil(180*100)
        S.gameState.tier = 2;
        assert.equal(S.getNextUnlockPrice(), 156645); // ceil(1566.45*100)
        S.gameState.tier = 11;
        assert.equal(S.getNextUnlockPrice(), null);
        assert.equal(S.computeNextUnlockPrice(11), null);
        // пол: на тире 0 с якорем 0.01 цена держит 2500, а не ceil(180*0.01)=2
        S.gameState.tier = 0;
        S.gameState.tierAnchorRate = 0.01;
        assert.equal(S.getNextUnlockPrice(), 2500);
    });
});

describe('мультипокупка (строгие пакеты x1/x10/x100/max)', () => {
    it('getBulkCost: полный пакет и ужимание лимитом maxLevel', () => {
        assert.deepEqual(S.getBulkCost('pickaxe', 10), { n: 10, total: 15345 });
        // drill: maxLevel null, но wants=5 -> n=5; суммы ceil(600*1.6^i) с ростом 1.6
        assert.deepEqual(S.getBulkCost('drill', 5), { n: 5, total: 9488 });
    });
    it('строгий пакет: меньше запрошенного — отказ, баланс не тронут', () => {
        S.gameState.ore = 10000;
        assert.deepEqual(S.getAffordableBulk('pickaxe', 10), { n: 9, total: 7665 });
        assert.equal(S.buyBulk('pickaxe', 10), false);
        assert.equal(S.gameState.levels.pickaxe, 0);
        assert.equal(S.gameState.ore, 10000);
    });
    it('max: покупает максимум, на который хватает руды', () => {
        S.gameState.ore = 10000;
        assert.equal(S.buyBulk('pickaxe', 'max'), true);
        assert.equal(S.gameState.levels.pickaxe, 9);
        assert.equal(S.gameState.ore, 2335);
        // повторный строгий запрос 3: следующие уровни дороги -> отказ
        S.gameState.ore += 2335;
        assert.equal(S.buyBulk('pickaxe', 3), false);
        assert.equal(S.gameState.levels.pickaxe, 9);
    });
    it('достаточно руды: строгий пакет покупает ровно want', () => {
        S.gameState.ore = 1e9;
        assert.equal(S.buyBulk('pickaxe', 10), true);
        assert.equal(S.gameState.levels.pickaxe, 10);
        assert.equal(S.gameState.ore, 999984655);
    });
    it('maxed/недоступное улучшение не покупается', () => {
        S.gameState.ore = 1e9;
        S.gameState.levels.pickaxe = 30;
        assert.equal(S.buyBulk('pickaxe', 1), false);
        S.resetGame();
        assert.equal(S.buyBulk('plasma', 1), false); // tier 6, требует hydraulic 5
    });
});

describe('видимость/доступность улучшений', () => {
    it('свежий старт: список вкладок (анонсы первых недоступных в цепочках)', () => {
        assert.deepEqual(
            S.getVisibleUpgrades('equipment').map((u) => u.id),
            ['pickaxe', 'sledge', 'hydraulic', 'miner', 'robotarm', 'drill', 'tech', 'aicore', 'helmet']
        );
        assert.deepEqual(
            S.getVisibleUpgrades('enhance').map((u) => u.id),
            ['dynamite', 'lucky', 'resonance', 'focuslens', 'magnet', 'lantern', 'warehouse']
        );
        // hydraulic — «первое недоступное» цепочки кирки (кирка/кувалда доступны)
        assert.equal(S.isUpgradeVisible('hydraulic'), true);
        assert.equal(S.isUpgradeVisible('plasma'), false);
        // drill — первое недоступное цепочки шахтёра (гейт tier 1 + requires miner 5)
        assert.equal(S.isUpgradeVisible('drill'), true);
        assert.equal(S.isUpgradeVisible('excavator'), false);
        assert.equal(S.isUpgradeAvailable('sledge'), true);
        assert.equal(S.isUpgradeAvailable('drill'), false);
        assert.equal(S.canBuy('sledge'), false); // нет руды
    });
    it('глубокий тир 6: тот же видимый список (машины гейтятся цепочками)', () => {
        S.gameState.tier = 6;
        assert.deepEqual(
            S.getVisibleUpgrades('equipment').map((u) => u.id),
            ['pickaxe', 'sledge', 'hydraulic', 'miner', 'robotarm', 'drill', 'tech', 'aicore', 'helmet']
        );
    });
    it('кап maxLevel: isMaxed', () => {
        S.gameState.levels.pickaxe = 30;
        assert.equal(S.isMaxed('pickaxe'), true);
        S.resetGame();
        assert.equal(S.isMaxed('miner'), false); // maxLevel null
    });
});

describe('покупка и спуск: unlockTier / forceNextTier', () => {
    it('свежий старт: спуск недоступен (пол 2500 > 0)', () => {
        assert.equal(S.canUnlockTier(), false);
        assert.equal(S.unlockTier(), false);
    });
    it('спуск списывает цену и поднимает тир, якорь сбрасывается', () => {
        S.gameState.ore = 3000;
        assert.equal(S.canUnlockTier(), true);
        assert.equal(S.unlockTier(), true);
        assert.equal(S.gameState.tier, 1);
        assert.equal(S.gameState.ore, 500); // 3000 - 2500
        assert.equal(S.gameState.tierAnchorRate, 0);
    });
    it('forceNextTier: бесплатно, обнуляет руду; на последнем тире — отказ', () => {
        assert.equal(S.forceNextTier(), true);
        assert.equal(S.gameState.tier, 1);
        assert.equal(S.gameState.ore, 0);
        S.gameState.tier = 11;
        assert.equal(S.forceNextTier(), false);
        assert.equal(S.gameState.tier, 11);
    });
});

describe('upgradeIncomeDelta / pickFreeUpgrade', () => {
    it('дельты дохода (golden, fresh state)', () => {
        const want = {
            pickaxe: 3.5999999999999996,
            sledge: 1.7999999999999998,
            miner: 1,
            drill: 10,
            tech: 0,
            dynamite: 0.36,
            lucky: 0.648,
            resonance: 0,
            lantern: 0,
            warehouse: 0
        };
        for (const [id, v] of Object.entries(want)) {
            assert.equal(S.upgradeIncomeDelta(id), v, id);
        }

        // CHARACTERIZATION: current behavior, may be a bug — дельта pickaxe не зависит
        // от текущего уровня кирки (clickChain не включает base 1+lvl)
        S.gameState.levels.pickaxe = 10;
        assert.equal(S.upgradeIncomeDelta('pickaxe'), 3.5999999999999996);
    });
    it('pickFreeUpgrade: на свежем старте выбирает кирку и без руды тоже (ROI)', () => {
        assert.equal(S.pickFreeUpgrade().id, 'pickaxe');
        S.gameState.ore = 0;
        assert.equal(S.pickFreeUpgrade().id, 'pickaxe');
    });
});
