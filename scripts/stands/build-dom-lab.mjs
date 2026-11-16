// Автономный стенд P1 (этап 1, шаг 1.6): один HTML-файл с DOM-панелью мастерской,
// без сети и Phaser — для проверки шрифта/рамок на реальном телефоне там, где
// dev-сервер/туннель недоступен. Внутрь вшиваются токены, CSS, иконки и Monocraft.
//
// Запуск: node scripts/build-dom-lab.mjs [--out shots/pilot-gates/dom-lab.html]
// Открыть: перекинуть файл на телефон (Telegram/файлы) и открыть в браузере.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markup } from '../../src/dom/fixtureMarkup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const OUT = path.resolve(opt('out', 'shots/pilot-gates/dom-lab.html'));

const dataUri = (name) => {
    const file = path.join(ROOT, 'assets', 'ui', name);

    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
};

const tokens = fs.readFileSync(path.join(ROOT, 'src/dom/tokens.css'), 'utf8');
const domCss = fs
    .readFileSync(path.join(ROOT, 'src/dom/dom.css'), 'utf8')
    .replace(/url\('([^']+)'\)/g, (m, p) => (p.includes('assets/ui/') ? `url('${dataUri(path.basename(p))}')` : m));

const fontBase64 = fs.readFileSync(path.join(ROOT, 'assets/fonts/Monocraft.ttf')).toString('base64');
const body = String(markup()).replace(/src="assets\/ui\/([^"]+)"/g, (m, name) => `src="${dataUri(name)}"`);

// Центровка иконок по alpha-bbox: тот же код, что в src/dom/iconFit.js (единый источник),
// с вырезанным export — стенд не использует модули.
const iconFitSource = fs.readFileSync(path.join(ROOT, 'src/dom/iconFit.js'), 'utf8').replace(/\bexport\s+/g, '');

// Inline-скрипт стенда: размеры #ui-root, класс ориентации, тикающий таймер, закрытие.
const script = `
const root = document.getElementById('ui-root');
const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
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
const timed = document.querySelector('.dom-btn-craft[data-timer]:not([data-timer=""])');
if (timed && timed.dataset.timer) {
  let left = Number(timed.dataset.timer);
  setInterval(() => { left = Math.max(0, left - 1); timed.textContent = left ? 'Забрать ' + fmt(left) : 'Забрать'; }, 1000);
}
const panel = document.querySelector('[data-dom-panel]');
document.querySelector('.dom-close').addEventListener('click', () => { panel.hidden = true; });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });
`;

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<title>DOM-стенд мастерской (пилот)</title>
<style>
@font-face { font-family: 'Monocraft'; src: url(data:font/ttf;base64,${fontBase64}) format('truetype'); font-display: block; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1a1a1a; }
${tokens}
${domCss}
</style>
</head>
<body>
<div id="ui-root" data-dom-root="1">${body}</div>
<script>${script}
${iconFitSource}
fitIcons(root);
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`dom-lab: ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)} KB, изображения и шрифт вшиты)`);
