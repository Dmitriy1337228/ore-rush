// Разметка фикстурной мастерской (этап 1). Чистый модуль без DOM/CSS-импортов:
// используется и в браузере (fixtureApp.js), и Node-генератором автономного
// файла для проверки на телефоне без сети (scripts/build-dom-lab.mjs).
// Строители — общие компоненты (components.js), те же, что у боевого DOM-экрана.
import { html } from './html.js';
import { FIXTURES } from './fixtures.js';
import { MSG } from '../state/craftMessages.js';
import { iconSlot, iconBox, button, card, panel } from './components.js';

const componentChips = () =>
    FIXTURES.components.map(
        (c) => html`
    <span class="dom-chip" data-comp="${c.id}">
        ${iconBox(c.icon)}
        <span>${c.count}</span>
    </span>`
    );

const itemRows = () =>
    FIXTURES.items.map((it) =>
        card({
            cls: 'dom-row dom-item',
            rowId: it.id,
            children: html`
        ${iconSlot(it.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${it.name}</div>
            <div class="dom-sub">эффект: ${it.desc}</div>
            <div class="dom-stock">в запасе: ${it.stock}</div>
            ${it.error ? html`<div class="dom-error">${it.error}</div>` : ''}
        </div>
        <div class="dom-actions">
            ${button({ label: `Купить ${it.price}` })}
            ${button({ label: it.action, disabled: it.error === MSG.stackFull })}
        </div>`
        })
    );

const recipeRows = () =>
    FIXTURES.recipes.map((r) =>
        card({
            cls: 'dom-row dom-recipe',
            rowId: r.id,
            children: html`
        ${iconSlot(r.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${r.name}</div>
            <div class="dom-desc">${r.desc}</div>
            <div class="dom-need">Нужно:
                ${r.need.map(
                    ([comp, n]) => html`
                    <span class="dom-pair">${iconBox(`comp_${comp}`)}<span>${n}</span></span>`
                )}
            </div>
            <div class="dom-src">${r.source}</div>
            ${r.status ? html`<div class="dom-status">${r.status}</div>` : ''}
        </div>
        ${button({ label: r.button, timer: r.countdownSec || null, cls: 'dom-btn-craft', disabled: !!r.status })}`
        })
    );

const artifactCells = () =>
    FIXTURES.artifacts.map((a) =>
        card({
            cls: `dom-art${a.owned ? ' is-owned' : ''}`,
            artId: a.id,
            children: html`
        ${iconSlot(a.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${a.name}</div>
            <div class="dom-line">${a.line}</div>
        </div>`
        })
    );

export function markup() {
    const head = html`
        <div class="dom-chips">${componentChips()}</div>
        <p class="dom-hint">компоненты падают с боссов: Карта → «Сразиться!»</p>`;
    const body = html`
        <h3 class="dom-section">Активируемые</h3>
        ${itemRows()}
        <h3 class="dom-section">Рецепты <span class="dom-warn">${MSG.cancelWarning}</span></h3>
        ${recipeRows()}
        <h3 class="dom-section">Артефакты</h3>
        <div class="dom-arts">${artifactCells()}</div>`;

    return panel({ title: 'Мастерская', head, children: body });
}
