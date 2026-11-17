// Флаг-откат форм (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, D5): query, localStorage, пусто,
// неизвестные имена игнорируются.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { DEFAULT_PHASER_FORMS, isPhaserForm, phaserForms } from '../../src/ui/shared/formsFlag.js';

function withWindow({ search = '', stored = null } = {}) {
    globalThis.window = {
        location: { search },
        localStorage: {
            getItem: (k) => (k === 'phaserForms' ? stored : null)
        }
    };
}

afterEach(() => {
    delete globalThis.window;
});

describe('formsFlag: флаг-откат форм', () => {
    test('без window — только автооткат по умолчанию', () => {
        assert.deepEqual([...phaserForms()], [...DEFAULT_PHASER_FORMS]);
        assert.equal(isPhaserForm('settings'), DEFAULT_PHASER_FORMS.includes('settings'));
    });

    test('пустой query и localStorage — пусто', () => {
        withWindow();
        assert.equal(phaserForms().size, 0);
        assert.equal(isPhaserForm('settings'), false);
        assert.equal(isPhaserForm('status'), false);
    });

    test('query ?phaserForms=settings,status включает обе формы', () => {
        withWindow({ search: '?phaserForms=settings,status' });
        assert.equal(isPhaserForm('settings'), true);
        assert.equal(isPhaserForm('status'), true);
    });

    test('query с неизвестными именами игнорируется', () => {
        withWindow({ search: '?phaserForms=map,settings,foo' });
        assert.deepEqual([...phaserForms()], ['settings']);
        assert.equal(isPhaserForm('status'), false);
    });

    test('localStorage тоже включает откат', () => {
        withWindow({ stored: 'status' });
        assert.equal(isPhaserForm('status'), true);
        assert.equal(isPhaserForm('settings'), false);
    });

    test('query и localStorage объединяются', () => {
        withWindow({ search: '?phaserForms=settings', stored: 'status' });
        assert.equal(isPhaserForm('settings'), true);
        assert.equal(isPhaserForm('status'), true);
    });
});
