// Фикстурная мастерская на DOM (этап 1): три типа рядов, скролл, кнопки трёх
// состояний, шрифт Monocraft. Бизнес-логики нет — данные из ./fixtures.js,
// разметка — ./fixtureMarkup.js (общая с автономным стендом для телефона).
// Включается флагом D5: ?dom=1 (или localStorage.domUi=1) в dev-сборке.
import { ensureUiRoot } from './root.js';
import { setHtml } from './html.js';
import { markup } from './fixtureMarkup.js';
import { fitIcons } from './iconFit.js';
import './tokens.css';
import './dom.css';

const fmtTimer = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function renderFixture(root) {
    setHtml(root, markup());
    fitIcons(root);

    const panel = root.querySelector('[data-dom-panel]');
    const closeBtn = root.querySelector('.dom-close');

    const show = () => {
        panel.hidden = false;
    };
    const hide = () => {
        panel.hidden = true;
    };

    closeBtn.addEventListener('click', hide);
    const onKey = (e) => {
        if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);

    // Таймер рецепта: точечное обновление подписи (не перерисовка списка) —
    // заодно проверка, что такие обновления не ломают раскладку.
    const timedBtn = root.querySelector('.dom-btn-craft[data-timer]:not([data-timer=""])');
    let timerId = null;
    if (timedBtn && timedBtn.dataset.timer) {
        let left = Number(timedBtn.dataset.timer);
        timerId = setInterval(() => {
            left = left > 0 ? left - 1 : 0;
            timedBtn.textContent = left > 0 ? `Забрать ${fmtTimer(left)}` : 'Забрать';
        }, 1000);
    }

    return {
        root,
        panel,
        show,
        hide,
        destroy() {
            if (timerId) clearInterval(timerId);
            window.removeEventListener('keydown', onKey);
        }
    };
}

export function mountFixtureCraft(game) {
    const { root } = ensureUiRoot(game);
    const api = renderFixture(root);
    api.destroy = (() => {
        const base = api.destroy;
        return () => {
            base();
            delete window.__DOM_UI;
        };
    })();
    window.__DOM_UI = api;
    return api;
}
