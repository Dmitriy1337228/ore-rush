// Разметка фикстурной мастерской (этап 1). Чистый модуль без DOM/CSS-импортов:
// используется и в браузере (fixtureApp.js), и Node-генератором автономного
// файла для проверки на телефоне без сети (scripts/build-dom-lab.mjs).
import { html } from './html.js';
import { FIXTURES, assetUrl } from './fixtures.js';

const componentChips = () => FIXTURES.components.map((c) => html`
    <span class="dom-chip" data-comp="${c.id}">
        <span class="dom-icon"><img src="${assetUrl(c.icon)}" alt=""></span>
        <span>${c.count}</span>
    </span>`);

const itemRows = () => FIXTURES.items.map((it) => html`
    <article class="dom-row dom-item" data-row="${it.id}">
        <span class="dom-slot"><span class="dom-icon"><img src="${assetUrl(it.icon)}" alt=""></span></span>
        <div class="dom-row-text">
            <div class="dom-name">${it.name}</div>
            <div class="dom-sub">эффект: ${it.desc}</div>
            <div class="dom-stock">в запасе: ${it.stock}</div>
            ${it.error ? html`<div class="dom-error">${it.error}</div>` : ''}
        </div>
        <div class="dom-actions">
            <button class="dom-btn" type="button">Купить ${it.price}</button>
            <button class="dom-btn" type="button" ${it.error === 'стак полон' ? 'disabled' : ''}>${it.action}</button>
        </div>
    </article>`);

const recipeRows = () => FIXTURES.recipes.map((r) => html`
    <article class="dom-row dom-recipe" data-row="${r.id}">
        <span class="dom-slot"><span class="dom-icon"><img src="${assetUrl(r.icon)}" alt=""></span></span>
        <div class="dom-row-text">
            <div class="dom-name">${r.name}</div>
            <div class="dom-desc">${r.desc}</div>
            <div class="dom-need">Нужно:
                ${r.need.map(([comp, n]) => html`
                    <span class="dom-pair"><span class="dom-icon"><img src="${assetUrl(`comp_${comp}`)}" alt=""></span><span>${n}</span></span>`)}
            </div>
            <div class="dom-src">${r.source}</div>
            ${r.status ? html`<div class="dom-status">${r.status}</div>` : ''}
        </div>
        <button class="dom-btn dom-btn-craft" type="button" data-timer="${r.countdownSec || ''}" ${r.status ? 'disabled' : ''}>
            ${r.button}
        </button>
    </article>`);

const artifactCells = () => FIXTURES.artifacts.map((a) => html`
    <article class="dom-art${a.owned ? ' is-owned' : ''}" data-art="${a.id}">
        <span class="dom-slot"><span class="dom-icon"><img src="${assetUrl(a.icon)}" alt=""></span></span>
        <div class="dom-row-text">
            <div class="dom-name">${a.name}</div>
            <div class="dom-line">${a.line}</div>
        </div>
    </article>`);

export function markup() {
    return html`
        <section class="dom-panel" role="dialog" aria-label="Мастерская" data-dom-panel>
            <button class="dom-close" type="button" aria-label="Закрыть"></button>
            <h2 class="dom-title">Мастерская</h2>
            <div class="dom-chips">${componentChips()}</div>
            <p class="dom-hint">компоненты падают с боссов: Карта → «Сразиться!»</p>
            <div class="dom-scroll" data-dom-scroll>
                <h3 class="dom-section">Активируемые</h3>
                ${itemRows()}
                <h3 class="dom-section">Рецепты <span class="dom-warn">крафт нельзя отменить</span></h3>
                ${recipeRows()}
                <h3 class="dom-section">Артефакты</h3>
                <div class="dom-arts">${artifactCells()}</div>
            </div>
        </section>`;
}
