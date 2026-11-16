// Боевой DOM-экран мастерской (этап 2 пилота, шаги 2.1/2.3/2.4/2.6).
// Каркас: врезка по токенам, чипы компонентов и три списка из снимка моста.
// Действия (покупка/активация/крафт) появятся на этапе 3; здесь экран открывается
// по openCraft(), держит блокировку игры и закрывается крестиком/Esc/фоном.
//
// D3 (слои): Phaser-модалки рисуются в канвасе — под #ui-root. Поэтому при любом
// Phaser-оверлее верхнего приоритета DOM-панель сразу скрывается; после закрытия
// оверлея награда показывается штатной очередью (scene.tryShowDailyModal).
//
// D5: включается флагом isDomUiEnabled(); по умолчанию работает Phaser-экран.
import { ensureUiRoot } from './root.js';
import { createPublisher } from './bridge.js';
import { html, setHtml, renderKeyed } from './html.js';
import { iconSlot, iconBox, button, card, panel } from './components.js';
import { fitIcons } from './iconFit.js';
import { MSG } from '../state/craftMessages.js';
import { REG } from '../ui/theme.js';
import './tokens.css';
import './dom.css';

const structure = () => html`
    <div class="dom-backdrop" data-dom-backdrop hidden></div>
    ${panel({
        title: 'Мастерская',
        head: html`
            <div class="dom-chips" data-dom-chips></div>
            <p class="dom-hint">компоненты падают с боссов: Карта → «Сразиться!»</p>`,
        children: html`
            <h3 class="dom-section">Активируемые</h3>
            <div data-dom-list="items"></div>
            <h3 class="dom-section">Рецепты <span class="dom-warn">${MSG.cancelWarning}</span></h3>
            <div data-dom-list="recipes"></div>
            <h3 class="dom-section">Артефакты</h3>
            <div class="dom-arts" data-dom-list="artifacts"></div>`
    })}`;

const chip = (c) => html`
    <span class="dom-chip" data-comp="${c.id}">${iconBox(c.icon)}<span>${c.text}</span></span>`;

const itemRow = (it) => card({
    cls: 'dom-row dom-item',
    rowId: it.id,
    children: html`
        ${iconSlot(it.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${it.name}</div>
            <div class="dom-sub">эффект: ${it.desc}</div>
            <div class="${it.hintKind === 'warn' ? 'dom-error' : 'dom-stock'}">${it.hint}</div>
        </div>
        <div class="dom-actions">
            ${button({ label: `Купить ${it.priceText}`, disabled: it.buyBlocked })}
            ${button({ label: 'Активировать', disabled: it.blocked })}
        </div>`
});

const recipeRow = (r) => card({
    cls: 'dom-row dom-recipe',
    rowId: r.id,
    children: html`
        ${iconSlot(r.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${r.name}</div>
            <div class="dom-desc">${r.resultText}</div>
            <div class="dom-need">Нужно:
                ${r.need.map((n) => html`
                    <span class="dom-pair${n.enough ? '' : ' dom-missing'}">${iconBox(n.icon)}<span>${n.n}</span></span>`)}
            </div>
            <div class="dom-src">${r.source}</div>
            ${r.status ? html`<div class="dom-status">${r.status}</div>` : ''}
        </div>
        ${button({ label: r.button, cls: 'dom-btn-craft', disabled: r.disabled && !r.ready })}`
});

const artifactCard = (a) => card({
    cls: `dom-art${a.owned ? ' is-owned' : ''}`,
    artId: a.id,
    children: html`
        ${iconSlot(a.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${a.name}</div>
            <div class="dom-line">${a.line}</div>
        </div>`
});

export function createDomCraft(scene) {
    const { root } = ensureUiRoot(scene.game);
    setHtml(root, structure());

    const backdrop = root.querySelector('[data-dom-backdrop]');
    const panelEl = root.querySelector('[data-dom-panel]');
    const closeBtn = root.querySelector('.dom-close');
    const chipsEl = root.querySelector('[data-dom-chips]');
    const itemsEl = root.querySelector('[data-dom-list="items"]');
    const recipesEl = root.querySelector('[data-dom-list="recipes"]');
    const artifactsEl = root.querySelector('[data-dom-list="artifacts"]');
    panelEl.hidden = true;

    const render = (snapshot) => {
        renderKeyed(chipsEl, snapshot.components, { keyOf: (c) => c.id, create: chip });
        renderKeyed(itemsEl, snapshot.items, { keyOf: (i) => i.id, create: itemRow });
        renderKeyed(recipesEl, snapshot.recipes, { keyOf: (r) => r.id, create: recipeRow });
        renderKeyed(artifactsEl, snapshot.artifacts, { keyOf: (a) => a.id, create: artifactCard });
        fitIcons(root);
    };

    const publisher = createPublisher(render, {
        getContext: () => ({ bossActive: !!scene.registry.get(REG.bossActive) })
    });

    const isOpen = () => !panelEl.hidden;

    const open = () => {
        if (isOpen()) return true;
        if (scene.registry.get(REG.blockLocked)) return false;
        panelEl.hidden = false;
        backdrop.hidden = false;
        scene._craftOpen = true;
        publisher.reset();
        publisher.tick(Date.now());
        const scroll = root.querySelector('[data-dom-scroll]');
        if (scroll) scroll.scrollTop = 0;
        return true;
    };

    const close = ({ notify = true } = {}) => {
        if (!isOpen()) return;
        panelEl.hidden = true;
        backdrop.hidden = true;
        scene._craftOpen = false;
        if (notify) scene.tryShowDailyModal?.();
    };

    // D3: Phaser-оверлей верхнего приоритета не должен оказаться под DOM-панелью.
    const hideForOverlays = () => {
        if (!isOpen()) return;
        const overlay = scene._settingsOpen || scene._offlineOpen || scene._dailyOpen
            || scene._mapOpen || scene._bossRewardOpen || scene._playerDownOpen;
        if (overlay) close({ notify: false });
    };

    closeBtn.addEventListener('click', () => close());
    backdrop.addEventListener('click', () => close());
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);

    const api = {
        open,
        close,
        isOpen,
        hideForOverlays,
        tick() {
            if (!isOpen()) return;
            publisher.tick(Date.now());
        },
        destroy() {
            window.removeEventListener('keydown', onKey);
            close({ notify: false });
            panelEl.remove();
            backdrop.remove();
            if (import.meta.env.DEV && window.__DOM_CRAFT === api) delete window.__DOM_CRAFT;
        }
    };
    if (import.meta.env.DEV) window.__DOM_CRAFT = api;
    return api;
}