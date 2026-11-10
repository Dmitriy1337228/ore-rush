import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { YandexSDK } from './sdk/yandex.js';

// Инициализация SDK Яндекса (этап 2): если скрипт SDK подключён в index.html —
// инициализируемся до старта игры, иначе игра стартует сразу.
// Шрифт Inter ждём до старта, чтобы Phaser Text не отрисовал фолбэк на первом кадре.
const boot = () => {
    const game = new Phaser.Game({
        type: Phaser.AUTO,
        width: 1280,
        height: 720,
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
