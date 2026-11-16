// Тексты мастерской — единый источник (шаг 2.2): таблица вход → строка.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, buyError, activateError, itemStockHint, recipeStatus } from '../../src/state/craftMessages.js';

describe('craftMessages: тексты мастерской', () => {
    it('buyError: полный стак важнее нехватки руды', () => {
        assert.equal(buyError({ stock: 5, stackMax: 5 }), MSG.stackFull);
        assert.equal(buyError({ stock: 6, stackMax: 5 }), MSG.stackFull);
        assert.equal(buyError({ stock: 0, stackMax: 5 }), MSG.noOre);
    });

    it('activateError: нет предмета → только в бою → баф активен', () => {
        assert.equal(activateError({ stock: 0, bossUse: true }), MSG.noItem);
        assert.equal(activateError({ stock: 0, bossUse: false }), MSG.noItem);
        assert.equal(activateError({ stock: 2, bossUse: true }), MSG.bossOnly);
        assert.equal(activateError({ stock: 1, bossUse: false }), MSG.buffActive);
    });

    it('itemStockHint: базовый запас и боевая пометка', () => {
        assert.equal(itemStockHint({ stock: 0, bossUse: false }), MSG.noItem);
        assert.equal(itemStockHint({ stock: 2, bossUse: false }), 'в запасе: 2');
        assert.equal(itemStockHint({ stock: 3, bossUse: true }), `в запасе: 3 · ${MSG.bossOnly}`);
    });

    it('recipeStatus: приоритет и пустой статус', () => {
        assert.equal(recipeStatus({ mine: true, owned: true, busy: true, space: 0, resultN: 1, compsOk: true }), '');
        assert.equal(recipeStatus({ mine: false, owned: true, busy: true, space: 0, resultN: 1, compsOk: true }), MSG.owned);
        assert.equal(recipeStatus({ mine: false, owned: false, busy: true, space: 0, resultN: 1, compsOk: false }), MSG.benchBusy);
        assert.equal(recipeStatus({ mine: false, owned: false, busy: false, space: 0, resultN: 1, compsOk: true }), MSG.stackFull);
        assert.equal(recipeStatus({ mine: false, owned: false, busy: false, space: 0, resultN: 1, compsOk: false }), '');
        assert.equal(recipeStatus({ mine: false, owned: false, busy: false, space: 5, resultN: 1, compsOk: true }), '');
    });
});
