// Фикстурная мастерская на DOM (этап 1): три типа рядов, скролл, кнопки трёх
// состояний, шрифт Monocraft. Бизнес-логики нет — данные из ./fixtures.js.
// Включается флагом D5: ?dom=1 (или localStorage.domUi=1) в dev-сборке.
import { ensureUiRoot } from './root.js';
import { html, setHtml } from './html.js';
import { FIXTURES, assetUrl } from './fixtures.js';
import './tokens.css';
import './dom.css';

const fmtTimer = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const componentChips = () => FIXTURES.components.map((c) => html`
    <span class="dom-chip" data-comp="${c.id}">
        <img src="${assetUrl(c.icon)}" alt="">
        <span>${c.count}</span>
    </span>`);

const itemRows = () => FIXTURES.items.map((it) => html`
    <article class="dom-row dom-item" data-row="${it.id}">
        <span class="dom-slot"><img src="${assetUrl(it.icon)}" alt=""></span>
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
        <span class="dom-slot"><img src="${assetUrl(r.icon)}" alt=""></span>
        <div class="dom-row-text">
            <div class="dom-name">${r.name}</div>
            <div class="dom-desc">${r.desc}</div>
            <div class="dom-need">Нужно:
                ${r.need.map(([comp, n]) => html`
                    <span class="dom-pair"><img src="${assetUrl(`comp_${comp}`)}" alt=""><span>${n}</span></span>`)}
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
        <span class="dom-slot"><img src="${assetUrl(a.icon)}" alt=""></span>
        <div class="dom-row-text">
            <div class="dom-name">${a.name}</div>
            <div class="dom-line">${a.line}</div>
        </div>
    </article>`);

function markup() {
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

export function mountFixtureCraft(game) {
    const { root } = ensureUiRoot(game);
    setHtml(root, markup());

    const panel = root.querySelector('[data-dom-panel]');
    const closeBtn = root.querySelector('.dom-close');

    const show = () => { panel.hidden = false; };
    const hide = () => { panel.hidden = true; };

    closeBtn.addEventListener('click', hide);
    const onKey = (e) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);

    // Таймер рецепта: точечное обновление подписи (не перерисовка списка) —
    // заодно проверка, что такие обновления не ломают раскладку.
    const timedBtn = root.querySelector('.dom-btn-craft[data-timer]');
    let timerId = null;
    if (timedBtn && timedBtn.dataset.timer) {
        let left = Number(timedBtn.dataset.timer);
        timerId = setInterval(() => {
            left = left > 0 ? left - 1 : 0;
            timedBtn.textContent = left > 0 ? `Забрать ${fmtTimer(left)}` : 'Забрать';
        }, 1000);
    }

    window.__DOM_UI = {
        root,
        panel,
        show,
        hide,
        destroy() {
            if (timerId) clearInterval(timerId);
            window.removeEventListener('keydown', onKey);
            delete window.__DOM_UI;
        }
    };
    return window.__DOM_UI;
}
