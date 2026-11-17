// Тексты окна настроек (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, шаг 2.2): единственный источник
// для DOM и Phaser-пути; проверяем формулировки, склонения и «взведённые» подписи.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    musicLabel,
    prestigeArmed,
    prestigeIdle,
    prestigeInfo,
    resetArmed,
    resetIdle,
    settingsStats,
    soundLabel,
    volumeText
} from '../../src/state/settingsMessages.js';

describe('settingsMessages: статы', () => {
    it('пять строк с уровнем, звёздами, кликами, добычей и фоновой', () => {
        const rows = settingsStats({
            tierIndex: 1,
            tierName: 'Медь',
            stars: 12,
            mult: '2.2',
            clicks: 120,
            lifetime: 5e5,
            ratePct: 28,
            capHours: 4
        });
        assert.equal(rows.length, 5);
        assert.equal(rows[0], 'Уровень шахты: 2 (Медь)');
        assert.equal(rows[1], 'Звёзды: 12 — множитель x2.2');
        assert.equal(rows[2], 'Кликов: 120');
        assert.equal(rows[3], 'Всего добыто: 500K');
        assert.equal(rows[4], 'Фоновая добыча: 28% / 4 ч');
    });
});

describe('settingsMessages: подписи', () => {
    it('тумблеры и процент громкости', () => {
        assert.equal(soundLabel(true), 'Звук: вкл');
        assert.equal(soundLabel(false), 'Звук: выкл');
        assert.equal(musicLabel(true), 'Музыка: вкл');
        assert.equal(volumeText(0), '0%');
        assert.equal(volumeText(0.5), '50%');
        assert.equal(volumeText(1), '100%');
    });

    it('кнопки в обычном и взведённом состоянии', () => {
        assert.equal(prestigeIdle, 'Сбросить шахту');
        assert.equal(prestigeArmed(12), 'Точно? +12 ★');
        assert.equal(resetIdle, 'Сбросить весь прогресс');
        assert.equal(resetArmed, 'Точно сбросить?');
    });
});

describe('settingsMessages: инфо престижа', () => {
    it('доступен — компактные две строки', () => {
        const rows = prestigeInfo({ can: true, gain: 12, have: 0, need: 100 });
        assert.deepEqual(rows, ['За текущий забег: +12 ★', 'Сброс: руда, шахта и улучшения обнулятся.']);
    });

    it('недоступен — «нужно добыть» и процент', () => {
        const rows = prestigeInfo({ can: false, gain: 0, have: 40, need: 100 });
        assert.equal(rows[0], 'Для rebirth нужно добыть 100 алмазов за забег.');
        assert.equal(rows[1], 'У вас: 40 (40%).');
    });

    it('портрет — короткая формулировка', () => {
        const rows = prestigeInfo({ can: false, gain: 0, have: 0, need: 100, portrait: true });
        assert.equal(rows[0], 'Нужно добыть 100 алмазов за забег.');
    });
});
