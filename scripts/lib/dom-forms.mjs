// Реестр DOM-форм фазы 2 (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, шаг 1.1).
// Гейты (ui:check:dom, dom-golden, pilot-loc, pilot-frame-p95, снимки для телефона)
// берут отсюда API, селекторы, подготовку состояния и ожидаемые элементы, чтобы новая
// форма подключалась записью в реестре, а не копированием скриптов.
//
// `pending: true` — форма ещё не на DOM: гейты печатают «пропущено» и не падают.
import { ITEMS, CRAFT_RECIPES, ARTIFACTS, UPGRADES } from '../../src/state.js';

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
        pending: false,
        api: '__DOM_SETTINGS',
        seed: 'mid',
        prepare: `(() => {
            const ui = window.__GAME.scene.getScene('UIScene');
            ui._pendingDaily = null;
            ui.registry.set('dailyInfo', null);
            if (ui._dailyOpen) ui.hideDailyModal();
        })()`,
        open: "window.__GAME.scene.getScene('UIScene').openModal()",
        close: "window.__GAME.scene.getScene('UIScene').closeModal()",
        isOpen: 'window.__DOM_SETTINGS.isOpen()',
        panel: '[data-dom-modal]',
        scroll: '[data-dom-scroll]',
        expected: () => ['stats', 'sound', 'music', 'music-volume', 'prestige', 'reset'],
        states: ['settings-dom', 'settings-stress-dom'],
        golden: ['1280x720', '390x844'],
        files: {
            screen: [
                'src/ui/dom/settingsScreen.js',
                'src/ui/dom/modal.js',
                'src/ui/dom/lock.js',
                'src/state/settings.js',
                'src/state/settingsMessages.js'
            ],
            checks: ['scripts/verify/verify-settings-dom.mjs'],
            fixtures: []
        }
    },
    {
        id: 'status',
        label: 'Статус-модалки',
        pending: false,
        api: '__DOM_STATUS',
        seed: 'mid',
        prepare:
            "(() => { const ui = window.__GAME.scene.getScene('UIScene'); ui._pendingDaily = null; ui.registry.set('dailyInfo', null); if (ui._dailyOpen) ui.hideDailyModal(); })()",
        open: "window.__GAME.scene.getScene('UIScene').showOfflineModal({ seconds: 7200, reward: 1200, counted: 3600 })",
        close: "window.__GAME.scene.getScene('UIScene').hideOfflineModal()",
        isOpen: "window.__DOM_STATUS.isOpen('offline')",
        panel: '[data-dom-modal]',
        scroll: null,
        expected: () => [],
        kinds: [
            {
                id: 'offline',
                open: "window.__GAME.scene.getScene('UIScene').showOfflineModal({ seconds: 7200, reward: 1200, counted: 3600 })",
                isOpen: "window.__DOM_STATUS.isOpen('offline')",
                close: "window.__GAME.scene.getScene('UIScene').hideOfflineModal()"
            },
            {
                id: 'daily',
                open: "(() => { const ui = window.__GAME.scene.getScene('UIScene'); ui._pendingDaily = { streak: 3, extra: 250 }; ui.tryShowDailyModal(); })()",
                isOpen: "window.__DOM_STATUS.isOpen('daily')",
                close: "window.__GAME.scene.getScene('UIScene').hideDailyModal()"
            },
            {
                id: 'boss-reward',
                open: "window.__GAME.scene.getScene('UIScene').showBossRewardModal({ bounty: 5000, elapsedSec: 32, speedMult: 1.5, comps: { scrap: 2, crystal: 1 }, artifactId: 'art_miner_totem' })",
                isOpen: "window.__DOM_STATUS.isOpen('boss-reward')",
                close: "window.__GAME.scene.getScene('UIScene').hideBossRewardModal()"
            },
            {
                id: 'player-down',
                open: "window.__GAME.scene.getScene('UIScene').showPlayerDownModal({ bossName: 'Алмазный владыка', dmg: 123456789, maxPlayer: 987654321 })",
                isOpen: "window.__DOM_STATUS.isOpen('player-down')",
                close: "window.__GAME.scene.getScene('UIScene').hidePlayerDownModal()"
            }
        ],
        states: ['offline-dom', 'daily-dom', 'boss-reward-dom', 'player-down-dom'],
        golden: ['1280x720', '390x844'],
        files: {
            screen: ['src/ui/dom/statusModals.js', 'src/ui/dom/modal.js'],
            checks: ['scripts/verify/verify-status-dom.mjs'],
            fixtures: []
        }
    },
    {
        // Фаза 3, M3: постоянная панель списка улучшений (не модалка). Аудит меряет
        // панель в двух состояниях: обычный каталог (mid) и stress-сид.
        id: 'upgrades',
        label: 'Список улучшений',
        pending: true,
        api: '__DOM_UPGRADES',
        seed: 'mid',
        prepare: null,
        open: "(() => { const ui = window.__GAME.scene.getScene('UIScene'); ui._pendingDaily = null; ui.registry.set('dailyInfo', null); if (ui._dailyOpen) ui.hideDailyModal(); })()",
        close: null,
        isOpen: '!!window.__DOM_UPGRADES',
        panel: '[data-dom-upgrades]',
        scroll: '[data-dom-upgrades-scroll]',
        expected: () => UPGRADES.map((u) => u.id),
        states: ['upgrades-dom', 'upgrades-stress-dom'],
        golden: ['1280x720', '390x844'],
        // Аудит обходит обе вкладки (20 equipment + 7 enhance = 27 рядов в expected)
        tabs: ['equipment', 'enhance'],
        switchTab: (id) => `window.__DOM_UPGRADES.switchTab(${JSON.stringify(id)})`,
        files: {
            screen: [
                'src/ui/dom/upgradesPanel.js',
                'src/state/upgradesMessages.js',
                'src/ui/phaser/upgrades.js',
                'src/ui/phaser/gear.js'
            ],
            checks: ['scripts/verify/verify-upgrades-dom.mjs'],
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
