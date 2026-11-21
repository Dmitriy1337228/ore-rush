// Тексты списка улучшений (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, 2.1): единственный источник
// для DOM-панели и Phaser-пути; проверяем формулировки и ветви цен.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    bulkLabel,
    bulkPriceText,
    levelText,
    lockRequiresText,
    lockTierText,
    maxPriceText,
    tierLabelText
} from '../../src/state/upgradesMessages.js';

describe('upgradesMessages', () => {
    it('подписи пакета и уровня', () => {
        assert.equal(bulkLabel(1), 'x1');
        assert.equal(bulkLabel(100), 'x100');
        assert.equal(bulkLabel('max'), 'МАКС');
        assert.equal(levelText(7), 'ур. 7');
    });

    it('гейты: глубина нумеруется с единицы, цепочка — по имени', () => {
        assert.equal(lockTierText(2), 'нужно: шахта 3');
        assert.equal(lockRequiresText('Кувалда', 5), 'нужно: Кувалда 5');
    });

    it('ярлык шахты: ландшафт полный, портрет короткий', () => {
        assert.equal(tierLabelText(1, 'Медь', false), 'уровень шахты: 2 — Медь');
        assert.equal(tierLabelText(1, 'Медь', true), 'Шахта 2 · Медь');
    });

    it('цена пакета: полный пакет или ужатый «xN»', () => {
        assert.equal(bulkPriceText({ total: 1500, n: 10, amount: 10 }), '1500');
        assert.equal(bulkPriceText({ total: 1500, n: 4, amount: 10 }), '1500 x4');
        assert.equal(bulkPriceText({ total: 0, n: 0, amount: 10 }), '0');
    });

    it('цена МАКС: одна покупка, несколько, ни одной', () => {
        assert.equal(maxPriceText({ total: 45, n: 1, fallback: 45 }), '45');
        assert.equal(maxPriceText({ total: 900, n: 3, fallback: 45 }), '900 x3');
        assert.equal(maxPriceText({ total: 0, n: 0, fallback: 45 }), '45');
    });
});
