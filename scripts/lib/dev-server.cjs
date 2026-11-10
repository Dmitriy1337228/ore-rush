// Общий менеджер dev-сервера для проверочных скриптов.
// Если порт уже отвечает — подключаемся к чужому серверу и НЕ гасим его;
// иначе поднимаем vite сами и releaseDevServer() убивает только свой процесс.
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 5174;
const BASE = `http://localhost:${PORT}`;
// __dirname = scripts/lib -> корень проекта на два уровня выше
const PROJECT_ROOT = path.join(__dirname, '..', '..');

function portReady() {
    return new Promise((resolve) => {
        const req = http.get(BASE, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
}

async function waitForServer(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await portReady()) return true;
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

// Возвращает { base, spawned, pid }. Синхронный release по pid через taskkill /T.
async function ensureDevServer(timeoutMs = 20000) {
    if (await portReady()) return { base: BASE, spawned: false, pid: 0 };
    const child = spawn('cmd', ['/c', 'npx', 'vite', '--port', String(PORT), '--strictPort'], {
        cwd: PROJECT_ROOT,
        stdio: 'ignore',
        windowsHide: true
    });
    // Не держим event loop родителя: exit-хендлер вызывающего скрипта
    // гасит ребёнка через taskkill.
    child.unref();
    const ok = await waitForServer(timeoutMs);
    if (!ok) {
        try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { /* уже мёртв */ }
        throw new Error(`dev-сервер не поднялся за ${timeoutMs} мс`);
    }
    return { base: BASE, spawned: true, pid: child.pid };
}

// Синхронно (пригоден для process.on('exit')) гасит ТОЛЬКО свой сервер.
function releaseDevServer(server) {
    if (!server || !server.spawned || !server.pid) return;
    try {
        execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    } catch (e) { /* процесс уже завершён */ }
}

module.exports = { ensureDevServer, releaseDevServer, BASE, PORT };
