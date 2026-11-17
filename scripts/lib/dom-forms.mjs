// Реестр DOM-форм фазы 2 (docs/UI_DOM_PHASE2_PLAN.md, шаг 1.1).
// Гейты (ui:check:dom, dom-golden, pilot-loc, pilot-frame-p95, снимки для телефона)
// берут отсюда API, селекторы, подготовку состояния и ожидаемые элементы, чтобы новая
// форма подключалась записью в реестре, а не копированием скриптов.
//
// `pending: true` — форма ещё не на DOM: гейты печатают «пропущено» и не падают.
import { ITEMS, CRAFT_RECIPES, ARTIFACTS } from '../../src/state.js';

const craftPrepare = `(async () => {
    const ui = window.__GAME.scene.getScene('UIScene');
    ui._pendingDaily = null;
    ui.registry.set('dailyInfo', null);
    if (ui._dailyOpen) {
        ui.hideDailyModal();
    }

    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
    const m = await import(url);
    for (const id of Object.keys(m.gameState.levels)) {
        m.gameState.levels[id] = 0;
    }

    for (const c of m.COMPONENTS) {
        m.gameState.components[c.id] = 100;
    }

    for (const i of m.ITEMS) {
        m.gameState.items[i.id] = 2;
    }

    m.gameState.crafting = null;
    m.gameState.bossBuffUntil = 0;
    m.gameState.miningBuffUntil = 0;
    m.gameState.itemVeinUntil = 0;
    if (m.saveGame) {
        m.saveGame();
    }
})()`;

export const FORMS = [
    {
        id: 'craft',
        label: 'Мастерская',
        pending: false,
        api: '__DOM_CRAFT',
        seed: 'mid',
        prepare: craftPrepare,
        open: "window.__GAME.scene.getScene('UIScene').openCraft()",
        close: "window.__GAME.scene.getScene('UIScene').closeCraft()",
        isOpen: 'window.__DOM_CRAFT.isOpen()',
        panel: '[data-dom-panel]',
        scroll: '[data-dom-scroll]',
        expected: () => [...ITEMS.map((x) => x.id), ...CRAFT_RECIPES.map((x) => x.id), ...ARTIFACTS.map((x) => x.id)],
        states: ['craft'],
        golden: ['1280x720'],
        files: {
            screen: ['src/ui/dom/craft.js', 'src/ui/dom/components.js', 'src/ui/dom/html.js', 'src/ui/dom/iconFit.js'],
            checks: [
                'scripts/verify/verify-craft-dom.mjs',
                'scripts/gates/ui-check-dom.mjs',
                'scripts/gates/dom-golden.mjs'
            ],
            fixtures: ['src/ui/dom/dev/fixtures.js', 'src/ui/dom/dev/fixtureMarkup.js', 'src/ui/dom/dev/fixtureApp.js']
        }
    },
    {
        id: 'settings',
        label: 'Настройки',
        pending: true,
        api: '__DOM_SETTINGS',
        seed: 'mid',
        prepare: null,
        open: "window.__GAME.scene.getScene('UIScene').openModal()",
        close: "window.__GAME.scene.getScene('UIScene').closeModal()",
        isOpen: 'window.__DOM_SETTINGS.isOpen()',
        panel: '[data-dom-modal]',
        scroll: null,
        expected: () => [],
        states: ['settings-dom', 'settings-stress-dom'],
        golden: ['1280x720', '390x844'],
        files: {
            screen: ['src/ui/dom/settingsScreen.js', 'src/ui/dom/modal.js', 'src/ui/dom/lock.js'],
            checks: ['scripts/verify/verify-settings-dom.mjs'],
            fixtures: []
        }
    },
    {
        id: 'status',
        label: 'Статус-модалки',
        pending: true,
        api: '__DOM_STATUS',
        seed: 'mid',
        prepare: null,
        open: "window.__GAME.scene.getScene('UIScene').showOfflineModal({ seconds: 7200, reward: 1200, rate: 0.28, capSeconds: 14400 })",
        close: "window.__GAME.scene.getScene('UIScene').hideOfflineModal()",
        isOpen: "window.__DOM_STATUS.isOpen('offline')",
        panel: '[data-dom-modal]',
        scroll: null,
        expected: () => [],
        kinds: ['offline', 'daily', 'boss-reward', 'player-down'],
        states: ['offline-dom', 'daily-dom', 'boss-reward-dom', 'player-down-dom'],
        golden: ['1280x720', '390x844'],
        files: {
            screen: ['src/ui/dom/statusModals.js', 'src/ui/dom/modal.js'],
            checks: ['scripts/verify/verify-status-dom.mjs'],
            fixtures: []
        }
    }
];

export function formById(id) {
    return FORMS.find((f) => f.id === id) || null;
}

/** Разбор --form: all (по умолчанию) = все не-pending; неизвестное имя — null. */
export function resolveForms(arg) {
    if (!arg || arg === 'all') {
        return FORMS.filter((f) => !f.pending);
    }

    const one = formById(arg);

    return one ? [one] : null;
}
