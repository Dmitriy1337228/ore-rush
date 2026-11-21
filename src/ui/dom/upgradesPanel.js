// DOM-панель списка улучшений (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, шаг 2.3).
// Постоянная панель, не модалка (D3): вкладки, переключатель пакета, прокручиваемый
// список рядов. Данные — только из снимка моста (bridge.upgradesSnapshot); покупка —
// единственная запись, buyBulk() из state.js; цены и МАКС считает state (D2).
//
// Раскладка = Phaser-эталон 1:1. Геометрия — те же числа, что у Phaser-ряда
// (shared/listGeometry.js: computeRowGeom/computeRowMetrics) и раскладки (scene.L),
// в canvas-единицах; контроллер переводит их в CSS px одним множителем
// --upg-u = ширина #ui-root / ширина сетки (FIT-масштаб), поэтому панель выглядит
// так же на любом вьюпорте: 1280x720 даёт 1:1, 1920x1080 — ×1.5, как у канваса.
// Карточка ряда — та же текстура (upgrade_row_card_1), растянутая на ряд; кнопки,
// вкладки и пакет — те же текстуры кнопок. Иконки центруются по alpha-bbox.
import { html, toNode, renderKeyed } from './html.js';
import { assetUrl } from './assets.js';
import { fitIcons } from './iconFit.js';
import { upgradesSnapshot, PUBLISH_MS } from './bridge.js';
import { buyBulk, saveGame, gameState } from '../../state.js';
import { BUY_AMOUNTS } from '../../state/upgradesMessages.js';
import { playSfx } from '../../sfx.js';
import { REG, SPACE } from '../shared/theme.js';
import { computeRowGeom, computeRowMetrics, ROW_GAP, PRICE_ICON_DX, PRICE_TEXT_DX } from '../shared/listGeometry.js';
import './tokens.css';
import './dom.css';

const PULSE_MS = 200; // длительность CSS-пульса ряда (dom.css)
const TAP_SLOP_CSS = 10; // дрожание пальца ≤ 10 CSS px = тап (R2)
// Узкая раскладка включается, когда описание Phaser-ряда пришлось бы раздувать порогом
// читаемости больше чем на треть (11 единиц * масштаб < 0.75 * порог): иначе кегль-пол
// ещё сохраняет геометрию Phaser (десктоп-окна с масштабом >= ~0.7)
const NARROW_FONT_SHARE = 0.75;
const LOCK_FONT_MIN = 9; // нижний кегль строки «нужно: …» (Phaser: lockSize > 9)
const DESC_FONT_MIN = 11; // нижний кегль однострочного описания в портрете (Phaser: fitOneLine min 11)

const iconSpan = (key, cls = '') =>
    html`<span class="dom-icon ${cls}" data-icon-rel><img src="${assetUrl(key)}" alt=""></span>`;

const rowHtml = (r) =>
    html`<div class="dom-row dom-upgrades-row" data-row="${r.id}">
        <div class="dom-upgrades-icon">${iconSpan(r.icon)}</div>
        <div class="dom-upgrades-body">
            <span class="dom-name" data-fit="name">${r.name}</span>
            <div class="dom-desc" data-fit="desc">${r.desc}</div>
            ${
                r.lockText
                    ? html`<span class="dom-error" data-fit="lock">${r.lockText}</span>`
                    : html`<span class="dom-upgrades-price ${r.priceKind === 'dim' ? 'is-dim' : ''}">
                          ${r.maxed ? '' : iconSpan(r.priceIcon, 'dom-up-coin')}<span class="dom-up-price-text">${r.priceText}</span>
                      </span>`
            }
        </div>
        <div class="dom-actions">
            <button class="dom-btn dom-up-btn ${r.buttonDim ? 'is-disabled' : ''} ${r.maxed ? 'is-maxed' : ''}" type="button"
                data-buy data-act="buy" data-id="${r.id}">${r.buttonLabel}</button>
            ${r.available ? html`<span class="dom-sub dom-up-level">${r.levelText}</span>` : ''}
        </div>
    </div>`;

const tabHtml = (t) =>
    html`<button class="dom-toggle dom-up-tab" type="button" data-tab="${t.id}" data-on="${t.active ? '1' : '0'}">${t.label}</button>`;

// Как в Phaser: ОДНА кнопка пакета, циклически x1 → x10 → x100 → МАКС
const bulkHtml = (snap) =>
    html`<button class="dom-toggle dom-up-bulk" type="button" data-amount-cycle data-amount="${snap.buyAmount}">${snap.amountLabel}</button>`;

export function createDomUpgrades(scene) {
    const root = document.getElementById('ui-root');
    if (!root) {
        throw new Error('createDomUpgrades: #ui-root не смонтирован (сначала мастерская)');
    }

    const layer = toNode(html`<section class="dom-upgrades" data-dom-upgrades hidden aria-label="Улучшения">
        <div class="dom-tabs" data-dom-upgrades-tabs></div>
        <div class="dom-upgrades-top">
            <span class="dom-upgrades-tier" data-dom-upgrades-tier></span>
            <div class="dom-bulk" data-dom-upgrades-bulk></div>
        </div>
        <div class="dom-upgrades-scroll" data-dom-scroll data-dom-upgrades-scroll>
            <div class="dom-upgrades-rows" data-dom-upgrades-rows></div>
        </div>
    </section>`);
    root.appendChild(layer);

    const tabsEl = layer.querySelector('[data-dom-upgrades-tabs]');
    const bulkEl = layer.querySelector('[data-dom-upgrades-bulk]');
    const tierEl = layer.querySelector('[data-dom-upgrades-tier]');
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
    // Состояние раскладки: ключ геометрии, множитель canvas→CSS px, геометрия рядов
    let layoutKey = '';
    let unit = 1;
    let geom = null;
    let metrics = null;
    let narrow = false;
    let minFont = 0;

    const tokenPx = (name) => parseFloat(getComputedStyle(layer).getPropertyValue(name)) || 0;

    const snapshot = () =>
        upgradesSnapshot({
            tab,
            buyAmount,
            bossActive: !!scene.registry.get(REG.bossActive),
            portrait: !!scene.L?.portrait
        });

    const rowsOf = (snap) => snap.rows.map((r) => ({ ...r, priceIcon: snap.priceIcon }));

    // ---------- Раскладка: canvas-единицы → CSS px ----------
    const px = (units) => `${units * unit}px`;
    const setVars = (vars) => {
        for (const [name, value] of Object.entries(vars)) {
            layer.style.setProperty(name, String(value));
        }
    };

    // Возвращает true, если геометрия изменилась (ряды надо пересобрать)
    const applyLayout = () => {
        const L = scene.L;
        const rootW = root.clientWidth;
        if (!L || !rootW) {
            return false;
        }

        const s = scene._adaptiveScale || 1;
        const key = `${rootW}|${root.clientHeight}|${L.W}x${L.H}|${L.portrait ? 'p' : 'l'}|${s}`;
        if (key === layoutKey) {
            return false;
        }

        layoutKey = key;
        unit = rootW / L.W;
        const p = L.panel;
        const v = L.viewport;
        geom = computeRowGeom(L.portrait, s);
        metrics = computeRowMetrics(v.w, geom, L.portrait);
        minFont = tokenPx('--font-min-css-warn');
        // Узкий ландшафт: описание Phaser-ряда (11 units) ужимается ниже порога читаемости —
        // тогда ряд собирается обычным потоком (кнопка под текстом), кегли — токены
        narrow = !L.portrait && unit * geom.descSize < minFont * NARROW_FONT_SHARE;
        layer.classList.toggle('is-narrow', narrow);

        // Хром: вкладки → строка тира → список. Минимум зоны нажатия (TOUCH) — токен;
        // на десктопе при u ≥ 1 он не срабатывает и хром равен Phaser 1:1.
        const touch = tokenPx(L.portrait ? '--touch-min' : '--touch-min-desktop');
        const tabsH = Math.max(p.tabH * unit, touch);
        const amountH = Math.max(p.amountH * unit, touch);
        const amountW = Math.max(p.amountW * unit, touch);
        // Визуально вкладки/пакет = Phaser; если зона нажатия меньше токена TOUCH,
        // кнопка вырастает симметрично вокруг прежнего центра, а не сдвигает список
        const layerTop = (p.py + p.tabsCY) * unit - tabsH / 2;
        const amountTop = (p.py + p.tierCY) * unit - amountH / 2 - layerTop;
        const scrollTop = v.y * unit - layerTop;
        layer.style.left = px(v.x);
        layer.style.top = `${layerTop}px`;
        layer.style.width = px(v.w);
        layer.style.height = `${(v.y + v.h) * unit - layerTop}px`;
        setVars({
            '--upg-u': `${unit}px`,
            '--upg-tabs-h': `${tabsH}px`,
            '--upg-tab-gap': px(SPACE.sm),
            '--upg-tab-size': p.tabLabelSize,
            '--upg-top-y': `${amountTop}px`,
            '--upg-top-h': `${amountH}px`,
            '--upg-amount-w': `${amountW}px`,
            '--upg-amount-vis-h': px(p.amountH),
            '--upg-amount-size': p.amountSize,
            '--upg-pad-right': px(p.amountPadRight),
            '--upg-tier-inset': px(p.tierInset),
            '--upg-tier-size': p.tierLabelSize,
            '--upg-scroll-top': `${scrollTop}px`,
            '--g-row-h': geom.h,
            '--g-row-gap': ROW_GAP,
            '--g-icon-cx': metrics.iconCX,
            '--g-icon-cy': geom.iconCY,
            '--g-icon-size': geom.iconSize,
            '--g-text-x': metrics.textX,
            '--g-name-y': geom.nameY,
            '--g-name-size': geom.nameSizes[0],
            '--g-name-max-w': metrics.nameMaxW,
            '--g-desc-y': geom.descY,
            '--g-desc-size': geom.descSize,
            '--g-desc-w': metrics.descWrap,
            '--g-price-y': geom.priceY,
            '--g-price-size': geom.priceSize,
            '--g-price-icon': geom.priceIconSize,
            '--g-coin-cx': PRICE_ICON_DX,
            '--g-price-dx': PRICE_TEXT_DX,
            '--g-price-max-w': metrics.btnX - metrics.textX - PRICE_TEXT_DX - SPACE.xs,
            '--g-level-y': geom.levelY,
            '--g-level-size': geom.levelSize,
            '--g-right': geom.rightInset,
            '--g-btn-y': geom.btnY,
            '--g-btn-w': geom.btnW,
            '--g-btn-h': geom.btnH,
            '--g-btn-size': geom.btnSize,
            '--g-lock-size': geom.lockSize,
            '--g-lock-max-w': v.w - metrics.textX - 6
        });

        return true;
    };

    // ---------- Ужим кеглей под ширину (как fitFontSize/fitOneLine в Phaser) ----------
    const sizePx = (units) => `${Math.max(minFont, units * unit)}px`;
    const overflows = (el) => el.scrollWidth > el.clientWidth + 1;

    const fitRow = (row) => {
        if (narrow || !geom || layer.hidden || row.dataset.fitted === layoutKey) {
            return;
        }

        const name = row.querySelector('[data-fit="name"]');
        if (name) {
            for (const size of geom.nameSizes) {
                name.style.fontSize = sizePx(size);
                if (!overflows(name)) {
                    break;
                }
            }
        }

        const desc = row.querySelector('[data-fit="desc"]');
        if (desc && scene.L?.portrait) {
            // Портрет: описание в одну строку, кегль ужимается до DESC_FONT_MIN, затем перенос
            desc.style.whiteSpace = 'nowrap';
            let size = geom.descSize;
            desc.style.fontSize = sizePx(size);
            while (size > DESC_FONT_MIN && overflows(desc)) {
                size -= 1;
                desc.style.fontSize = sizePx(size);
            }

            if (overflows(desc)) {
                desc.style.whiteSpace = 'normal';
            }
        }

        const lock = row.querySelector('[data-fit="lock"]');
        if (lock) {
            let size = geom.lockSize;
            lock.style.fontSize = sizePx(size);
            while (size > LOCK_FONT_MIN && overflows(lock)) {
                size -= 1;
                lock.style.fontSize = sizePx(size);
            }
        }

        row.dataset.fitted = layoutKey;
    };

    const fitRows = () => {
        for (const row of rowsEl.children) {
            fitRow(row);
        }
    };

    // Строка тира: кегль ужимается до порога читаемости, дальше — многоточие
    const fitTier = () => {
        if (!scene.L) {
            return;
        }

        let size = scene.L.panel.tierLabelSize;
        tierEl.style.fontSize = sizePx(size);
        while (sizePx(size) !== `${minFont}px` && overflows(tierEl)) {
            size -= 1;
            tierEl.style.fontSize = sizePx(size);
        }
    };

    const render = (snap = snapshot()) => {
        applyLayout();
        tabsEl.innerHTML = String(snap.tabs.map(tabHtml).join(''));
        tierEl.textContent = snap.tierText;
        bulkEl.innerHTML = String(bulkHtml(snap));
        renderKeyed(rowsEl, rowsOf(snap), {
            keyOf: (r) => r.id,
            create: rowHtml
        });
        lastSig = JSON.stringify(snap);
        fitIcons(layer);
        fitRows();
        fitTier();
        reapplyPulse();

        return snap;
    };

    // Ресайз/ориентация/смена раскладки: геометрия новая — ряды пересобираются целиком
    const relayout = () => {
        // Позиция прокрутки хранится в canvas-единицах: px меняются вместе с масштабом
        const scrolled = scrollEl.scrollTop / unit;
        if (!applyLayout()) {
            return;
        }

        rowsEl.replaceChildren();
        lastSig = '';
        if (!hidden) {
            render();
            scrollEl.scrollTop = scrolled * unit;
        }
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

    // Тик/перерисовка могут заменить узел ряда внутри окна пульса — вешаем класс на новый узел
    const reapplyPulse = () => {
        for (const id of pulseTimers.keys()) {
            rowsEl.querySelector(`[data-row="${id}"]`)?.classList.add('is-pulse');
        }
    };

    // D9: перечитывание одного ряда из state (мимо 150-мс тика), без пересборки списка
    const refreshRow = (id) => {
        if (hidden) {
            return;
        }

        const snap = snapshot();
        const data = rowsOf(snap).find((r) => r.id === id);
        const el = rowsEl.querySelector(`[data-row="${id}"]`);
        if (!data || !el) {
            return;
        }

        const next = toNode(rowHtml(data));
        next.dataset.key = id;
        next.dataset.sig = JSON.stringify(data);
        el.replaceWith(next);
        fitIcons(next);
        fitRow(next);
        reapplyPulse();
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
        // Строгий пакет меняет только купленный ряд (цены других не зависят от руды);
        // МАКС зависит от текущей руды у всех рядов — тогда перечитываем список целиком.
        if (buyAmount === 'max') {
            refresh();
        } else {
            refreshRow(id);
        }

        // Пульс — ПОСЛЕ перерисовки: renderKeyed/refreshRow заменяют узел ряда, и класс со
        // старого узла пропал бы вместе с ним (замечание ревью 🟡-3)
        pulse(id);

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

        if (e.target.closest('[data-amount-cycle]')) {
            const idx = BUY_AMOUNTS.indexOf(buyAmount);
            buyAmount = BUY_AMOUNTS[(idx + 1) % BUY_AMOUNTS.length];
            render();
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
            applyLayout();
            refresh();
            // иконки, смонтированные под hidden, не имели размеров слота — центруем заново
            fitIcons(layer);
        }
    };

    // Ресайз канваса (FIT), смена ориентации и шрифтов — раскладка и ужим пересчитываются
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null;
    resizeObserver?.observe(root);
    const onLayoutChanged = () => relayout();
    scene.game?.events?.on('layout-changed', onLayoutChanged);
    document.fonts?.ready.then(() => {
        // Метрики Monocraft известны только после загрузки шрифта: ужим считается заново
        for (const row of rowsEl.children) {
            delete row.dataset.fitted;
        }

        if (!hidden) {
            fitRows();
            fitTier();
        }
    });

    const api = {
        // Панель — постоянная: "открыта" значит смонтирована и не скрыта оверлеем.
        isOpen: () => !hidden,
        setHidden,
        tick(now = Date.now()) {
            // Seam/D3: бой и полноэкранные Phaser-экраны (карта) выше списка,
            // настройки/мастерская — DOM поверх (свой скрим и z)
            const bossNow = !!scene.registry.get(REG.bossActive);
            const hide =
                bossNow ||
                !!scene._settingsOpen ||
                !!scene._mapOpen ||
                !!scene._craftOpen ||
                // D3: во время обучения (в т.ч. после сброса) вкладки ведёт Phaser
                !gameState.tutorialDone;
            setHidden(hide);
            if (hidden) {
                return false;
            }

            if (now - lastAt < PUBLISH_MS) {
                return false;
            }

            lastAt = now;
            relayout();
            const snap = snapshot();
            const sig = JSON.stringify(snap);
            if (sig === lastSig) {
                return false;
            }

            render(snap);

            return true;
        },
        refreshAll: render,
        refreshRow,
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
            resizeObserver?.disconnect();
            scene.game?.events?.off('layout-changed', onLayoutChanged);
            layer.remove();
            if (import.meta.env.DEV && window.__DOM_UPGRADES === api) {
                delete window.__DOM_UPGRADES;
            }
        }
    };

    if (import.meta.env.DEV) {
        window.__DOM_UPGRADES = api;
    }

    applyLayout();
    render();

    return api;
}
