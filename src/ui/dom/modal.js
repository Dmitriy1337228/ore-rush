// Общий каркас DOM-модалки фазы 2 (docs/UI_DOM_PHASE2_PLAN.md, шаг 1.7).
// Скрим глотает клики (pointer-events: auto), панель — по токенам, шапка с крестиком
// (если closable), блок кнопок снизу. Классы — из dom.css; z-порядок — токены
// (статус-модалки выше настроек, D3).
import { html } from './html.js';

/** Контейнер модалок внутри #ui-root (создаётся один раз). */
export function modalHost(root) {
    let host = root.querySelector('[data-dom-modal-host]');
    if (!host) {
        host = document.createElement('div');
        host.dataset.domModalHost = '';
        host.className = 'dom-modal-host';
        root.appendChild(host);
    }

    return host;
}

/**
 * Разметка модалки. kind: 'settings' | 'status' (z-порядок), formId — элемент аудита
 * (data-form-id), closable — крестик, actions — готовые SafeHtml-кнопки.
 */
export function modal({ kind = 'settings', formId = kind, title, closable = true, head = '', children, actions = [] }) {
    const close = closable
        ? html`<button class="dom-close" type="button" aria-label="Закрыть" data-dom-close></button>`
        : '';

    return html`<div class="dom-modal-layer" data-dom-modal-kind="${kind}">
    <div class="dom-backdrop" data-dom-backdrop></div>
    <section class="dom-panel dom-modal" role="dialog" aria-label="${title}" data-dom-modal data-form-id="${formId}">
        ${close}
        <h2 class="dom-title">${title}</h2>
        ${head}
        <div class="dom-scroll" data-dom-scroll>${children}</div>
        ${actions.length ? html`<div class="dom-actions">${actions}</div>` : ''}
    </section>
</div>`;
}
