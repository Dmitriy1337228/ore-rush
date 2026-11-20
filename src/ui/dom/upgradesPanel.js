// DOM-панель списка улучшений (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, шаг 2.3).
// Постоянная панель, не модалка (D3): вкладки, переключатель пакета, прокручиваемый
// список рядов. Данные — только из снимка моста (bridge.upgradesSnapshot); покупка —
// единственная запись, buyBulk() из state.js; цены и МАКС считает state (D2).
// Отклик покупки — принудительное перечитывание ряда из state (D9), не оптимистика.
import { html, toNode, renderKeyed } from './html.js';
import { iconSlot, iconBox } from './components.js';
import { fitIcons } from './iconFit.js';
import { upgradesSnapshot, PUBLISH_MS } from './bridge.js';
import { buyBulk, saveGame } from '../../state.js';
import { playSfx } from '../../sfx.js';
import { REG } from '../shared/theme.js';
import './tokens.css';
import './dom.css';

const PULSE_MS = 200; // длительность CSS-пульса ряда (dom.css)
const TAP_SLOP_CSS = 10; // дрожание пальца ≤ 10 CSS px = тап (R2)

const rowHtml = (r) =>
    html`<article class="dom-row dom-upgrades-row" data-row="${r.id}">
        ${iconSlot(r.icon)}
        <div class="dom-row-text">
            <div class="dom-upgrades-head">
                <span class="dom-name">${r.name}</span>
                <span class="dom-sub">${r.levelText}</span>
            </div>
            <div class="dom-desc">${r.desc}</div>
            ${
                r.lockText
                    ? html`<div class="dom-error">${r.lockText}</div>`
                    : html`<div class="dom-upgrades-price ${r.priceKind === 'dim' ? 'is-dim' : ''}">
                          ${iconBox('coal_nugget', 'dom-pair-icon')}<span>${r.priceText}</span>
                      </div>`
            }
        </div>
        <div class="dom-actions">
            <button class="dom-btn ${r.buttonDim ? 'is-disabled' : ''}" type="button"
                data-buy data-act="buy" data-id="${r.id}">${r.buttonLabel}</button>
        </div>
    </article>`;

const tabHtml = (t) =>
    html`<button class="dom-toggle" type="button" data-tab="${t.id}" data-on="${t.active ? '1' : '0'}">${t.label}</button>`;

const bulkHtml = (b) =>
    html`<button class="dom-toggle" type="button" data-amount="${b.amount}" data-on="${b.active ? '1' : '0'}">${b.label}</button>`;

export function createDomUpgrades(scene) {
    const root = document.getElementById('ui-root');
    if (!root) {
        throw new Error('createDomUpgrades: #ui-root не смонтирован (сначала мастерская)');
    }

    const layer = toNode(html`<section class="dom-upgrades" data-dom-upgrades hidden aria-label="Улучшения">
        <div class="dom-tabs" data-dom-upgrades-tabs></div>
        <div class="dom-bulk" data-dom-upgrades-bulk></div>
        <div class="dom-upgrades-scroll" data-dom-scroll data-dom-upgrades-scroll>
            <div data-dom-upgrades-rows></div>
        </div>
    </section>`);
    root.appendChild(layer);

    const tabsEl = layer.querySelector('[data-dom-upgrades-tabs]');
    const bulkEl = layer.querySelector('[data-dom-upgrades-bulk]');
    const rowsEl = layer.querySelector('[data-dom-upgrades-rows]');
    const scrollEl = layer.querySelector('[data-dom-upgrades-scroll]');

    let tab = 'equipment';
    let buyAmount = 1;
    let hidden = true;
    let pulseTimers = new Map();
    let press = null;
    let dragging = false;
    let lastAt = 0;
    let lastSig = '';

    const snapshot = () =>
        upgradesSnapshot({
            tab,
            buyAmount,
            bossActive: !!scene.registry.get(REG.bossActive),
            portrait: root.classList.contains('portrait')
        });

    const render = (snap = snapshot()) => {
        tabsEl.innerHTML = String(snap.tabs.map(tabHtml).join(''));
        bulkEl.innerHTML = String(snap.bulk.map(bulkHtml).join(''));
        renderKeyed(rowsEl, snap.rows, {
            keyOf: (r) => r.id,
            create: rowHtml
        });
        lastSig = JSON.stringify(snap);
        fitIcons(layer);

        return snap;
    };

    const refresh = () => {
        if (hidden) {
            return null;
        }

        const snap = snapshot();
        lastAt = Date.now();

        return render(snap);
    };

    const pulse = (id) => {
        const el = rowsEl.querySelector(`[data-row="${id}"]`);
        if (!el) {
            return;
        }

        el.classList.remove('is-pulse');
        void el.offsetWidth; // перезапуск CSS-анимации на том же узле
        el.classList.add('is-pulse');
        const prev = pulseTimers.get(id);
        if (prev) {
            clearTimeout(prev);
        }

        pulseTimers.set(
            id,
            setTimeout(() => {
                el.classList.remove('is-pulse');
                pulseTimers.delete(id);
            }, PULSE_MS)
        );
    };

    // D2/D8: состав покупки как в Phaser — buyBulk (state) -> saveGame -> sfx -> пульс,
    // затем ряд(ы) перечитываются из state немедленно (D9: мимо 150-мс тика).
    const buy = (id) => {
        if (hidden || scene.registry.get(REG.blockLocked)) {
            return false;
        }

        if (!buyBulk(id, buyAmount)) {
            return false;
        }

        saveGame();
        playSfx(scene, 'purchase');
        pulse(id);
        refresh();

        return true;
    };

    layer.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) {
            const next = tabBtn.dataset.tab;
            if (next !== tab) {
                tab = next;
                scrollEl.scrollTop = 0;
                render();
            }

            return;
        }

        const bulkBtn = e.target.closest('[data-amount]');
        if (bulkBtn) {
            const raw = bulkBtn.dataset.amount;
            const next = raw === 'max' ? 'max' : Number(raw);
            if (next !== buyAmount) {
                buyAmount = next;
                render();
            }
        }
    });

    // Покупка на pointerup с гасителем драга (аналог _listDragging в Phaser):
    // жест/скролл, начатый на кнопке, не покупает; дрожание ≤ 10 CSS px = тап.
    layer.addEventListener(
        'pointerdown',
        (e) => {
            press = { x: e.clientX, y: e.clientY, id: e.pointerId };
            dragging = false;
        },
        true
    );
    layer.addEventListener(
        'pointermove',
        (e) => {
            if (!press || press.id !== e.pointerId) {
                return;
            }

            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_CSS) {
                dragging = true;
            }
        },
        true
    );
    layer.addEventListener(
        'pointerup',
        (e) => {
            if (!press || press.id !== e.pointerId) {
                return;
            }

            const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y);
            press = null;
            if (dragging || dist > TAP_SLOP_CSS) {
                dragging = false;

                return;
            }

            dragging = false;
            const btn = e.target.closest('[data-buy]');
            if (btn) {
                e.preventDefault();
                buy(btn.dataset.id);
            }
        },
        true
    );
    layer.addEventListener('pointercancel', () => {
        press = null;
        dragging = false;
    });

    const setHidden = (value) => {
        const next = !!value;
        if (next === hidden) {
            return;
        }

        hidden = next;
        layer.hidden = hidden;
        if (!hidden) {
            refresh();
        }
    };

    const api = {
        // Панель — постоянная: "открыта" значит смонтирована и не скрыта оверлеем.
        isOpen: () => !hidden,
        setHidden,
        tick(now = Date.now()) {
            // Seam/D3: бой и полноэкранные Phaser-экраны (карта) выше списка,
            // настройки/мастерская — DOM поверх (свой скрим и z)
            const bossNow = !!scene.registry.get(REG.bossActive);
            const hide = bossNow || !!scene._settingsOpen || !!scene._mapOpen || !!scene._craftOpen;
            setHidden(hide);
            if (hidden) {
                return false;
            }

            if (now - lastAt < PUBLISH_MS) {
                return false;
            }

            lastAt = now;
            const snap = snapshot();
            const sig = JSON.stringify(snap);
            if (sig === lastSig) {
                return false;
            }

            render(snap);

            return true;
        },
        refreshAll: render,
        refreshRow(id) {
            if (hidden) {
                return;
            }

            const snap = snapshot();
            const data = snap.rows.find((r) => r.id === id);
            const el = rowsEl.querySelector(`[data-row="${id}"]`);
            if (!data || !el) {
                return;
            }

            const next = toNode(rowHtml(data));
            next.dataset.key = id;
            el.replaceWith(next);
        },
        switchTab(next) {
            if (next === tab) {
                return;
            }

            tab = next;
            scrollEl.scrollTop = 0;
            render();
        },
        setBuyAmount(next) {
            if (next === buyAmount) {
                return;
            }

            buyAmount = next;
            render();
        },
        getState: () => ({ tab, buyAmount, hidden }),
        destroy() {
            for (const t of pulseTimers.values()) {
                clearTimeout(t);
            }

            pulseTimers = new Map();
            layer.remove();
            if (import.meta.env.DEV && window.__DOM_UPGRADES === api) {
                delete window.__DOM_UPGRADES;
            }
        }
    };

    if (import.meta.env.DEV) {
        window.__DOM_UPGRADES = api;
    }

    render();

    return api;
}
