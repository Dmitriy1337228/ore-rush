// Генератор CSS-токенов DOM-слоя (пилот DOM, этап 1, шаг 1.3).
// Источник значений — src/ui/theme.js (один словарь для Phaser и DOM) + DOM_EXTRA
// ниже (единицы DOM, которых в Phaser нет вовсе).
//
// Запуск:
//   npm run dom:tokens           — перезаписать src/dom/tokens.css
//   npm run dom:tokens -- --check — только проверить дрейф (код 1, если файл устарел)
//
// Правило: src/dom/tokens.css руками не правится; единицы DOM — только var(--...).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT, SPACE, FONT_SIZE, MIN, CARD, HIT } from '../../src/ui/theme.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'src', 'dom', 'tokens.css');

const kebab = (s) =>
    s
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();

// Единицы DOM (CSS px), которых нет в theme.js. Кегли/отступы/пороги — ТОЛЬКО из theme.js.
// Здесь — геометрия DOM-слоя: то, что в Phaser задаётся раскладкой экрана (src/layout.js).
const DOM_EXTRA = [
    // Врезка мастерской: модуль-окно в Phaser 560x600 игровых px (craftScreen buildCraftScreen);
    // DOM берёт 640 — больше ширины под текст (меньше переносов на десктопе)
    ['--dom-panel-w', '640px'],
    ['--dom-panel-h', '660px'],
    // Борта border-image: исходники 9-slice 60/30/40 px (spritecook-assets.json);
    // на экране — тоньше, чтобы врезка 560px не съедала контент
    ['--dom-border-panel', '24px'],
    ['--dom-border-card', '12px'],
    ['--dom-border-btn', '10px'],
    ['--dom-border-slot', '10px'],
    // Ряд мастерской в ландшафте — SP.rowH = 96 игровых px
    ['--dom-row-min-h', '96px'],
    ['--dom-art-min-h', '96px'],
    ['--dom-row-gap', '6px'],
    // Слот иконки: иконка 40 игровых px (SP item iconSize) + борт слота
    ['--dom-slot-size', '64px'],
    ['--dom-icon-size', '40px'],
    // Иконки чипов шапки и пар «Нужно» (в Phaser: pairIcon 16, чипы 22 игровых px)
    ['--dom-chip-icon', '22px'],
    ['--dom-pair-icon', '16px'],
    // Колонки сетки артефактов: 2 в ландшафте; в портрете класс .portrait -> 1
    ['--dom-art-cols', '2'],
    // Слой DOM над канвасом: Phaser-канвас в потоке без z-index, DOM — поверх
    ['--dom-z', '20'],
    // Затемнение под открытым DOM-экраном (Phaser DIM_ALPHA.screen = 0.6)
    ['--dom-dim', '0.6'],
    // Межстрочный интервал Monocraft (в Phaser — ONE_LINE_HEIGHT_FACTOR 1.55,
    // в CSS безразмерная единица допустима)
    ['--dom-line', '1.35'],
    // Шаг вертикального ритма внутри панели: заголовок секции = строка текста
    ['--dom-section-gap', '16px']
];

function build() {
    const lines = [];
    lines.push('/*');
    lines.push(' * СГЕНЕРИРОВАННЫЙ ФАЙЛ — не править руками.');
    lines.push(' * Источник: src/ui/theme.js + DOM_EXTRA в scripts/gen-dom-tokens.mjs.');
    lines.push(' * Перегенерация: npm run dom:tokens. Проверка дрейфа (CI/DoD): npm run dom:tokens -- --check');
    lines.push(' */');
    lines.push(':root {');

    lines.push('    /* Шрифт UI (Phaser: FONT в src/ui/uiKit.js) */');
    lines.push('    --font-ui: "Monocraft", "Inter", "Consolas", monospace;');

    lines.push('');
    lines.push('    /* Цвета текста (TEXT) */');
    for (const [k, v] of Object.entries(TEXT)) {
        lines.push(`    --color-${kebab(k)}: ${v};`);
    }

    lines.push('');
    lines.push('    /* Отступы (SPACE), CSS px */');
    for (const [k, v] of Object.entries(SPACE)) {
        lines.push(`    --space-${kebab(k)}: ${v}px;`);
    }

    lines.push('');
    lines.push('    /* Кегли (FONT_SIZE), CSS px */');
    for (const [k, v] of Object.entries(FONT_SIZE)) {
        lines.push(`    --font-${kebab(k)}: ${v}px;`);
    }

    lines.push('');
    lines.push('    /* Пороги аудита (MIN) */');
    for (const [k, v] of Object.entries(MIN.fontCss)) {
        lines.push(`    --font-min-css-${kebab(k)}: ${v}px;`);
    }

    lines.push(`    --touch-min: ${MIN.touchCss.mobile}px;`);
    lines.push(`    --touch-min-desktop: ${MIN.touchCss.desktop}px;`);
    for (const [k, v] of Object.entries(MIN.padding)) {
        lines.push(`    --pad-min-${kebab(k)}: ${v}px;`);
    }

    lines.push('');
    lines.push('    /* Кадры 9-slice текстур (CARD/HIT), координаты исходника */');
    lines.push(`    --card-frame: ${CARD.frame}px;`);
    lines.push(`    --card-pad: ${CARD.pad}px;`);
    lines.push(`    --hit-button-w: ${HIT.button[0]};`);
    lines.push(`    --hit-button-h: ${HIT.button[1]};`);
    lines.push(`    --hit-close-w: ${HIT.closeSquare[0]};`);
    lines.push(`    --hit-close-h: ${HIT.closeSquare[1]};`);
    lines.push(`    --hit-card-w: ${HIT.rowCard[0]};`);
    lines.push(`    --hit-card-h: ${HIT.rowCard[1]};`);

    lines.push('');
    lines.push('    /* Геометрия DOM-слоя (нет в Phaser-теме; обоснование — DOM_EXTRA в генераторе) */');
    for (const [k, v] of DOM_EXTRA) {
        lines.push(`    ${k}: ${v};`);
    }

    lines.push('}');

    return lines.join('\n') + '\n';
}

const css = build();

if (process.argv.includes('--check')) {
    const prevRaw = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    // Git на Windows может отдать CRLF — сравниваем без учёта перевода строк
    const prev = prevRaw === null ? null : prevRaw.replace(/\r\n/g, '\n');
    if (prev === css) {
        console.log('dom:tokens — ок: src/dom/tokens.css соответствует src/ui/theme.js');
        process.exit(0);
    }

    console.error('dom:tokens — ДРЕЙФ: src/dom/tokens.css устарел. Запустите npm run dom:tokens.');
    if (prev) {
        const a = (prev || '').split('\n');
        const b = css.split('\n');
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if (a[i] !== b[i]) {
                console.error(
                    `  первая разница, строка ${i + 1}:\n    было: ${a[i] ?? '<нет>'}\n    стало: ${b[i] ?? '<нет>'}`
                );
                break;
            }
        }
    }

    process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, css);
console.log(`dom:tokens — записано: ${path.relative(ROOT, OUT)} (${css.split('\n').length - 1} строк)`);
