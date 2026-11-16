// Боевой DOM-экран мастерской (этапы 2–3 пилота).
// Данные — только из снимка моста (bridge.js); действия вызывают функции state.js
// (buyItem/useItem/startCraft/claimCraft), прямых записей в gameState здесь нет.
// Тексты ошибок — craftMessages (единственный источник).
//
// D3: Phaser-модалки рисуются в канвасе (под #ui-root), поэтому при любом оверлее
// верхнего приоритета DOM-панель скрывается; награду покажет штатная очередь.
// Включён по умолчанию в проде и dev: Phaser-экран удалён после пилота.
import { ensureUiRoot } from './root.js';
import { createPublisher } from './bridge.js';
import { html, setHtml, renderKeyed } from './html.js';
import { iconSlot, iconBox, button, card, panel } from './components.js';
import { fitIcons } from './iconFit.js';
import { MSG, buyError, activateError } from '../state/craftMessages.js';
import { buyItem, useItem, startCraft, claimCraft } from '../state.js';
import { playSfx } from '../sfx.js';
import { REG, EVENTS } from '../ui/theme.js';
import './tokens.css';
import './dom.css';

const ERROR_MS = 2000; // как в Phaser (setItemRowError)
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

const itemRow = (it) =>
    card({
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
            ${button({ label: `Купить ${it.priceText}`, dim: it.buyBlocked, act: 'buy', id: it.id })}
            ${button({ label: 'Активировать', dim: it.blocked, act: 'use', id: it.id })}
        </div>`
    });

const recipeRow = (r) =>
    card({
        cls: 'dom-row dom-recipe',
        rowId: r.id,
        children: html`
        ${iconSlot(r.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${r.name}</div>
            <div class="dom-desc">${r.resultText}</div>
            <div class="dom-need">Нужно:
                ${r.need.map(
                    (n) => html`
                    <span class="dom-pair${n.enough ? '' : ' dom-missing'}">${iconBox(n.icon)}<span>${n.n}</span></span>`
                )}
            </div>
            <div class="dom-src">${r.source}</div>
            ${r.status ? html`<div class="dom-status">${r.status}</div>` : ''}
        </div>
        ${button({
            label: r.button,
            cls: 'dom-btn-craft',
            disabled: r.mine ? !r.ready : r.disabled,
            act: r.mine ? 'claim' : 'craft',
            id: r.id
        })}`
    });

const artifactCard = (a) =>
    card({
        cls: `dom-art${a.owned ? ' is-owned' : ''}`,
        artId: a.id,
        act: 'hint',
        children: html`
        ${iconSlot(a.icon)}
        <div class="dom-row-text">
            <div class="dom-name">${a.name}</div>
            <div class="${a.hintActive ? 'dom-error' : 'dom-line'}">${a.hintActive ? a.hint : a.line}</div>
        </div>`
    });

export function createDomCraft(scene) {
    const { root, sync } = ensureUiRoot(scene.game);
    setHtml(root, structure());

    const backdrop = root.querySelector('[data-dom-backdrop]');
    const panelEl = root.querySelector('[data-dom-panel]');
    const closeBtn = root.querySelector('.dom-close');
    const chipsEl = root.querySelector('[data-dom-chips]');
    const itemsEl = root.querySelector('[data-dom-list="items"]');
    const recipesEl = root.querySelector('[data-dom-list="recipes"]');
    const artifactsEl = root.querySelector('[data-dom-list="artifacts"]');
    const scrollEl = root.querySelector('[data-dom-scroll]');
    panelEl.hidden = true;

    const transient = new Map(); // id строки -> { msg, until, kind }
    let lastSnap = null;

    const bossActive = () => !!scene.registry.get(REG.bossActive);

    const itemById = (id) => (lastSnap ? lastSnap.items.find((i) => i.id === id) : null);
    const artifactById = (id) => (lastSnap ? lastSnap.artifacts.find((a) => a.id === id) : null);

    const render = (snapshot) => {
        lastSnap = snapshot;
        const now = Date.now();
        const active = (key) => {
            const t = transient.get(key);

            return t && t.until > now ? t : null;
        };
        const items = snapshot.items.map((item) => {
            const err = active(`i:${item.id}`);

            return err ? { ...item, hint: err.msg, hintKind: 'warn' } : item;
        });
        const artifacts = snapshot.artifacts.map((art) => {
            const hint = active(`a:${art.id}`);

            return hint ? { ...art, hintActive: true } : art;
        });
        renderKeyed(chipsEl, snapshot.components, { keyOf: (c) => c.id, create: chip });
        renderKeyed(itemsEl, items, { keyOf: (i) => i.id, create: itemRow });
        renderKeyed(recipesEl, snapshot.recipes, { keyOf: (r) => r.id, create: recipeRow });
        renderKeyed(artifactsEl, artifacts, { keyOf: (a) => a.id, create: artifactCard });
        fitIcons(root);
    };

    const publisher = createPublisher(render, { getContext: () => ({ bossActive: bossActive() }) });
    const forceRefresh = () => {
        publisher.reset();
        publisher.tick(Date.now());
    };

    const isOpen = () => !panelEl.hidden;

    const open = () => {
        if (isOpen()) {
            return true;
        }

        if (scene.registry.get(REG.blockLocked)) {
            return false;
        }

        panelEl.hidden = false;
        backdrop.hidden = false;
        scene._craftOpen = true;
        transient.clear();
        if (scrollEl) {
            scrollEl.scrollTop = 0;
        }

        forceRefresh();

        return true;
    };

    const close = ({ notify = true } = {}) => {
        if (!isOpen()) {
            return;
        }

        panelEl.hidden = true;
        backdrop.hidden = true;
        scene._craftOpen = false;
        transient.clear();
        if (notify) {
            scene.tryShowDailyModal?.();
        }
    };

    // D3: Phaser-оверлей верхнего приоритета не должен оказаться под DOM-панелью.
    const hasOverlay = () =>
        !!(
            scene._settingsOpen ||
            scene._offlineOpen ||
            scene._dailyOpen ||
            scene._mapOpen ||
            scene._bossRewardOpen ||
            scene._playerDownOpen
        );

    const hideForOverlays = () => {
        if (!isOpen()) {
            return;
        }

        if (hasOverlay()) {
            close({ notify: false });
        }
    };

    // 4.4: реклама/фуллскрин Яндекса — панель прячется, после выхода возвращается
    // (если за это время не открылся Phaser-оверлей), #ui-root пересчитывается.
    let adWasOpen = false;
    const onAdOpen = () => {
        adWasOpen = isOpen();
        if (adWasOpen) {
            close({ notify: false });
        }
    };
    const onAdClose = () => {
        sync();
        if (!adWasOpen) {
            return;
        }

        adWasOpen = false;
        if (hasOverlay()) {
            return;
        }

        panelEl.hidden = false;
        backdrop.hidden = false;
        scene._craftOpen = true;
        forceRefresh();
    };
    scene.game.events.on(EVENTS.adOpen, onAdOpen);
    scene.game.events.on(EVENTS.adClose, onAdClose);

    // Действия S1–S6: единственные точки записи — state.js; тексты — craftMessages.
    const onAction = (act, id) => {
        if (act === 'buy') {
            if (buyItem(id)) {
                transient.delete(`i:${id}`);
                playSfx(scene, 'purchase');
            } else {
                const item = itemById(id);
                transient.set(`i:${id}`, {
                    msg: buyError({ stock: item ? item.stock : 0, stackMax: item ? item.stackMax : 0 }),
                    until: Date.now() + ERROR_MS
                });
            }

            forceRefresh();
        } else if (act === 'use') {
            if (useItem(id, bossActive())) {
                transient.delete(`i:${id}`);
                playSfx(scene, 'purchase');
            } else {
                const item = itemById(id);
                transient.set(`i:${id}`, {
                    msg: activateError({ stock: item ? item.stock : 0, bossUse: item ? item.bossUse : false }),
                    until: Date.now() + ERROR_MS
                });
            }

            forceRefresh();
        } else if (act === 'craft') {
            if (startCraft(id)) {
                // Мгновенный рецепт выдаётся сразу (как в Phaser: startCraft + claimCraft)
                const recipe = lastSnap ? lastSnap.recipes.find((r) => r.id === id) : null;
                if (recipe && recipe.instant) {
                    claimCraft();
                }

                playSfx(scene, 'purchase');
            }

            forceRefresh();
        } else if (act === 'claim') {
            if (claimCraft()) {
                playSfx(scene, 'purchase');
            }

            forceRefresh();
        } else if (act === 'hint') {
            const art = artifactById(id);
            if (art) {
                transient.set(`a:${id}`, { hint: art.hint, until: Date.now() + ERROR_MS });
                forceRefresh();
            }
        }
    };

    panelEl.addEventListener('click', (e) => {
        const el = e.target.closest('[data-act]');
        if (!el || el.hasAttribute('disabled')) {
            return;
        }

        onAction(el.dataset.act, el.dataset.id);
    });

    closeBtn.addEventListener('click', () => close());
    backdrop.addEventListener('click', () => close());
    const onKey = (e) => {
        if (e.key === 'Escape') {
            close();
        }
    };
    window.addEventListener('keydown', onKey);

    const api = {
        open,
        close,
        isOpen,
        hideForOverlays,
        tick() {
            if (!isOpen()) {
                return;
            }

            // Истёкшие подсказки/ошибки требуют перерисовки даже без смены состояния
            const now = Date.now();
            let expired = false;
            for (const [key, t] of transient) {
                if (t.until <= now) {
                    transient.delete(key);
                    expired = true;
                }
            }

            if (expired) {
                forceRefresh();
            }

            publisher.tick(now);
        },
        destroy() {
            window.removeEventListener('keydown', onKey);
            scene.game.events.off(EVENTS.adOpen, onAdOpen);
            scene.game.events.off(EVENTS.adClose, onAdClose);
            close({ notify: false });
            panelEl.remove();
            backdrop.remove();
            if (import.meta.env.DEV && window.__DOM_CRAFT === api) {
                delete window.__DOM_CRAFT;
            }
        }
    };
    if (import.meta.env.DEV) {
        window.__DOM_CRAFT = api;
    }

    return api;
}
