import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Копируем игровые ассеты в dist: Phaser грузит их по относительным путям 'assets/ui/...'
// (шрифт в assets/fonts обрабатывает сам Vite — хеширует и подключает в CSS)
function copyGameAssets() {
    return {
        name: 'copy-game-assets',
        apply: 'build',
        closeBundle() {
            for (const dir of ['ui', 'audio']) {
                fs.cpSync(path.join(import.meta.dirname, 'assets', dir), path.join(import.meta.dirname, 'dist', 'assets', dir), { recursive: true });
            }
        }
    };
}

export default defineConfig({
    base: './',
    plugins: [copyGameAssets()]
});
