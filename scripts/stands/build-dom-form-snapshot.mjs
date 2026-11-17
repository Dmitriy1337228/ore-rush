// Автономный снимок DOM-формы (этап 4.5 пилота; фаза 2 — шаг 2.10): один HTML с текущим
// состоянием экрана для проверки на телефоне там, где dev-сервер недоступен.
// Внутрь вшиваются токены, CSS, иконки и Monocraft; кнопки инертны (это снимок).
//
// Запуск: npm run stand:craft-phone [-- --form craft|settings] [--out <file.html>]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { resolveForms } from '../lib/dom-forms.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const FORM_ID = opt('form', 'craft');
const forms = resolveForms(FORM_ID);
const form = forms && forms.find((f) => !f.pending);
if (!form) {
    console.error(`stand:craft-phone: форма "${FORM_ID}" неизвестна или ещё не на DOM`);
    process.exit(2);
}

const OUT = path.resolve(opt('out', `shots/pilot-gates/dom-${form.id}-phone.html`));
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
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        },
        { [SAVE_KEY]: JSON.stringify(SEEDS[form.seed] || SEEDS.mid) }
    );
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction((api) => !!window[api] && window.__GAME.scene.getScene('UIScene').L, form.api, {
        timeout: 30000
    });
    await page.waitForTimeout(1250);
    if (form.prepare) {
        await page.evaluate(form.prepare);
    }

    await page.waitForTimeout(350);
    await page.evaluate(form.open);
    await page.waitForFunction(form.isOpen, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const snap = await page.evaluate(() => {
        const root = document.getElementById('ui-root');

        return { body: root.innerHTML, cls: root.className };
    });
    body = snap.body;
    cls = snap.cls;
    fs.mkdirSync(path.dirname(path.join(ROOT, 'shots/pilot-gates/x')), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, `shots/pilot-gates/dom-${form.id}-phone-src.png`) });
    await ctx.close();
} finally {
    await browser.close();
}

const tokens = fs.readFileSync(path.join(ROOT, 'src/ui/dom/tokens.css'), 'utf8');
const domCss = fs
    .readFileSync(path.join(ROOT, 'src/ui/dom/dom.css'), 'utf8')
    .replace(/url\('([^']+)'\)/g, (m, p) => (p.includes('assets/ui/') ? `url('${dataUri(path.basename(p))}')` : m));
const fontBase64 = fs.readFileSync(path.join(ROOT, 'assets/fonts/Monocraft.ttf')).toString('base64');
const markup = body.replace(/src="assets\/ui\/([^"]+)"/g, (m, name) => `src="${dataUri(name)}"`);

// Снимок: крестик просто скрывает слой формы (игры и состояния здесь нет).
const closeTarget =
    form.id === 'craft' ? 'document.querySelector("[data-dom-panel]")' : 'document.querySelector(".dom-modal-layer")';
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
document.querySelector('.dom-close').addEventListener('click', () => {
  const layer = ${closeTarget};
  if (layer) layer.hidden = true;
});
`;

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>DOM ${form.label} — снимок</title>
<style>
@font-face { font-family: "Monocraft"; src: url(data:font/ttf;base64,${fontBase64}) format("truetype"); }
html, body { margin: 0; padding: 0; height: 100%; background: #1a1c20; overflow: hidden; }
${tokens}
${domCss}
#ui-root { position: absolute; }
</style>
</head>
<body>
<div id="ui-root" class="${cls}">${markup}</div>
<script>${script}</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`stand: ${form.id} — ${path.relative(ROOT, OUT)} (${Math.round(html.length / 1024)} КБ)`);
