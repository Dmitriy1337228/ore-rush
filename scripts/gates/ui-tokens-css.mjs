// CSS-гейт токенов DOM-слоя (этап 5, шаг 5.2).
// Запрещает голые числовые литералы размеров (px/rem/em) в sizing-свойствах вне
// src/dom/tokens.css. Исключения: 0, 100%, auto; 1px — только со стоящим рядом
// комментарием-причиной. Размеры DOM берутся из var(--space-*/--font-*/...).
//
// Запуск: node scripts/ui-tokens-css.mjs [файлы...]  (по умолчанию — src/dom/*.css)
// Селф-тест: node scripts/ui-tokens-css.mjs --self-test (заведомо плохой CSS → код 1)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['tokens.css']); // сгенерированные токены — единственный источник чисел
const SIZE_PROPS = new Set([
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'gap',
    'row-gap',
    'column-gap',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'font-size',
    'top',
    'left',
    'right',
    'bottom',
    'inset',
    'border-width',
    'border-radius',
    'outline-width',
    'letter-spacing'
]);
const LITERAL = /(?<![\w.-])-?\d*\.?\d+(px|rem|em)\b/g;
const ZERO = /^-?0(\.0+)?(px|rem|em)?$/i;

function checkFile(rel, text) {
    const problems = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
        const noComment = line.replace(/\/\*.*?\*\//g, '');
        const hasReason = /\/\*\s*\S+.*\*\//.test(line);
        const decls = noComment.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g);
        for (const decl of decls) {
            const prop = decl[1].toLowerCase();
            if (!SIZE_PROPS.has(prop)) {
                continue;
            }

            for (const lit of decl[2].matchAll(LITERAL)) {
                const value = lit[0];
                if (ZERO.test(value)) {
                    continue;
                }

                if (value === '1px' && hasReason) {
                    continue;
                }

                problems.push({ file: rel, line: i + 1, prop, value: value.trim(), text: line.trim() });
            }
        }
    });

    return problems;
}

function run(files) {
    const all = [];
    for (const rel of files) {
        const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
        if (!fs.existsSync(abs)) {
            all.push({ file: rel, line: 0, prop: '-', value: '-', text: 'файл не найден' });
            continue;
        }

        all.push(...checkFile(path.relative(ROOT, abs).replace(/\\/g, '/'), fs.readFileSync(abs, 'utf8')));
    }

    return all;
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
    const bad = [
        '.x {',
        '    padding: 12px;', // нарушение
        '    gap: var(--space-sm);', // ок
        '    border: 1px solid transparent; /* 1px — рамка токена */',
        '    width: 100%;',
        '    top: 0;',
        '    font-size: 1.5rem;', // нарушение (rem)
        '}'
    ].join('\n');
    const found = checkFile('self-test.css', bad);
    const ok = found.length === 2 && found[0].prop === 'padding' && found[1].prop === 'font-size';
    console.log(ok ? 'self-test: ок (2 нарушения найдены)' : `self-test: ПРОВАЛ (${found.length})`);
    process.exitCode = ok ? 0 : 1;
} else {
    const files = argv.filter((a) => !a.startsWith('--'));
    let list = files;
    if (!list.length) {
        const dir = path.join(ROOT, 'src', 'dom');
        list = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.css') && !SKIP.has(f))
            .map((f) => path.join('src/dom', f));
    }

    const problems = run(list);
    if (!problems.length) {
        console.log(`ui:tokens:css — ок: голых размеров вне tokens.css нет (${list.length} файл(ов))`);
        process.exitCode = 0;
    } else {
        console.error(`ui:tokens:css — нарушений: ${problems.length}`);
        for (const p of problems.slice(0, 40)) {
            console.error(`  ${p.file}:${p.line}  ${p.prop}: ${p.value}  →  ${p.text}`);
        }

        console.error(
            'Размер — через var(--space-*/--font-*/--dom-*) из tokens.css; 1px только с комментарием-причиной.'
        );
        process.exitCode = 1;
    }
}
