// Стенд P1 (этап 1, шаг 1.6): DOM-панель без Phaser — проверка шрифта и рамок
// на реальном телефоне. Не входит в прод-сборку (отдельный html, не input Vite).
// Запуск: npm run dev -> /dom-lab.html
import './tokens.css';
import './dom.css';
import { renderFixture } from './fixtureApp.js';

const root = document.createElement('div');
root.id = 'ui-root';
root.dataset.domRoot = '1';
document.body.appendChild(root);

const sync = () => {
    const portrait = window.innerHeight > window.innerWidth;
    root.style.left = '0px';
    root.style.top = '0px';
    root.style.width = `${window.innerWidth}px`;
    root.style.height = `${window.innerHeight}px`;
    root.classList.toggle('portrait', portrait);
    root.classList.toggle('landscape', !portrait);
    root.dataset.orientation = portrait ? 'portrait' : 'landscape';
};
sync();
window.addEventListener('resize', sync);
window.addEventListener('orientationchange', sync);

renderFixture(root);
