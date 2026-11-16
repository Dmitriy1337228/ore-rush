// Гейт «нет новых голых чисел» (docs/UI_LAYOUT_TODO.md, раздел 1, п. 3 + системное
// правило AGENTS.md). В src/scenes/ui (кроме файлов раскладок):
//  1) кегли задаются токенами FONT_SIZE (makeLabel(..., N, ...), setFontSize(N));
//  2) отступы/размеры в sizing-вызовах (setPosition/setDisplaySize/setSize/
//     fillRect/fillRoundedRect/strokeRoundedRect/addImg/addImgC/addNine/addNineC/
//     Rectangle/setHitRect/setHitWorld/setHitWorldRect/placeIcon/addButton) —
//     токенами (SPACE.*, FONT_SIZE.*, HIT.*, L.*) либо голым числом С РЯДОМ
//     стоящим комментарием «что это и зачем» (строка литерала или строки вызова
//     содержат `//`). Голый литерал без комментария ломает прогон.
// Файлы раскладок (layout.js) — исключение: там числа — контракт сетки, покрытый
// golden-тестами (tests/characterization/layout.test.mjs).
//
// Запуск: npm run ui:tokens (код 1 — есть нарушения, список в stdout).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/scenes/ui';
const EXCLUDE = new Set(['layout.js']);
// Фазовое внедрение гейта отступов/размеров: скан размеров применяется к файлам
// из WATCHED (мигрированы на токены/спеки, см. docs/UI_LAYOUT_TODO.md раздел 3/5);
// кегли проверяются во всех файлах. WATCHED пополняется пачками миграции.
const WATCHED = new Set(['hud.js', 'gear.js', 'craftScreen.js']);

// Разбор аргументов вызова с учётом вложенности скобок и кавычек/шаблонов:
// возвращает верхнеуровневые аргументы и позицию начала каждого.
function splitCallArgs(src, openIdx) {
    const args = [];
    let depth = 0;
    let quote = null;
    let cur = '';
    let argStart = openIdx + 1;
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
        if (ch === "'" || ch === '"' || ch === '`') {
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
                args.push({ text: cur.trim(), start: argStart });
                return { args, end: i };
            }
            cur += ch;
            continue;
        }
        if (ch === ',' && depth === 1) {
            args.push({ text: cur.trim(), start: argStart });
            cur = '';
            argStart = i + 1;
            continue;
        }
        cur += ch;
    }
    return { args, end: src.length };
}

// Позиции аргументов, проверяемых на голые числа: [имя вызова, [индексы]]
const SIZE_CALLS = [
    ['setPosition(', [0, 1]],
    ['setDisplaySize(', [0, 1]],
    ['setSize(', [0, 1]],
    ['fillRect(', [0, 1, 2, 3]],
    ['fillRoundedRect(', [0, 1, 2, 3, 4]],
    ['strokeRoundedRect(', [0, 1, 2, 3, 4]],
    ['addImg(', [1, 2, 4, 5]],
    ['addImgC(', [1, 2, 4, 5]],
    ['addNine(', [1, 2, 4, 5]],
    ['addNineC(', [1, 2, 4, 5]],
    ['Rectangle(', [0, 1, 2, 3]],
    ['setHitRect(', [1, 2]],
    ['setHitWorldRect(', [1, 2, 3, 4]],
    ['setHitWorld(', [1, 2]],
    ['placeIcon(', [2, 3, 4]],
    ['addButton(', [1, 2]]
];

// Кегль в makeLabel(scene, x, y, text, SIZE, ...) — 5-й аргумент (индекс 4)
function bareMakeLabelSize(src, callIdx) {
    const open = src.indexOf('(', callIdx);
    if (open < 0) return null;
    const { args } = splitCallArgs(src, open);
    const size = (args[4] || {}).text || '';
    return /^\d+$/.test(size) ? size : null;
}

// Кегль в .setFontSize(N) — единственный аргумент
function bareSetFontSize(src, callIdx) {
    const open = src.indexOf('(', callIdx);
    if (open < 0) return null;
    const { args } = splitCallArgs(src, open);
    const size = (args[0] || {}).text || '';
    return /^\d+$/.test(size) ? size : null;
}

// Структурные константы (индексы, флаги) — не «числа с потолка»
function isStructural(n) {
    return n === 0 || n === 1 || n === -1;
}

// Рядом с литералом стоит комментарий? Строки вызова (от строки НАД вызовом —
// комментарий может стоять прямо над стейтментом — до строки литерала
// включительно) содержат `//` — значение задокументировано.
function hasCommentNearby(src, callIdx, argStart) {
    const startLine = src.slice(0, callIdx).split('\n').length - 1;
    const argLine = src.slice(0, argStart).split('\n').length - 1;
    const lines = src.split('\n');
    for (let i = Math.max(0, startLine - 1); i <= argLine && i < lines.length; i++) {
        if (lines[i].includes('//')) return true;
    }
    return false;
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

const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.js') && !EXCLUDE.has(f))
    .sort();
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
    for (const [call, argIdxs] of SIZE_CALLS) {
        if (!WATCHED.has(file)) continue;
        for (const idx of findCalls(src, call)) {
            const open = src.indexOf('(', idx);
            if (open < 0) continue;
            const { args } = splitCallArgs(src, open);
            for (const ai of argIdxs) {
                const arg = args[ai];
                if (!arg) continue;
                if (!/^-?\d+$/.test(arg.text)) continue;
                if (isStructural(parseInt(arg.text, 10))) continue;
                if (hasCommentNearby(src, idx, arg.start)) continue;
                violations.push(
                    `${path}:${lineAt(idx)}: ${call.replace('(', '')} ${arg.text} — токен (SPACE.*, L.*) или комментарий «что это и зачем»`
                );
            }
        }
    }
}

if (violations.length) {
    console.error(
        `ui:tokens — голые кегли/отступы в ${DIR} (${violations.length}); токены (FONT_SIZE.*, SPACE.*, L.*) или комментарий «что это и зачем»:`
    );
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
}
console.log(`ui:tokens — ок: голых кеглей/отступов в ${DIR} нет (исключения: ${[...EXCLUDE].join(', ') || '—'}).`);
