import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Копируем игровые ассеты в dist: Phaser грузит их по относительным путям 'assets/...'.
// Копируем ВСЁ дерево assets/ кроме fonts/ (шрифт обрабатывает сам Vite — хеширует
// и подключает в CSS): новая поддиректория ассетов больше не забудется в сборке.
function copyGameAssets() {
    return {
        name: 'copy-game-assets',
        apply: 'build',
        closeBundle() {
            fs.cpSync(path.join(import.meta.dirname, 'assets'), path.join(import.meta.dirname, 'dist', 'assets'), {
                recursive: true,
                filter: (src) => !src.endsWith(path.join('assets', 'fonts'))
            });
            // GitHub Pages: без .nojekyll Jekyll обрабатывает деплой и может
            // отбросить файлы/замедлить выдачу; статическому сайту он не нужен
            fs.writeFileSync(path.join(import.meta.dirname, 'dist', '.nojekyll'), '');
        }
    };
}

export default defineConfig({
    base: './',
    plugins: [copyGameAssets()]
});
