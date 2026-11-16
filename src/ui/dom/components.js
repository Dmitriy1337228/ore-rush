// Базовые DOM-компоненты пилота (этап 2, шаг 2.5): Panel, Card, IconSlot, Button.
// Только разметка + классы из dom.css; состояние сюда не проникает (его даёт
// снимок моста). Одни и те же строители используют фикстуры и боевой экран,
// чтобы стили не расходились.
import { html } from './html.js';
import { assetUrl } from './assets.js';

// Слот иконки: рамка + бокс центровки (iconFit.js выравнивает арт по alpha-bbox).
export const iconSlot = (icon) => html`
    <span class="dom-slot"><span class="dom-icon"><img src="${assetUrl(icon)}" alt=""></span></span>`;

// Иконка без рамки (чипы шапки, пары «Нужно»): размер задаётся классом-модификатором.
export const iconBox = (icon, cls = '') => html`
    <span class="dom-icon ${cls}"><img src="${assetUrl(icon)}" alt=""></span>`;

// Кнопка: 3 состояния в CSS (normal/hover/pressed); dim — серая текстура без
// блокировки нажатия (в Phaser так же: тап по «неактивной» показывает причину).
export const button = ({ label, disabled = false, dim = false, cls = '', timer = null, act = null, id = null }) => html`
    <button class="dom-btn ${dim ? 'is-disabled' : ''} ${cls}" type="button"
        ${disabled ? 'disabled' : ''}
        ${timer === null ? '' : html`data-timer="${timer}"`}
        ${act === null ? '' : html`data-act="${act}"`}
        ${id === null ? '' : html`data-id="${id}"`}>${label}</button>`;

// Карточка: контейнер ряда/ячейки; класс задаёт тип (dom-row / dom-art).
export const card = ({ cls = 'dom-row', rowId = null, artId = null, act = null, children }) => html`
    <article class="${cls}"
        ${rowId ? html`data-row="${rowId}"` : ''}
        ${artId ? html`data-art="${artId}"` : ''}
        ${act === null ? '' : html`data-act="${act}"`}
        ${act === null ? '' : html`data-id="${artId || rowId || ''}"`}>${children}</article>`;

// Врезка: заголовок, крестик, слот шапки (chips) и скролл-область.
export const panel = ({ title, head = '', children }) => html`
    <section class="dom-panel" role="dialog" aria-label="${title}" data-dom-panel>
        <button class="dom-close" type="button" aria-label="Закрыть"></button>
        <h2 class="dom-title">${title}</h2>
        ${head}
        <div class="dom-scroll" data-dom-scroll>${children}</div>
    </section>`;
