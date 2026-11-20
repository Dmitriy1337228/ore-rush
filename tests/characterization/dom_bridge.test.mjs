// Мост DOM ↔ state (этап 2): снимок и подписи. Только чтение состояния.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../../src/state.js';
import {
    bossRewardSnapshot,
    dailySnapshot,
    offlineSnapshot,
    playerDownSnapshot,
    settingsSnapshot,
    snapshot,
    upgradesSnapshot
} from '../../src/ui/dom/bridge.js';
import { MSG } from '../../src/state/craftMessages.js';

const reset = () => {
    gameState.ore = 5330;
    gameState.components = { scrap: 100, crystal: 100, core: 100, relic: 100, essence: 100 };
    gameState.items = { item_bomb: 0, item_belt: 2 };
    gameState.artifacts = ['art_miner_totem'];
    gameState.crafting = null;
    gameState.bossBuffUntil = 0;
    gameState.miningBuffUntil = 0;
    gameState.itemVeinUntil = 0;
};

describe('dom bridge: snapshot', () => {
    beforeEach(reset);

    it('читает руду, компоненты, предметы и артефакты без мутаций', () => {
        const before = JSON.stringify(gameState);
        const snap = snapshot({ bossActive: false, now: 1_000_000 });

        assert.equal(snap.ore, 5330);
        assert.equal(snap.oreText.length > 0, true);
        assert.equal(snap.components.length, 5);
        assert.equal(snap.components.find((c) => c.id === 'scrap').count, 100);
        assert.equal(snap.items.find((i) => i.id === 'item_bomb').hint, MSG.noItem);
        assert.equal(snap.items.find((i) => i.id === 'item_belt').hint, 'в запасе: 2');
        assert.equal(snap.items.find((i) => i.id === 'item_bomb').blocked, true);
        assert.equal(snap.artifacts.find((a) => a.id === 'art_miner_totem').owned, true);
        assert.equal(snap.artifacts.find((a) => a.id === 'art_hardpick').line, 'Скрафти: рецепт');
        assert.equal(snap.crafting, null);
        assert.equal(JSON.stringify(gameState), before, 'snapshot не должен менять state');
    });

    it('боевой предмет без боя помечен, с боем — только запас', () => {
        gameState.items = { item_bomb: 2 };
        const peace = snapshot({ bossActive: false, now: 1_000_000 });
        const fight = snapshot({ bossActive: true, now: 1_000_000 });
        assert.equal(peace.items.find((i) => i.id === 'item_bomb').blocked, true);
        assert.equal(peace.items.find((i) => i.id === 'item_bomb').hint, `в запасе: 2 · ${MSG.bossOnly}`);
        assert.equal(fight.items.find((i) => i.id === 'item_bomb').blocked, false);
    });

    it('крафт в работе: таймер, кнопка и статус', () => {
        gameState.crafting = { recipeId: 'r_hardpick', endsAt: 1_000_000 + 65_000 };
        const snap = snapshot({ bossActive: false, now: 1_000_000 });
        const recipe = snap.recipes.find((r) => r.id === 'r_hardpick');
        assert.equal(snap.crafting.recipeId, 'r_hardpick');
        assert.equal(snap.crafting.text, '1:05');
        assert.equal(recipe.button, '1:05');
        assert.equal(recipe.mine, true);
        assert.equal(recipe.ready, false);

        gameState.crafting.endsAt = 999_000;
        const ready = snapshot({ bossActive: false, now: 1_000_000 });
        assert.equal(ready.recipes.find((r) => r.id === 'r_hardpick').button, 'Забрать');
        assert.equal(ready.crafting.ready, true);
    });

    it('статус рецепта и нехватка компонентов', () => {
        gameState.components = { scrap: 100, crystal: 0, core: 0, relic: 0, essence: 0 };
        const snap = snapshot({ bossActive: false });
        const hardpick = snap.recipes.find((r) => r.id === 'r_hardpick');
        assert.equal(hardpick.disabled, true);
        assert.deepEqual(
            hardpick.need.map((n) => n.enough),
            [false, false]
        );
    });
});

describe('dom bridge: settingsSnapshot', () => {
    beforeEach(reset);

    it('читает настройки, статы и престиж без мутаций', () => {
        gameState.soundOn = false;
        gameState.musicOn = true;
        gameState.musicVolume = 0.4;
        gameState.stars = 12;
        gameState.clicks = 120;
        const before = JSON.stringify(gameState);
        const snap = settingsSnapshot({ bossActive: false, portrait: false });
        assert.equal(JSON.stringify(gameState), before, 'снимок не мутирует состояние');
        assert.equal(snap.soundOn, false);
        assert.equal(snap.musicOn, true);
        assert.equal(snap.musicVolume, 0.4);
        assert.equal(snap.volumeText, '40%');
        assert.equal(snap.labels.sound, 'Звук: выкл');
        assert.equal(snap.labels.music, 'Музыка: вкл');
        assert.equal(snap.stats.length, 5);
        assert.equal(snap.stats[1].startsWith('Звёзды: 12 '), true);
        assert.equal(snap.prestigeLines.length, 2);
        assert.equal(snap.bossLocked, false);
    });

    it('босс блокирует престиж и сброс (bossLocked)', () => {
        const snap = settingsSnapshot({ bossActive: true });
        assert.equal(snap.bossLocked, true);
    });

    it('портретная формулировка престижа при нехватке алмазов', () => {
        gameState.stars = 0;
        gameState.tierEarned = Array(12).fill(0);
        const snap = settingsSnapshot({ portrait: true });
        assert.equal(snap.canPrestige, false);
        assert.match(snap.prestigeLines[0], /^Нужно добыть /);
        assert.equal(snap.pct, 0);
    });
});

describe('dom bridge: статус-снимки', () => {
    beforeEach(reset);

    it('офлайн: тело из statusMessages и заголовок', () => {
        const before = JSON.stringify(gameState);
        const snap = offlineSnapshot({ seconds: 7200, reward: 1200, counted: 3600 });
        assert.equal(JSON.stringify(gameState), before, 'снимок не мутирует состояние');
        assert.equal(snap.kind, 'offline');
        assert.equal(snap.title, 'С возвращением!');
        assert.equal(snap.okLabel, 'Забрать');
        assert.equal(snap.body.split('\n').length, 5);
        assert.match(snap.body, /^шахтёры добыли 1200 /m);
    });

    it('ежедневная: серия, награда дня и 7 слотов с активным', () => {
        const snap = dailySnapshot({ streak: 3, extra: 250 });
        assert.equal(snap.title, 'Ежедневная награда');
        assert.equal(snap.streakText, 'Серия: 3 дня');
        assert.equal(snap.slots.length, 7);
        assert.equal(snap.slots.filter((s) => s.active).length, 1);
        assert.equal(snap.slots[2].active, true);
        assert.match(snap.desc, /\n\+250 руды$/);
        assert.equal(typeof snap.name, 'string');
        assert.equal(typeof snap.icon, 'string');
    });

    it('награда босса: баунти, скорость, компоненты и артефакт', () => {
        const snap = bossRewardSnapshot({
            bounty: 5000,
            elapsedSec: 32,
            speedMult: 1.5,
            comps: { scrap: 2 },
            artifactId: 'art_miner_totem'
        });
        assert.equal(snap.title, 'Босс повержен!');
        assert.equal(snap.bountyText, 'Баунти: +5000 руды');
        assert.equal(snap.speedText, 'Время: 0:32 · бонус x1.5');
        assert.equal(snap.comps.length, 1);
        assert.equal(snap.comps[0].id, 'scrap');
        assert.equal(snap.comps[0].countText, '×2');
        assert.equal(snap.artifact.name.length > 0, true);
    });

    it('награда босса без компонентов/артефакта и без времени', () => {
        const snap = bossRewardSnapshot({ bounty: 10 });
        assert.deepEqual(snap.comps, []);
        assert.equal(snap.artifact, null);
        assert.equal(snap.speedText, null);
    });

    it('вырубление: тело из statusMessages', () => {
        const snap = playerDownSnapshot({ bossName: 'Голем', dmg: 10, maxPlayer: 100 });
        assert.equal(snap.title, 'Ты вырубился!');
        assert.equal(snap.okLabel, 'В шахту');
        assert.match(snap.body, /^Голем отбросил тебя в шахту\./);
    });
});

describe('dom bridge: upgradesSnapshot', () => {
    beforeEach(reset);

    it('вкладка, пакет и ряды: 20 equipment / 7 enhance по каталогу', () => {
        gameState.tier = 11;
        gameState.levels = { pickaxe: 30, miner: 999, drill: 999, excavator: 999 };
        const before = JSON.stringify(gameState);
        const snap = upgradesSnapshot({ tab: 'equipment', buyAmount: 10 });
        assert.equal(JSON.stringify(gameState), before, 'снимок не мутирует состояние');
        assert.equal(snap.tab, 'equipment');
        assert.equal(snap.rows.length > 0, true);
        assert.equal(
            snap.rows.every((r) => typeof r.id === 'string'),
            true
        );
        assert.equal(snap.bulk.length, 4);
        assert.equal(snap.bulk.find((b) => b.amount === 10).active, true);
        assert.equal(snap.tabs.find((t) => t.id === 'equipment').active, true);
    });

    it('МАКС и строгий пакет показывают числа из state (без локального пересчёта)', () => {
        gameState.tier = 0;
        gameState.ore = 1e6;
        gameState.levels = { pickaxe: 1 };
        const one = upgradesSnapshot({ tab: 'equipment', buyAmount: 1 });
        const pick = one.rows.find((r) => r.id === 'pickaxe');
        assert.equal(pick.level, 1);
        assert.match(pick.priceText, /^\d/);
        const max = upgradesSnapshot({ tab: 'equipment', buyAmount: 'max' });
        assert.match(max.rows.find((r) => r.id === 'pickaxe').priceText, /(\d|K|M)/);
    });
});
