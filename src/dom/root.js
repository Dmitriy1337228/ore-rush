// DOM-слой над канвасом Phaser (пилот DOM, этап 1, шаг 1.1).
// Контейнер #ui-root повторяет прямоугольник канваса в CSS px (FIT-масштаб,
// центрирование, letterbox) и сам ввод не перехватывает: pointer-events:none,
// у панелей — auto. Позиция/размер — АКТУАЛЬНЫЕ измерения (getBoundingClientRect),
// а не числа раскладки: в CSS-файлах числа не дублируются.

const ROOT_ID = 'ui-root';
const PORTRAIT_CLASS = 'portrait';
const LANDSCAPE_CLASS = 'landscape';

export function ensureUiRoot(game) {
    const canvas = game.canvas;
    if (!canvas) throw new Error('ensureUiRoot: у game нет canvas');

    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.dataset.domRoot = '1';
        document.body.appendChild(root);
    }

    let last = '';
    const sync = () => {
        const r = canvas.getBoundingClientRect();
        const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
        if (key === last) return;
        last = key;
        root.style.left = `${r.left}px`;
        root.style.top = `${r.top}px`;
        root.style.width = `${r.width}px`;
        root.style.height = `${r.height}px`;
        const portrait = r.height > r.width;
        root.classList.toggle(PORTRAIT_CLASS, portrait);
        root.classList.toggle(LANDSCAPE_CLASS, !portrait);
        root.dataset.orientation = portrait ? 'portrait' : 'landscape';
    };

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    game.scale.on('resize', sync);
    game.events.on('layout-changed', sync);

    return {
        root,
        sync,
        destroy() {
            observer.disconnect();
            window.removeEventListener('resize', sync);
            window.removeEventListener('orientationchange', sync);
            game.scale.off('resize', sync);
            game.events.off('layout-changed', sync);
            root.remove();
        }
    };
}
