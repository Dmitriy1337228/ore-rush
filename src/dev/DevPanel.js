// Dev Admin Panel — панель разработчика для теста прогрессии и баланса.
// Подключается ТОЛЬКО в dev-режиме: main.js делает условный динамический импорт
//   if (import.meta.env.DEV) { import('./dev/DevPanel.js').then(...) }
// В production import.meta.env.DEV заменяется на false, ветка выпиливается
// сборщиком вместе с этим чанком. Код панели не попадает к игрокам.

import {
    gameState, UPGRADES, TIERS, getUpgradeDef, addOre, saveGame, computeOfflineReward, resetGame,
    forceNextTier, MUTATIONS, LAST_EXIT_KEY, LEGACY_LAST_EXIT_KEY
} from '../state.js';
import { MOCK_STATS_KEY } from '../sdk-stub.js';

let panel = null;
let statePre = null;
let statusLine = null;
let grantSelect = null;
let grantLevel = null;
let visible = false;

function log(msg) {
    if (statusLine) statusLine.textContent = msg;
    console.info('[DevPanel] ' + msg);
}

function refreshState() {
    if (statePre) statePre.textContent = JSON.stringify(gameState, (k, v) => v, 2);
}

function after(refreshTierVisuals = false) {
    saveGame();
    const gs = window.__GAME && window.__GAME.scene.getScene('GameScene');
    if (gs) {
        gs.refreshTick();
        if (refreshTierVisuals) window.__GAME.events.emit('tier-changed');
    }
    refreshState();
}

function addOreClick(amount) {
    addOre(amount);
    log(`+${amount} руды текущего тира`);
    after();
}

function resetOre() {
    gameState.ore = 0;
    log('ресурсы сброшены в 0');
    after();
}

function maxAll() {
    for (const def of UPGRADES) {
        gameState.levels[def.id] = def.maxLevel !== null ? def.maxLevel : 50;
    }
    log('все улучшения выставлены на максимум (бесконечные -> 50)');
    after();
}

// Выдача любого улучшения в любом количестве, без требований и цены.
// Устанавливает уровень напрямую — обход цепочек requires и стоимости.
function grantUpgrade() {
    const id = grantSelect.value;
    const n = Math.max(0, parseInt(grantLevel.value, 10) || 0);
    gameState.levels[id] = n;
    const def = getUpgradeDef(id);
    log(`выдано: ${def.name} -> ур. ${n}`);
    after();
}

function forceTier() {
    if (!forceNextTier()) {
        log('уже максимальный тир (Алмаз)');
        return;
    }
    log(`принудительный переход на тир ${gameState.tier + 1} (${TIERS[gameState.tier].name})`);
    after(true);
}

// Мутации блока: навесить любую мутацию вручную (10с, переживает разрушение блока)
function applyMutation(typeId) {
    const gs = window.__GAME && window.__GAME.scene.getScene('GameScene');
    if (!gs) {
        log('GameScene ещё не готов');
        return;
    }
    gs.startMutation(typeId);
    log(`мутация: ${MUTATIONS[typeId].name} (${MUTATIONS[typeId].desc})`);
    after();
}

function removeMutation() {
    const gs = window.__GAME && window.__GAME.scene.getScene('GameScene');
    if (!gs || !gs.mutation) {
        log('активной мутации нет');
        return;
    }
    gs.clearMutation(true);
    log('мутация снята');
    after();
}

// Симуляция офлайна идёт по ТОМУ ЖЕ коду, что и реальный возврат:
// computeOfflineReward -> addOre -> registry.offlineInfo -> событие offline-applied
function simulateOffline(hours) {
    const game = window.__GAME;
    const gs = game && game.scene.getScene('GameScene');
    if (!gs) {
        log('GameScene ещё не готов');
        return;
    }
    const info = computeOfflineReward(Date.now() - hours * 3600 * 1000);
    if (!info) {
        log('пассивный доход = 0 — симулировать нечего');
        return;
    }
    addOre(info.reward);
    gs.registry.set('offlineInfo', info);
    saveGame();
    gs.refreshTick();
    game.events.emit('offline-applied', info);
    log(`симуляция ${hours} ч офлайн: +${Math.floor(info.reward)} руды (окно должно открыться)`);
    after();
}

// Полный сброс: состояние, сейв, следы офлайна, визуал тира — «как при первом запуске»
function fullReset() {
    const game = window.__GAME;
    const gs = game && game.scene.getScene('GameScene');
    const ui = game && game.scene.getScene('UIScene');
    resetGame();
    try {
        localStorage.removeItem(LAST_EXIT_KEY);
        localStorage.removeItem(LEGACY_LAST_EXIT_KEY); // фолбэк старого имени игры — тоже чистим
        localStorage.removeItem(MOCK_STATS_KEY);
    } catch (e) { /* приватный режим — сейв уже сброшен */ }
    if (ui) {
        ui.hideOfflineModal();
        ui.closeModal();
    }
    if (gs) {
        if (gs.mutation) gs.clearMutation(false);
        gs.registry.set('offlineInfo', null);
        gs.registry.set('blockLocked', false);
        gs.blockBusy = false;
        gs.blockStage = 0;
    }
    game.events.emit('tier-changed');
    if (ui) ui.maybeRebuildTutorial(); // обучение показывается заново в текущей сессии
    log('полный сброс: игра как при первом запуске');
    after();
}

function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
}

function buildPanel(game) {
    panel = document.createElement('div');
    panel.id = 'dev-admin-panel';
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'dev-title';
    title.textContent = 'DEV ADMIN PANEL (~ / Shift+D)';

    const grid = document.createElement('div');
    grid.className = 'dev-grid';

    // Ресурсы
    grid.appendChild(makeButton('+1K', () => addOreClick(1000)));
    grid.appendChild(makeButton('+1M', () => addOreClick(1e6)));
    grid.appendChild(makeButton('+1B', () => addOreClick(1e9)));
    grid.appendChild(makeButton('Ресурсы в 0', resetOre));

    // Улучшения и тиры
    grid.appendChild(makeButton('Макс всё', maxAll));
    grid.appendChild(makeButton('След. тир', forceTier));
    grid.appendChild(makeButton('Полный сброс', fullReset));

    // Офлайн-симуляция
    grid.appendChild(makeButton('Офлайн 1ч', () => simulateOffline(1)));
    grid.appendChild(makeButton('Офлайн 4ч', () => simulateOffline(4)));

    // Мутации блока: навесить любую / убрать — для теста Этапа 3
    for (const id of Object.keys(MUTATIONS)) {
        grid.appendChild(makeButton(MUTATIONS[id].name, () => applyMutation(id)));
    }
    grid.appendChild(makeButton('Убрать мутацию', removeMutation));

    statusLine = document.createElement('div');
    statusLine.className = 'dev-status';

    // Выдача улучшений: селект по всем улучшениям + уровень + кнопка (без условий)
    const grantRow = document.createElement('div');
    grantRow.className = 'dev-grant-row';
    grantSelect = document.createElement('select');
    for (const def of UPGRADES) {
        const opt = document.createElement('option');
        opt.value = def.id;
        opt.textContent = `${def.tab === 'equipment' ? 'Оборуд' : 'Усилен'}: ${def.name}`;
        grantSelect.appendChild(opt);
    }
    grantLevel = document.createElement('input');
    grantLevel.type = 'number';
    grantLevel.min = '0';
    grantLevel.value = '50';
    grantRow.appendChild(grantSelect);
    grantRow.appendChild(grantLevel);
    grantRow.appendChild(makeButton('Выдать', grantUpgrade));

    statePre = document.createElement('pre');
    statePre.className = 'dev-state';

    panel.appendChild(title);
    panel.appendChild(grid);
    panel.appendChild(grantRow);
    panel.appendChild(statusLine);
    panel.appendChild(statePre);

    const style = document.createElement('style');
    style.textContent = `
        #dev-admin-panel {
            position: fixed;
            left: 8px;
            bottom: 8px;
            width: 264px;
            max-height: 70vh;
            overflow: auto;
            background: rgba(10, 12, 16, 0.88);
            border: 1px solid #3a4150;
            border-radius: 6px;
            padding: 8px;
            z-index: 9999;
            font: 11px/1.4 Consolas, monospace;
            color: #d8dce4;
            user-select: none;
        }
        #dev-admin-panel .dev-title { font-weight: bold; color: #ffd75e; margin-bottom: 6px; }
        #dev-admin-panel .dev-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
        #dev-admin-panel button {
            background: #23272f; color: #d8dce4; border: 1px solid #3a4150;
            border-radius: 3px; padding: 4px 6px; font: 11px Consolas, monospace;
            cursor: pointer; text-align: left;
        }
        #dev-admin-panel button:hover { background: #2e3440; }
        #dev-admin-panel .dev-status { color: #8fd18f; margin: 6px 0 4px; min-height: 13px; }
        #dev-admin-panel .dev-grant-row { display: flex; gap: 4px; margin: 4px 0; }
        #dev-admin-panel .dev-grant-row select {
            flex: 1; min-width: 0; background: #23272f; color: #d8dce4;
            border: 1px solid #3a4150; border-radius: 3px; font: 11px Consolas, monospace; padding: 3px;
        }
        #dev-admin-panel .dev-grant-row input {
            width: 48px; flex: none; background: #23272f; color: #d8dce4;
            border: 1px solid #3a4150; border-radius: 3px; font: 11px Consolas, monospace; padding: 3px;
        }
        #dev-admin-panel .dev-state {
            background: #14161a; border: 1px solid #2a2f38; border-radius: 3px;
            padding: 4px; margin: 0; max-height: 200px; overflow: auto;
            font: 10px/1.35 Consolas, monospace; color: #a8b0bc; white-space: pre;
        }
        #dev-click-zone {
            position: fixed; left: 0; top: 0; width: 20px; height: 20px;
            z-index: 9998; cursor: default;
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    // Скрытая зона в углу: клик по ней тоже открывает/закрывает панель
    const zone = document.createElement('div');
    zone.id = 'dev-click-zone';
    zone.addEventListener('click', () => toggle());
    document.body.appendChild(zone);
}

function toggle() {
    visible = !visible;
    panel.style.display = visible ? 'block' : 'none';
    if (visible) {
        refreshState();
        log('панель открыта');
    }
}

export function initDevPanel(game) {
    if (panel) return; // защита от двойной инициализации
    buildPanel(game);
    panel.style.display = 'none';

    // Горячие клавиши: ~ (Backquote) или Shift+D
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Backquote' || (e.shiftKey && e.code === 'KeyD')) {
            e.preventDefault();
            toggle();
        }
    });

    log('dev-панель инициализирована (скрыта, ~ / Shift+D для открытия)');
}
