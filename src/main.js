import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { YandexSDK } from './sdk/yandex.js';
import { baseForOrientation } from './layout.js';

// Инициализация SDK Яндекса (этап 2): если скрипт SDK подключён в index.html —
// инициализируемся до старта игры, иначе игра стартует сразу.
// Шрифт Inter ждём до старта, чтобы Phaser Text не отрисовал фолбэк на первом кадре.
const boot = () => {
    // Адаптив: базовая сетка выбирается по ориентации окна (ландшафт 1280x720 /
    // портрет 720x1280), Scale.FIT вписывает canvas в любой размер. При смене
    // ориентации меняем базовый размер и эмитим 'layout-changed' — сцены
    // перечитывают раскладку (computeLayout в src/layout.js).
    const start = baseForOrientation(window.innerWidth, window.innerHeight);
    const game = new Phaser.Game({
        type: Phaser.AUTO,
        width: start.w,
        height: start.h,
        pixelArt: true,
        roundPixels: true,
        backgroundColor: '#2a2a2e',
        parent: 'game',
        disableContextMenu: true,
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },
        scene: [BootScene, GameScene, UIScene]
    });
    // Смена ориентации/размера родителя: FIT сам пересчитывает масштаб canvas,
    // нам нужно только поймать ПЕРЕКЛЮЧЕНИЕ ориентации и сменить базовую сетку.
    game.scale.on('resize', () => {
        const want = baseForOrientation(game.scale.parentSize.width, game.scale.parentSize.height);
        const cur = game.scale.gameSize;
        if (cur.width !== want.w || cur.height !== want.h) {
            game.scale.setGameSize(want.w, want.h);
            game.events.emit('layout-changed', want.h > want.w);
        }
    });
    // Хук для автопроверки вёрстки (scripts/ui-review.mjs): аудит bounds объектов сцен
    window.__GAME = game;

    // Dev Admin Panel: только в dev-сборке. В production import.meta.env.DEV ->
    // false, ветка мертва и выпиливается сборщиком вместе с чанком панели.
    if (import.meta.env.DEV) {
        import('./dev/DevPanel.js').then(m => m.initDevPanel(game));
    }
};

const fontReady = (document.fonts && document.fonts.load)
    ? Promise.all([
        document.fonts.load('16px Monocraft'),
        document.fonts.load('16px Inter')
    ]).catch(() => {})
    : Promise.resolve();

Promise.all([YandexSDK.init(), fontReady]).finally(boot);
