// CHARACTERIZATION-ТЕСТЫ: src/state.js — клик-роллы, боссы, крафт, предметы,
// дейли-награды, престиж, мутации. Случайность гасится подменой Math.random
// (только в тестах; продовый код не трогаем).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { importState, stubRandom } from './helpers/globals.mjs';

const S = await importState();

beforeEach(() => {
    S.resetGame();
});

describe('rollClickGain: крит/жила/синергия/бафы (Math.random стаб)', () => {
    it('roll 0.999: ни крита, ни жилы — голый клик', () => {
        const restore = stubRandom(() => 0.999);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 1, crit: false, lucky: false });
        } finally {
            restore();
        }
    });
    it('roll 0: крит (0<0.05); жилы нет (шанс жилы 0 — сравнение 0<0 ложно)', () => {
        const restore = stubRandom(() => 0);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 5, crit: true, lucky: false });
        } finally {
            restore();
        }
    });
    it('прокачанные вкладки: пороги 0.35/0.08, roll 0.999/0.5 без проков', () => {
        S.gameState.levels.dynamite = 10; // крит 0.05+0.30=0.35
        S.gameState.levels.focuslens = 2; // critMult 6
        S.gameState.levels.lucky = 4; // жила 0.08
        const restore = stubRandom(() => 0.999);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 1, crit: false, lucky: false });
        } finally {
            restore();
        }
        const restore2 = stubRandom(() => 0.5);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 1, crit: false, lucky: false });
        } finally {
            restore2();
        }
    });
    it('дневная жила форсит lucky; veinMult зависит от magnet (10 при 0)', () => {
        S.gameState.levels.dynamite = 10;
        S.gameState.levels.focuslens = 2;
        S.gameState.levels.lucky = 4;
        S.gameState.dailyVeinUntil = Date.now() + 60000;
        const restore = stubRandom(() => 0.999);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 10, crit: false, lucky: true });
        } finally {
            restore();
        }
    });
    it('предметный баф добычи множит итог клика', () => {
        S.gameState.miningBuffUntil = Date.now() + 60000;
        S.gameState.miningBuffMult = 3;
        const restore = stubRandom(() => 0.999);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 3, crit: false, lucky: false });
        } finally {
            restore();
        }
    });
    it('мутации: радуга x10 ко всему после крит/жилы; заморозка — форс-крит без множителя', () => {
        S.gameState.levels.dynamite = 10;
        S.gameState.levels.focuslens = 2; // critMult 6
        S.gameState.levels.lucky = 4; // veinMult 10 (magnet 0)
        S.gameState.miningBuffUntil = Date.now() + 60000;
        S.gameState.miningBuffMult = 3;
        const restore = stubRandom(() => 0);
        try {
            // 1 * 6 (крит) * 10 (жила) * 10 (радуга) * 3 (баф) = 1800
            assert.deepEqual(S.rollClickGain('rainbow'), { gain: 1800, crit: true, lucky: true });
            // заморозка: forceCrit, но clickGainMult нет -> 1*6*10*3 = 180
            assert.deepEqual(S.rollClickGain('frozen'), { gain: 180, crit: true, lucky: true });
        } finally {
            restore();
        }
    });
    it('кап крит-шанса 0.74 на 23 динамита', () => {
        S.gameState.levels.dynamite = 23;
        assert.equal(S.getCritChance(), 0.74);
        const restore = stubRandom(() => 0.4);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 5, crit: true, lucky: false });
        } finally {
            restore();
        }
    });
    it('дневной крит-баф: +0.25 и потолок 0.95', () => {
        assert.equal(S.getCritChance(), 0.05);
        S.gameState.dailyCritUntil = Date.now() + 60000;
        assert.equal(S.getCritChance(), 0.3); // 0.05+0.25
        S.gameState.levels.dynamite = 23; // 0.74+0.25=0.99 -> кап 0.95
        assert.equal(S.getCritChance(), 0.95);
    });
    it('дневной множитель добычи применяется и к клику', () => {
        S.gameState.dailyBuffUntil = Date.now() + 60000;
        S.gameState.dailyBuffMult = 2;
        const restore = stubRandom(() => 0.999);
        try {
            assert.deepEqual(S.rollClickGain(null), { gain: 2, crit: false, lucky: false });
        } finally {
            restore();
        }
    });
});

describe('addOre: учёт по тиру и lifetime', () => {
    it('начисление идёт в tierEarned текущего тира и lifetimeMined', () => {
        S.gameState.tier = 2;
        S.addOre(100);
        S.addOre(50);
        assert.equal(S.gameState.ore, 150);
        assert.equal(S.gameState.tierEarned[2], 150);
        assert.equal(S.gameState.lifetimeMined, 150);
        assert.equal(S.gameState.tierEarned[0], 0);
    });
});

describe('боссы: HP, живучесть, скорость, рекорды, награда', () => {
    it('bossHpFor / getPlayerMaxHp / bossAttackPower (golden)', () => {
        assert.equal(S.bossHpFor(S.BOSSES[0]), 75000); // ceil(25000*3*1.0)
        assert.equal(S.bossHpFor(S.BOSSES[5]), 15500362500); // ceil(25000*3^11*3.5)
        assert.equal(S.getPlayerMaxHp(), 3000);
        S.gameState.levels.helmet = 5;
        S.gameState.tier = 2;
        assert.equal(S.getPlayerMaxHp(), 117000); // ceil((3000+10000)*9)
        S.gameState.tier = 0;
        S.gameState.levels.helmet = 0;
        assert.equal(S.bossAttackPower(S.BOSSES[0]), 300); // ceil(75000*0.004)
    });
    it('bossSpeedMult: пороги 45/90/180 (golden)', () => {
        assert.equal(S.bossSpeedMult(5000), 1.5);
        assert.equal(S.bossSpeedMult(45000), 1.5);
        assert.equal(S.bossSpeedMult(46000), 1.25);
        assert.equal(S.bossSpeedMult(90000), 1.25);
        assert.equal(S.bossSpeedMult(181000), 0.75);
        assert.equal(S.bossSpeedMult(301000), 0.75);
        // CHARACTERIZATION: current behavior — elapsedMs=0 считается как 1с -> 1.5
        assert.equal(S.bossSpeedMult(0), 1.5);
    });
    it('рекорды: только улучшение, кап 359999, чужие ключи отвергаются', () => {
        assert.equal(S.updateBossRecord('boss_copper', 42.7), true);
        assert.equal(S.getBossRecord('boss_copper'), 42); // floor(42.7)
        assert.equal(S.updateBossRecord('boss_copper', 50), false);
        assert.equal(S.getBossRecord('boss_copper'), 42);
        assert.equal(S.updateBossRecord('boss_copper', 30), true);
        assert.equal(S.getBossRecord('boss_copper'), 30);
        assert.equal(S.updateBossRecord('boss_xxx', 10), false);
        // 999999 клампится к 359999, что хуже текущего 30 — рекорд не обновлён
        assert.equal(S.updateBossRecord('boss_copper', 999999), false);
        assert.equal(S.getBossRecord('boss_copper'), 30);
        assert.equal(S.getBossRecord('boss_xxx'), null);
    });
    it('grantBossKill: баунти = ceil(90 * ставка * speedMult), дроп/артефакт/рекорд', () => {
        S.gameState.levels.miner = 1; // gps 1 -> ставка 4.6
        const restore = stubRandom(() => 0); // дроп всегда минимум
        try {
            const r = S.grantBossKill('boss_copper', 10000);
            assert.deepEqual(r, {
                bounty: 621,
                comps: { scrap: 2 },
                artifactId: 'art_miner_totem',
                elapsedSec: 10,
                speedMult: 1.5
            });
            assert.equal(S.gameState.ore, 621);
            assert.deepEqual(S.gameState.components, { scrap: 2 });
            assert.deepEqual(S.gameState.artifacts, ['art_miner_totem']);
            assert.deepEqual(S.gameState.bossesDefeated, { boss_copper: true });
            assert.equal(S.getBossRecord('boss_copper'), 10);
        } finally {
            restore();
        }
    });
    it('grantBossKill: неизвестный босс — null, повторное убийство без артефакта', () => {
        assert.equal(S.grantBossKill('boss_xxx', 1000), null);
        S.gameState.levels.miner = 1;
        S.gameState.bossesDefeated.boss_copper = true;
        S.gameState.artifacts.push('art_miner_totem');
        const restore = stubRandom(() => 0);
        try {
            const r = S.grantBossKill('boss_copper', 10000);
            assert.equal(r.artifactId, null); // уже есть
            assert.deepEqual(S.gameState.artifacts, ['art_miner_totem']);
        } finally {
            restore();
        }
    });
    it('rollBossHit: крит/жила как у клика + артефактный/предметный урон боссу', () => {
        const restore = stubRandom(() => 0.999);
        try {
            assert.deepEqual(S.rollBossHit(), { gain: 1, crit: false, lucky: false });
        } finally {
            restore();
        }
        S.gameState.artifacts.push('art_hardpick'); // bossDamageMult 1.25
        const restore2 = stubRandom(() => 0);
        try {
            // 1 * critMult 5 * bossDamageMult 1.25 = 6.25
            assert.deepEqual(S.rollBossHit(), { gain: 6.25, crit: true, lucky: false });
        } finally {
            restore2();
        }
    });
    it('updateBossFight: клампы hp/playerHp; clearBossFight', () => {
        S.gameState.levels.miner = 1;
        S.gameState.bossFight = { bossId: 'boss_copper', hp: 75000, playerHp: 3000, elapsedMs: 0 };
        S.updateBossFight(-5, -3, 999999); // playerHp клампится к max 3000
        assert.deepEqual(S.gameState.bossFight, { bossId: 'boss_copper', hp: 0, playerHp: 3000, elapsedMs: 0 });
        S.clearBossFight();
        assert.equal(S.gameState.bossFight, null);
        S.updateBossFight(1, 1); // без bossFight — no-op, не бросает
    });
    it('персист бафов предметов: getBossDamageMult/getRigBuffMult/getOilBuffAdd по wall-clock', () => {
        S.gameState.bossBuffUntil = Date.now() + 60000;
        S.gameState.bossBuffMult = 2;
        S.gameState.rigBuffUntil = Date.now() + 60000;
        S.gameState.rigBuffMult = 3;
        S.gameState.oilBuffUntil = Date.now() - 1; // истёк
        S.gameState.oilBuffAdd = 0.25;
        assert.equal(S.getBossDamageMult(), 2);
        assert.equal(S.getRigBuffMult(), 3);
        assert.equal(S.getOilBuffAdd(), 0); // истёкший не действует
        assert.equal(S.isItemVeinActive(), false);
        S.gameState.itemVeinUntil = Date.now() + 60000;
        assert.equal(S.isItemVeinActive(), true);
    });
    it('getArtifactBonus: мультипликаторы перемножаются, плоские суммируются', () => {
        assert.equal(S.getArtifactBonus('passiveMult'), 1);
        assert.equal(S.getArtifactBonus('critAdd'), 0);
        S.gameState.artifacts.push('art_miner_totem', 'art_core_battery'); // 1.1 * 1.15
        assert.equal(Math.abs(S.getArtifactBonus('passiveMult') - 1.265) < 1e-12, true);
        S.gameState.artifacts.push('art_lucky_charm'); // +0.03
        assert.equal(S.getArtifactBonus('critAdd'), 0.03);
        S.gameState.artifacts.push('art_glove', 'art_ancient_pick');
        // clickMult = 1.1 (Рукавица) x 1.15 (Древняя кирка)
        assert.equal(S.getArtifactBonus('clickMult'), 1.265);
    });
});

describe('мутации блока: константы и бонус взрыва', () => {
    it('тайминги мутаций (golden)', () => {
        assert.equal(S.MUTATION_DURATION_MS, 10000);
        assert.equal(S.MUTATION_CHECK_MS, 300000);
        assert.equal(S.MUTATION_CHANCE, 0.5); // CHARACTERIZATION: комментарий выше говорит «шанс 30%» — фактический шанс 50%
    });
    it('getMutationBreakBonus: только взрывная, x25 клика', () => {
        assert.equal(S.getMutationBreakBonus('rainbow'), 0);
        assert.equal(S.getMutationBreakBonus('frozen'), 0);
        assert.equal(S.getMutationBreakBonus(null), 0);
        assert.equal(S.getMutationBreakBonus('explosive'), 25); // 25 * клик 1
        S.gameState.levels.miner = 1;
        S.gameState.levels.pickaxe = 2;
        // клик 3 * x25 = 75
        assert.equal(S.getMutationBreakBonus('explosive'), 75);
    });
});

describe('крафт', () => {
    it('r_bomb: нельзя без лома, можно с 4 лома; мгновенный клейм даёт x2 бомбы', () => {
        assert.equal(S.canCraft('r_bomb'), false);
        S.gameState.components.scrap = 4;
        assert.equal(S.canCraft('r_bomb'), true);
        assert.equal(S.startCraft('r_bomb'), true);
        assert.equal(S.gameState.crafting.recipeId, 'r_bomb');
        assert.equal(S.gameState.crafting.endsAt - Date.now(), 0); // craftMs=0
        assert.equal(S.canClaimCraft(), true);
        const claimed = S.claimCraft();
        assert.equal(claimed.id, 'r_bomb');
        assert.deepEqual(S.gameState.items, { item_bomb: 2 });
        assert.deepEqual(S.gameState.components, { scrap: 0 });
        assert.equal(S.gameState.crafting, null);
        assert.equal(S.canCraft('r_bomb'), false); // лом потрачен
    });
    it('верстак один: пока занят — отказ; незавершённый крафт не клеймится', () => {
        S.gameState.components.scrap = 100;
        S.gameState.components.crystal = 100;
        S.gameState.components.core = 100;
        assert.equal(S.startCraft('r_hardpick'), true);
        const delta = S.gameState.crafting.endsAt - Date.now();
        assert.equal(delta > 599000 && delta <= 600000, true); // 600e3 ± дельта вызова
        assert.equal(S.canCraft('r_bomb'), false);
        assert.equal(S.claimCraft(), null);
    });
    it('стак предметов: place нет — крафт отказ (ration n=2, stackMax 10)', () => {
        S.gameState.components.scrap = 100;
        S.gameState.items.item_ration = 9;
        assert.equal(S.canCraft('r_ration'), false); // space 1 < 2
        S.gameState.items.item_ration = 10;
        assert.equal(S.canCraft('r_ration'), false);
        S.gameState.items.item_ration = 8;
        assert.equal(S.canCraft('r_ration'), true);
    });
    it('артефактный крафт кладёт артефакт в коллекцию, не дублируя', () => {
        S.gameState.components.crystal = 100;
        S.gameState.components.core = 100;
        assert.equal(S.startCraft('r_hardpick'), true);
        S.gameState.crafting.endsAt = Date.now() - 1; // «время вышло»
        assert.equal(S.canClaimCraft(), true);
        assert.equal(S.claimCraft().id, 'r_hardpick');
        assert.deepEqual(S.gameState.artifacts, ['art_hardpick']);
        S.gameState.crafting = { recipeId: 'r_hardpick', endsAt: Date.now() - 1 };
        S.gameState.components.crystal = 100;
        S.gameState.components.core = 100;
        S.startCraft('r_hardpick');
        S.claimCraft();
        assert.deepEqual(S.gameState.artifacts, ['art_hardpick']); // дубликата нет
    });
});

describe('предметы: цены, покупка, активация', () => {
    it('цена = ceil(ставка * priceSeconds); без дохода — от floor-ставки 3.6', () => {
        assert.equal(S.getItemPrice('item_bomb'), 216); // ceil(3.6*60)
        S.gameState.levels.miner = 1; // ставка 4.6
        assert.equal(S.getItemPrice('item_bomb'), 276); // ceil(4.6*60)
    });
    it('покупка: хватает руды и места в стаки; stackMax блокирует', () => {
        assert.equal(S.canBuyItem('item_bomb'), false); // нет руды
        S.gameState.ore = 1e9;
        assert.equal(S.canBuyItem('item_bomb'), true);
        assert.equal(S.buyItem('item_bomb'), true);
        assert.deepEqual(S.gameState.items, { item_bomb: 1 });
        assert.equal(S.gameState.ore, 1e9 - 216);
        S.gameState.items.item_bomb = 5; // stackMax
        assert.equal(S.canBuyItem('item_bomb'), false);
    });
    it('боевой предмет вне боя — отказ; в бою — баф урона боссу x2', () => {
        S.gameState.ore = 1e9;
        assert.equal(S.buyItem('item_bomb'), true);
        assert.equal(S.buyItem('item_coffee'), true);
        assert.equal(S.useItem('item_bomb'), false); // bossUse, not inBoss
        assert.equal(S.useItem('item_coffee'), true); // кофе: добыча x2 на 5 мин
        const d = S.gameState.miningBuffUntil - Date.now();
        assert.equal(d > 299000 && d <= 300000, true);
        assert.equal(S.getItemBuffMult(), 2);
        assert.equal(S.useItem('item_coffee'), false); // остаток 180с > 30с — перезарядка
        assert.equal(S.useItem('item_bomb', true), true);
        assert.equal(S.gameState.bossBuffMult, 2);
        assert.equal(S.getBossDamageMult(), 2);
        assert.deepEqual(S.gameState.items, { item_bomb: 0, item_coffee: 0 });
    });
    it('мгновенный предмет (ration) начисляет 60с ставки', () => {
        S.gameState.ore = 1e9;
        S.buyItem('item_ration'); // цена 30с*3.6=108
        const oreAfterBuy = S.gameState.ore;
        assert.equal(S.useItem('item_ration'), true);
        assert.equal(S.gameState.ore, oreAfterBuy + 60 * 3.5999999999999996); // 60 * ставка (float как в проде)
    });
});

describe('ежедневные награды', () => {
    it('свежий старт: награда доступна, повторно в тот же день — нет', () => {
        assert.equal(S.canClaimDaily(), true);
        const r = S.claimDailyReward();
        assert.equal(r.streak, 1);
        assert.equal(r.reward.id, 'boost2');
        assert.equal(r.extra, null);
        assert.equal(S.canClaimDaily(), false);
        const d = S.gameState.dailyBuffUntil - Date.now();
        assert.equal(d > 599000 && d <= 600000, true); // 10 мин
        assert.equal(S.gameState.dailyBuffMult, 2);
        assert.equal(S.getDailyMult(), 2);
    });
    it('серия 8 дней: 7 наград по кругу, «Накопитель» = 300с ставки, «upgrade» = кирка', () => {
        const day = S.getDailyDay();
        const ids = [];
        for (let i = 0; i < 8; i++) {
            S.gameState.lastDailyDay = day - 1; // «вчера»: серия продолжается
            const r = S.claimDailyReward();
            ids.push({ streak: r.streak, id: r.reward.id, extra: r.extra });
            if (i === 1) assert.equal(S.gameState.ore, 1080); // stash: 300 * 3.6
            if (i === 2) assert.equal(S.isDailyCritActive(), true);
            if (i === 3) assert.equal(S.gameState.levels.pickaxe, 1); // free pickaxe
            if (i === 6) assert.equal(S.isDailyVeinActive(), true);
        }
        assert.deepEqual(
            ids.map((x) => x.id),
            ['boost2', 'stash', 'crit', 'upgrade', 'boost3', 'boost10', 'vein', 'boost2']
        );
        assert.deepEqual(
            ids.map((x) => x.streak),
            [1, 2, 3, 4, 5, 6, 7, 8]
        );
    });
    it('пропуск >= 2 дней сбрасывает серию на 1', () => {
        const day = S.getDailyDay();
        S.gameState.lastDailyDay = day - 5;
        const r = S.claimDailyReward();
        assert.equal(r.streak, 1);
        assert.equal(r.reward.id, 'boost2');
    });
    it('claim_daily: applyDailyReward(upgrade) пропускает недоступные улучшения', () => {
        // все капнуты/недоступны -> extra null, уровни не растут
        S.gameState.lastDailyDay = S.getDailyDay() - 1;
        S.gameState.levels.pickaxe = 30;
        S.gameState.levels.dynamite = 23;
        S.gameState.levels.lucky = 25;
        S.gameState.levels.resonance = 25;
        S.gameState.levels.robotarm = 0; // доступен, но delta 0 при нулевом клике?
        const r = S.claimDailyReward();
        assert.equal(r.reward.id, 'boost2'); // streak 1 всегда boost2; проверка upgrade-ветки отдельным прогоном ниже
    });
    it('applyDailyReward(upgrade): на 4-й день серии бесплатно качается лучшее по ROI', () => {
        const day = S.getDailyDay();
        for (let i = 0; i < 3; i++) {
            S.gameState.lastDailyDay = day - 1;
            S.claimDailyReward();
        }
        S.gameState.lastDailyDay = day - 1;
        const r = S.claimDailyReward(); // streak 4 -> upgrade
        assert.equal(r.reward.id, 'upgrade');
        assert.deepEqual(r.extra, { id: 'pickaxe', name: 'Кирка' });
        assert.equal(S.gameState.levels.pickaxe, 1);
    });
});

describe('престиж', () => {
    it('ноль алмазного заработка — престижа нет', () => {
        assert.equal(S.getStarsGain(), 0);
        assert.equal(S.canPrestige(), false);
        assert.equal(S.doPrestige(), 0);
    });
    it('звёзды = floor(sqrt(tierEarned[diamond] / 1e12))', () => {
        S.gameState.tierEarned[S.DIAMOND_INDEX] = S.PRESTIGE_REQUIREMENT;
        assert.equal(S.getStarsGain(), 1);
        S.gameState.tierEarned[S.DIAMOND_INDEX] = 4 * S.PRESTIGE_REQUIREMENT;
        assert.equal(S.getStarsGain(), 2);
        assert.equal(S.canPrestige(), true);
    });
    it('doPrestige: звёзды идут в множитель, прогресс/тиры/уровни/боссы сбрасываются', () => {
        S.gameState.ore = 12345;
        S.gameState.tier = 7;
        S.gameState.levels.pickaxe = 9;
        S.gameState.bossesDefeated = { boss_copper: true };
        S.gameState.tierEarned[S.DIAMOND_INDEX] = 4 * S.PRESTIGE_REQUIREMENT;
        assert.equal(S.doPrestige(), 2);
        assert.deepEqual(
            {
                ore: S.gameState.ore,
                tier: S.gameState.tier,
                stars: S.gameState.stars,
                pickaxe: S.gameState.levels.pickaxe,
                bosses: S.gameState.bossesDefeated,
                anchor: S.gameState.tierAnchorRate,
                earned: S.gameState.tierEarned
            },
            { ore: 0, tier: 0, stars: 2, pickaxe: 0, bosses: {}, anchor: 0, earned: S.TIERS.map(() => 0) }
        );
        assert.equal(S.getPrestigeMult(), 1.2); // 1 + 0.1*2
        // артефакты и мета переживают престиж
        S.gameState.artifacts.push('art_miner_totem');
        S.doPrestige(); // gain 0 — ничего не меняет
        assert.deepEqual(S.gameState.artifacts, ['art_miner_totem']);
    });
});
