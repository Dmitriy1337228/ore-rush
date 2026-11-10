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
            fs.cpSync(path.join(import.meta.dirname, 'assets', 'ui'), path.join(import.meta.dirname, 'dist', 'assets', 'ui'), { recursive: true });
        }
    };
}

export default defineConfig({
    base: './',
    plugins: [copyGameAssets()]
});
