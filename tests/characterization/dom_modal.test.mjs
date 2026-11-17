// Каркас DOM-модалки и слайдера (docs/UI_DOM_PHASE2_PLAN.md, шаг 1.7): структура
// разметки, токены (никаких голых px), крестик только у closable.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { modal } from '../../src/ui/dom/modal.js';
import { rangeInput } from '../../src/ui/dom/components.js';
import { html as dom } from '../../src/ui/dom/html.js';

const markup = (safe) => String(safe);

describe('modal: общий каркас', () => {
    test('settings: скрим, панель, крестик, скролл, data-form-id', () => {
        const html = markup(modal({ kind: 'settings', formId: 'settings', title: 'Настройки', children: 'x' }));
        assert.match(html, /data-dom-modal-kind="settings"/);
        assert.match(html, /data-dom-backdrop/);
        assert.match(html, /data-dom-modal/);
        assert.match(html, /data-dom-scroll/);
        assert.match(html, /data-dom-close/);
        assert.match(html, /data-form-id="settings"/);
        assert.match(html, /<h2 class="dom-title">Настройки<\/h2>/);
    });

    test('status: без крестика (D7 — только кнопка)', () => {
        const html = markup(modal({ kind: 'status', title: 'Награда', closable: false, children: 'x' }));
        assert.doesNotMatch(html, /data-dom-close/);
        assert.match(html, /data-dom-modal-kind="status"/);
    });

    test('кнопки действий рендерятся в блок .dom-actions', () => {
        const html = markup(
            modal({ title: 'T', children: 'x', actions: [dom`<button class="dom-btn">Забрать</button>`] })
        );
        assert.match(html, /<div class="dom-actions"><button class="dom-btn">Забрать<\/button><\/div>/);
    });

    test('нет голых px в разметке (размеры — токены в CSS)', () => {
        const html = markup(modal({ title: 'T', children: 'x' })) + markup(rangeInput({ id: 'music-volume' }));
        assert.doesNotMatch(html, /\b\d+px\b/);
    });
});

describe('rangeInput: слайдер громкости', () => {
    test('input type=range с data-range и подписью', () => {
        const html = markup(rangeInput({ id: 'music-volume', label: 'Громкость:', value: 50 }));
        assert.match(html, /<input class="dom-range-input" type="range"/);
        assert.match(html, /data-range="music-volume"/);
        assert.match(html, /value="50"/);
        assert.match(html, /<span class="dom-name">Громкость:<\/span>/);
    });

    test('границы и шаг пробрасываются', () => {
        const html = markup(rangeInput({ id: 'v', min: 0, max: 100, step: 5, value: 0 }));
        assert.match(html, /min="0"/);
        assert.match(html, /max="100"/);
        assert.match(html, /step="5"/);
        assert.match(html, /value="0"/);
    });
});
