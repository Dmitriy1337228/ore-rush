// DOM-статус-модалки (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, шаги 1.3–1.6):
// офлайн, дейли, награда босса, вырубление. Один слой modal.js, тексты и числа —
// готовый снимок моста (bridge.*Snapshot), флаги открытия — lock.js. Записи состояния
// здесь нет: награды уже начислены в state до показа (как в Phaser).
import { html, toNode, setHtml } from './html.js';
import { modal, modalHost } from './modal.js';
import { setFormOpen, syncBlockLock } from './lock.js';
import { ensureUiRoot } from './root.js';
import { iconBox, iconSlot } from './components.js';
import { fitIcons } from './iconFit.js';

const FLAGS = {
    offline: '_offlineOpen',
    daily: '_dailyOpen',
    'boss-reward': '_bossRewardOpen',
    'player-down': '_playerDownOpen'
};

const line = (text) => html`<div class="dom-line">${text}</div>`;

// Тело с пустыми строками: каждую строку рисуем отдельным .dom-line, пустые —
// вертикальным зазором (аудит видит реальные текстовые блоки и их пересечения).
const bodyLines = (body) =>
    String(body)
        .split('\n')
        .map((text) => (text ? line(text) : html`<div class="dom-status-gap"></div>`));

const dailyContent = (snap) => html`
    <div class="dom-line dom-status-streak">${snap.streakText}</div>
    <div class="dom-reward">
        ${iconSlot(snap.icon)}
        <div class="dom-reward-text">
            <div class="dom-name">${snap.name}</div>
            <div class="dom-desc">${snap.desc}</div>
        </div>
    </div>
    <div class="dom-daily-slots">
        ${snap.slots.map(
            (s) => html`<span class="dom-daily-slot ${s.active ? 'is-active' : ''}">${iconBox(s.icon)}</span>`
        )}
    </div>`;

const bossRewardContent = (snap) => html`
    <div class="dom-line dom-status-bounty">${snap.bountyText}</div>
    ${snap.speedText ? line(snap.speedText) : ''}
    ${
        snap.comps.length
            ? html`<div class="dom-comps">
              ${snap.comps.map(
                  (c) =>
                      html`<div class="dom-comp">${iconBox(c.icon, 'dom-comp-icon')}${line(`${c.name} ${c.countText}`)}</div>`
              )}
          </div>`
            : ''
    }
    ${
        snap.artifact
            ? html`<div class="dom-artifact">
              ${iconSlot(snap.artifact.icon)}
              <div class="dom-reward-text">
                  <div class="dom-name">${snap.artifact.name}</div>
                  <div class="dom-desc">${snap.artifact.desc}</div>
              </div>
          </div>`
            : ''
    }`;

export function createDomStatusModals(scene) {
    let root = document.getElementById('ui-root');
    if (!root) {
        root = ensureUiRoot(scene.game).root;
    }

    const host = modalHost(root);
    const layer = toNode(
        modal({
            kind: 'status',
            formId: 'status',
            title: '',
            closable: false,
            children: html`<div class="dom-status" data-status-body></div>`,
            actions: [html`<button class="dom-btn" type="button" data-act="status-ok">ОК</button>`]
        })
    );
    layer.hidden = true;
    host.appendChild(layer);

    const panel = layer.querySelector('[data-dom-modal]');
    const titleEl = layer.querySelector('.dom-title');
    const bodyEl = layer.querySelector('[data-status-body]');
    const okBtn = layer.querySelector('[data-act="status-ok"]');

    let kind = null;

    const onOk = () => {
        if (!kind) {
            return;
        }

        if (kind === 'offline') {
            scene.hideOfflineModal();
        } else if (kind === 'daily') {
            scene.hideDailyModal();
        } else if (kind === 'boss-reward') {
            scene.hideBossRewardModal();
        } else if (kind === 'player-down') {
            scene.hidePlayerDownModal();
        }
    };

    layer.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="status-ok"]')) {
            e.stopPropagation();
            onOk();
        }
    });

    // Скрим модалки не закрывает окно награды и не пропускает клики к канвасу.
    layer.querySelector('[data-dom-backdrop]').addEventListener('pointerdown', (e) => e.preventDefault());

    const render = (nextKind, snap) => {
        titleEl.textContent = snap.title;
        okBtn.textContent = snap.okLabel;
        if (nextKind === 'daily') {
            setHtml(bodyEl, dailyContent(snap));
        } else if (nextKind === 'boss-reward') {
            setHtml(bodyEl, bossRewardContent(snap));
        } else {
            setHtml(bodyEl, html`${bodyLines(snap.body)}`);
        }
    };

    const api = {
        show(nextKind, snap) {
            if (!FLAGS[nextKind] || !snap) {
                return false;
            }

            kind = nextKind;
            render(nextKind, snap);
            layer.hidden = false;
            fitIcons(panel);
            setFormOpen(scene, FLAGS[nextKind], true);
            panel.setAttribute('aria-label', snap.title);
            syncBlockLock(scene);

            return true;
        },
        hide(nextKind = kind) {
            if (!nextKind || nextKind !== kind) {
                return false;
            }

            layer.hidden = true;
            setFormOpen(scene, FLAGS[nextKind], false);
            kind = null;
            syncBlockLock(scene);

            return true;
        },
        hideAll() {
            if (kind) {
                api.hide(kind);
            }
        },
        isOpen: (which) => kind === which && !layer.hidden,
        current: () => kind,
        destroy() {
            layer.remove();
            if (import.meta.env.DEV && window.__DOM_STATUS === api) {
                delete window.__DOM_STATUS;
            }
        },
        get panel() {
            return panel;
        }
    };

    if (import.meta.env.DEV) {
        window.__DOM_STATUS = api;
    }

    return api;
}
