// Матрица проверки вёрстки: вьюпорты x состояния игры.
// Используется scripts/ui-check.mjs. Чтобы покрыть новое состояние/экран —
// добавьте запись в STATES (seed + setup), вьюпорт — в VIEWPORTS.

// quick: входит в быстрый прогон (`npm run ui:check -- --quick`)
export const VIEWPORTS = [
    { id: 'd1920', width: 1920, height: 1080, quick: false, note: 'десктоп Full HD' },
    { id: 'd1366', width: 1366, height: 768, quick: false, note: 'ноутбук' },
    { id: 'd1280', width: 1280, height: 720, quick: true, note: 'базовая ландшафтная сетка 1:1' },
    { id: 'd1024', width: 1024, height: 768, quick: false, note: '4:3, планшет-ландшафт' },
    { id: 'l844', width: 844, height: 390, quick: false, note: 'телефон в ландшафте (очень низкий)' },
    { id: 't768', width: 768, height: 1024, quick: true, note: 'планшет-портрет' },
    { id: 'p412', width: 412, height: 915, quick: false, note: 'Android-телефон' },
    { id: 'p390', width: 390, height: 844, quick: true, note: 'iPhone, базовый портрет' },
    { id: 'p360', width: 360, height: 640, quick: false, note: 'самый узкий/низкий телефон' }
];

const SAVE_KEY = 'ore-rush-save';
const TIERS = 12;
const earned = (n) => Array.from({ length: TIERS }, (_, i) => (i <= n ? 1e5 : 0));

const SEEDS = {
    // Свежий старт без обучения (обучение — отдельное состояние)
    fresh: { version: 5, tutorialDone: true },
    mid: {
        version: 5, ore: 5000, tier: 1, stars: 12, clicks: 120, lifetimeMined: 5e5, tierEarned: earned(1), tierAnchorRate: 50,
        tutorialDone: true,
        levels: { pickaxe: 13, dynamite: 2, miner: 5, drill: 2, lantern: 1 }
    },
    deep: {
        version: 5, ore: 5e5, tier: 6, stars: 0, clicks: 500, lifetimeMined: 5e6, tierEarned: earned(6), tierAnchorRate: 0,
        tutorialDone: true,
        levels: { pickaxe: 20, sledge: 5, hydraulic: 5, plasma: 2, miner: 30, robotarm: 2, drill: 20, excavator: 15, factory: 10, quarry: 8, megafactory: 5, tech: 2, dynamite: 10, lucky: 8, resonance: 5, lantern: 2, warehouse: 1 }
    },
    // Предельные числа и самые длинные имена: именно здесь вылезают наезды текста
    stress: {
        version: 5, ore: 9.99e33, tier: 11, stars: 99999, clicks: 99999999, lifetimeMined: 9.99e35, tierEarned: Array.from({ length: TIERS }, () => 9.99e30), tierAnchorRate: 1e30,
        tutorialDone: true,
        levels: { pickaxe: 30, sledge: 10, hydraulic: 8, plasma: 6, disintegrator: 5, miner: 999, robotarm: 99, drill: 999, excavator: 999, factory: 999, quarry: 999, megafactory: 999, orbital: 999, quantumlab: 999, wormhole: 999, singularity: 999, dyson: 999, tech: 99, aicore: 99, helmet: 25, dynamite: 23, lucky: 25, resonance: 25, focuslens: 10, magnet: 5, lantern: 10, warehouse: 3 }
    }
};

const hideDaily = (page) => page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
const ui = (page, body) => page.evaluate(`(() => { const ui = window.__GAME.scene.getScene('UIScene'); const gs = window.__GAME.scene.getScene('GameScene'); ${body} })()`);
// state-модуль в браузере: URL берём из resource-entries (dev-сервер отдаёт '/src/state.js?t=...')
const withState = (page, body) => page.evaluate(async (b) => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
    const m = await import(url);
    // eslint-disable-next-line no-new-func
    return (new Function('m', `return (${b})(m);`))(m);
}, body);

const wait = (page, ms = 450) => page.waitForTimeout(ms);

export const STATES = [
    { id: 'fresh', seed: SEEDS.fresh, setup: async (p) => { await hideDaily(p); await wait(p); } },
    { id: 'tutorial', seed: null, setup: async (p) => { await hideDaily(p); await wait(p, 700); } },
    { id: 'daily', seed: SEEDS.fresh, setup: async (p) => { await wait(p, 600); } },
    { id: 'mid', seed: SEEDS.mid, setup: async (p) => { await hideDaily(p); await wait(p); } },
    {
        id: 'mid-scrolled', seed: SEEDS.mid, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.scrollPos = ui.maxScroll; ui.updateScroll();');
            await wait(p);
        }
    },
    {
        id: 'deep', seed: SEEDS.deep, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.scrollPos = Math.round(ui.maxScroll * 0.6); ui.updateScroll();');
            await wait(p);
        }
    },
    {
        id: 'stress', seed: SEEDS.stress, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.scrollPos = Math.round(ui.maxScroll * 0.5); ui.updateScroll();');
            await wait(p);
        }
    },
    {
        id: 'unlock-ready', seed: SEEDS.mid, setup: async (p) => {
            await hideDaily(p);
            await withState(p, 'm => { m.addOre(1e9); }');
            await wait(p, 600);
        }
    },
    {
        id: 'settings', seed: SEEDS.mid, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.settingsBtn.emit("pointerdown");');
            await wait(p, 500);
        }
    },
    {
        id: 'settings-stress', seed: SEEDS.stress, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.settingsBtn.emit("pointerdown");');
            await wait(p, 500);
        }
    },
    {
        id: 'offline', seed: SEEDS.mid, offlineHours: 2, setup: async (p) => { await wait(p, 600); }
    },
    {
        id: 'map', seed: SEEDS.mid, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.openMap();');
            await wait(p, 700);
        }
    },
    {
        id: 'craft', seed: SEEDS.mid, setup: async (p) => {
            await hideDaily(p);
            await withState(p, 'm => { for (const c of m.COMPONENTS) m.gameState.components[c.id] = 100; for (const i of m.ITEMS) m.gameState.items[i.id] = 2; }');
            await ui(p, 'ui.openCraft();');
            await wait(p, 700);
        }
    },
    {
        // DOM-версия мастерской (D5): флаг читается при create(), поэтому reload
        id: 'craft-dom', seed: SEEDS.mid, dom: true, setup: async (p) => {
            await p.evaluate(() => localStorage.setItem('domUi', '1'));
            await p.reload({ waitUntil: 'load' });
            await p.waitForFunction(() => {
                const ui = window.__GAME && window.__GAME.scene.getScene('UIScene');
                return !!(ui && ui.L && window.__DOM_CRAFT);
            }, null, { timeout: 30000 });
            await wait(p, 1200); // отложенная ежедневная награда
            await hideDaily(p).catch(() => {});
            await withState(p, 'm => { for (const c of m.COMPONENTS) m.gameState.components[c.id] = 100; for (const i of m.ITEMS) m.gameState.items[i.id] = 2; }');
            await wait(p, 350);
            await ui(p, 'ui.openCraft();');
            await wait(p, 700);
        }
    },
    {
        id: 'boss', seed: SEEDS.deep, setup: async (p) => {
            await hideDaily(p);
            await withState(p, 'm => { m.gameState.items.item_bomb = 3; m.gameState.items.item_rig = 1; }');
            await ui(p, 'gs.startBossFight("boss_copper");');
            await wait(p, 700);
        }
    },
    {
        id: 'boss-reward', seed: SEEDS.deep, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'gs.startBossFight("boss_copper");');
            await wait(p, 300);
            await ui(p, 'gs.killBoss();');
            await wait(p, 1100);
        }
    },
    {
        id: 'player-down', seed: SEEDS.mid, setup: async (p) => {
            await hideDaily(p);
            await ui(p, 'ui.showPlayerDownModal({ bossName: "Алмазный владыка", dmg: 123456789, maxPlayer: 987654321 });');
            await wait(p, 400);
        }
    }
];

// Воспроизведение репорта (F9 в игре): экраны из report.screens
export async function applyScreens(page, screens = [], listScroll = 0) {
    await hideDaily(page).catch(() => {});
    await wait(page, 300);
    if (listScroll) await ui(page, `ui.scrollPos = ${Number(listScroll) || 0}; ui.updateScroll();`);
    for (const s of screens) {
        if (s === 'map') await ui(page, 'ui.openMap();');
        else if (s === 'craft') await ui(page, 'ui.openCraft();');
        else if (s === 'settings') await ui(page, 'ui.settingsBtn.emit("pointerdown");');
        else if (s.startsWith('boss:')) await ui(page, `gs.startBossFight(${JSON.stringify(s.slice(5))});`);
        await wait(page, 500);
    }
}

export { SAVE_KEY, SEEDS };
