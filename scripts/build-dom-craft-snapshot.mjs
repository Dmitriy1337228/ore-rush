// Автономный снимок боевой DOM-мастерской (этап 4.5): один HTML-файл с текущим
// состоянием экрана — для проверки на телефоне там, где dev-сервер недоступен.
// Внутрь вшиваются токены, CSS, иконки и Monocraft; кнопки инертны (это снимок).
//
// Запуск: node scripts/build-dom-craft-snapshot.mjs [--out shots/pilot-gates/dom-craft-phone.html]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY, SEEDS } from './lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const OUT = path.resolve(opt('out', 'shots/pilot-gates/dom-craft-phone.html'));
const BASE = process.env.BASE_URL || 'http://localhost:5174';

const dataUri = (name) =>
    `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'assets/ui', name)).toString('base64')}`;

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();
let body = '';
let cls = '';
try {
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true
    });
    const page = await ctx.newPage();
    await page.addInitScript(
        (s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        },
        { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' }
    );
    await page.goto(`${BASE}/?dom=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__DOM_CRAFT && window.__GAME.scene.getScene('UIScene').L, null, {
        timeout: 30000
    });
    await page.waitForTimeout(1250);
    await page.evaluate(async () => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) ui.hideDailyModal();
        const url = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        for (const c of m.COMPONENTS) m.gameState.components[c.id] = 100;
        for (const i of m.ITEMS) m.gameState.items[i.id] = 2;
    });
    await page.waitForTimeout(350);
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').openCraft());
    await page.waitForTimeout(700);
    const snap = await page.evaluate(() => {
        const root = document.getElementById('ui-root');
        return { body: root.innerHTML, cls: root.className };
    });
    body = snap.body;
    cls = snap.cls;
    await page.screenshot({ path: path.join(ROOT, 'shots/pilot-gates/dom-craft-phone-src.png') });
    await ctx.close();
} finally {
    await browser.close();
}

const tokens = fs.readFileSync(path.join(ROOT, 'src/dom/tokens.css'), 'utf8');
const domCss = fs
    .readFileSync(path.join(ROOT, 'src/dom/dom.css'), 'utf8')
    .replace(/url\('([^']+)'\)/g, (m, p) => (p.includes('assets/ui/') ? `url('${dataUri(path.basename(p))}')` : m));
const fontBase64 = fs.readFileSync(path.join(ROOT, 'assets/fonts/Monocraft.ttf')).toString('base64');
const markup = body.replace(/src="assets\/ui\/([^"]+)"/g, (m, name) => `src="${dataUri(name)}"`);

const script = `
const root = document.getElementById('ui-root');
const sync = () => {
  const portrait = window.innerHeight > window.innerWidth;
  root.style.left = '0px'; root.style.top = '0px';
  root.style.width = window.innerWidth + 'px';
  root.style.height = window.innerHeight + 'px';
  root.classList.toggle('portrait', portrait);
  root.classList.toggle('landscape', !portrait);
};
sync();
window.addEventListener('resize', sync);
window.addEventListener('orientationchange', sync);
// Снимок: действия выключены, крестик просто скрывает панель
document.querySelector('.dom-close').addEventListener('click', () => {
  document.querySelector('[data-dom-panel]').hidden = true;
  document.querySelector('[data-dom-backdrop]').hidden = true;
});
`;

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<title>DOM-мастерская — снимок (пилот)</title>
<style>
@font-face { font-family: 'Monocraft'; src: url(data:font/ttf;base64,${fontBase64}) format('truetype'); font-display: block; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1a1a1a; }
${tokens}
${domCss}
</style>
</head>
<body>
<div id="ui-root" class="${cls}" data-dom-root="1">${markup}</div>
<script>${script}</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`snapshot: ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)} KB)`);
