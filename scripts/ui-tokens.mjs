// Гейт «нет новых голых кеглей» (docs/UI_LAYOUT_TODO.md, раздел 1, п. 3).
// В src/scenes/ui (кроме файлов раскладок) кегли задаются токенами FONT_SIZE
// из src/ui/theme.js. Голый числовой литерал в makeLabel(..., N, ...) или
// setFontSize(N) ломает прогон: новые числа не должны плодиться, существующие
// уже мигрированы. Файлы раскладок (layout.js) — исключение: там числа — контракт
// сетки, покрытый golden-тестами (tests/characterization/layout.test.mjs).
//
// Запуск: npm run ui:tokens (код 1 — есть нарушения, список в stdout).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/scenes/ui';
const EXCLUDE = new Set(['layout.js']);

// Разбор аргументов вызова с учётом вложенности скобок и кавычек/шаблонов:
// возвращает верхнеуровневые аргументы между openIdx '(' и закрывающей ')'.
function splitCallArgs(src, openIdx) {
    const args = [];
    let depth = 0;
    let quote = null;
    let cur = '';
    for (let i = openIdx; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            cur += ch;
            if (ch === '\\') {
                cur += src[i + 1] || '';
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            cur += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            if (depth > 1) cur += ch;
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            if (depth === 0 && ch === ')') {
                args.push(cur.trim());
                return { args, end: i };
            }
            cur += ch;
            continue;
        }
        if (ch === ',' && depth === 1) {
            args.push(cur.trim());
            cur = '';
            continue;
        }
        cur += ch;
    }
    return { args, end: src.length };
}

// Кегль в makeLabel(scene, x, y, text, SIZE, ...) — 5-й аргумент (индекс 4)
function bareMakeLabelSize(src, callIdx) {
    const open = src.indexOf('(', callIdx);
    if (open < 0) return null;
    const { args } = splitCallArgs(src, open);
    const size = args[4] || '';
    return /^\d+$/.test(size) ? size : null;
}

// Кегль в .setFontSize(N) — единственный аргумент
function bareSetFontSize(src, callIdx) {
    const open = src.indexOf('(', callIdx);
    if (open < 0) return null;
    const { args } = splitCallArgs(src, open);
    const size = args[0] || '';
    return /^\d+$/.test(size) ? size : null;
}

function findCalls(src, name) {
    const out = [];
    let idx = src.indexOf(name);
    while (idx >= 0) {
        out.push(idx);
        idx = src.indexOf(name, idx + name.length);
    }
    return out;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && !EXCLUDE.has(f)).sort();
const violations = [];
for (const file of files) {
    const path = join(DIR, file);
    const src = readFileSync(path, 'utf8');
    const lineAt = (pos) => src.slice(0, pos).split('\n').length;
    for (const idx of findCalls(src, 'makeLabel(')) {
        const size = bareMakeLabelSize(src, idx);
        if (size !== null) violations.push(`${path}:${lineAt(idx)}: makeLabel(..., ${size}, ...)`);
    }
    for (const idx of findCalls(src, '.setFontSize(')) {
        const size = bareSetFontSize(src, idx);
        if (size !== null) violations.push(`${path}:${lineAt(idx)}: setFontSize(${size})`);
    }
}

if (violations.length) {
    console.error(`ui:tokens — голые кегли в ${DIR} (${violations.length}); замените на FONT_SIZE.* из src/ui/theme.js:`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log(`ui:tokens — ок: голых кеглей в ${DIR} нет (исключения: ${[...EXCLUDE].join(', ') || '—'}).`);
