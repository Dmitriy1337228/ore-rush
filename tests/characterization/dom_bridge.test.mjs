// Мост DOM ↔ state (этап 2): снимок и подписи. Только чтение состояния.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameState } from '../../src/state.js';
import { snapshot } from '../../src/dom/bridge.js';
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
        assert.deepEqual(hardpick.need.map((n) => n.enough), [false, false]);
    });
});
