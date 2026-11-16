// Пилот DOM (этап 0.4 / 6.1): метрика «экран целиком» — строки кода экрана.
// Считает по явному списку файлов (не эвристикой), чтобы baseline и DOM-версия
// мерились одинаково. Что входит — см. docs/UI_DOM_PILOT_BASELINE.md.
//
// Строки кода = непустые строки без чисто-комментарных (//, /*, *, <!--, CSS /* ) строк.
// Общие модули (uiKit/theme/panel/button/stack, uiAudit, ui-matrix, golden ui-review)
// НЕ входят: они общие для всех экранов и одинаковы для обоих стеков.
//
// Запуск: node scripts/metrics/pilot-loc.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const BASELINE_FILES = [
    // экран мастерской целиком (вёрстка + хендлеры + анимации + скролл)
    'src/scenes/ui/craftScreen.js',
    // специфичные тесты экрана (S1–S9 Phaser-версии)
    'scripts/verify-craft.cjs'
];

// DOM-версия: заполняется по мере этапов 1–5. Отсутствующие пути = 0 строк.
const DOM_PATHS = [
    'src/dom', // слой: root, bridge, компоненты, экран, CSS
    'scripts/gates/gen-dom-tokens.mjs', // генератор токенов (часть слоя)
    'src/dom/tokens.css', // сгенерированные токены
    'scripts/verify/verify-craft-dom.mjs' // специфичные тесты экрана (S1–S10)
];

// Инфраструктура проверок DOM-экрана (DoD этапа 5): аудит + CSS-гейт + golden-обвязка.
const CHECK_PATHS = [
    'scripts/gates/ui-check-dom.mjs',
    'scripts/gates/ui-tokens-css.mjs',
    'scripts/gates/dom-golden.mjs'
];

const COMMENT = [
    /^\s*\/\//, // // js
    /^\s*\/\*/, // /* ...
    /^\s*\*/, // * ... (продолжение блочного комментария)
    /^\s*<!--/, // <!-- html
    /^\s*\/>/, // хвост jsx-комментария (на будущее)
    /^\s*\}\s*$/, // не считаем пустые закрывашки шаблонов
    /^\s*```/ // markdown-заборы в шаблонах
];

function walk(target, acc) {
    const abs = path.join(ROOT, target);
    if (!fs.existsSync(abs)) {
        return acc;
    }

    const st = fs.statSync(abs);
    if (st.isDirectory()) {
        for (const entry of fs.readdirSync(abs).sort()) {
            walk(path.join(target, entry), acc);
        }

        return acc;
    }

    acc.push(target);

    return acc;
}

function measure(files) {
    let total = 0;
    let code = 0;
    let blank = 0;
    let comments = 0;
    const perFile = [];
    for (const rel of files) {
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) {
            continue;
        }

        const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
        let t = 0,
            c = 0,
            b = 0,
            m = 0;
        for (const line of lines) {
            if (line.trim() === '') {
                b++;
                continue;
            }

            t++;
            if (COMMENT.some((re) => re.test(line))) {
                m++;
                continue;
            }

            c++;
        }

        total += t;
        code += c;
        blank += b;
        comments += m;
        perFile.push({ file: rel, total: t, code: c, blank: b, comments: m });
    }

    return { total, code, blank, comments, perFile };
}

const baselineFiles = BASELINE_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)));
// Стенды/тулинг пилота не входят в «экран целиком»: это не код экрана, а разовые
// инструменты (автономные HTML-снимки, фикстуры этапа 1).
const SKIP_FILES = new Set(['fixtures.js', 'fixtureMarkup.js', 'fixtureApp.js', 'lab.js']);
const SKIP_SCRIPTS = [/^scripts[\\/]build-dom-.*\.mjs$/];
const domFiles = [];
for (const p of DOM_PATHS) {
    walk(p, domFiles);
}

// Windows: walk() отдаёт пути с '\', явный список — с '/'; приводим к одному виду.
const domUnique = Array.from(new Set(domFiles.map((f) => f.replace(/\\/g, '/'))))
    .filter((f) => !SKIP_FILES.has(path.basename(f)))
    .filter((f) => !SKIP_SCRIPTS.some((re) => re.test(f)));

const baseline = measure(baselineFiles);
const dom = measure(domUnique);
const checkFiles = [];
for (const p of CHECK_PATHS) {
    walk(p, checkFiles);
}

const checks = measure(Array.from(new Set(checkFiles.map((f) => f.replace(/\\/g, '/')))));

const json = {
    createdAt: new Date().toISOString(),
    method: 'code = непустые строки без чисто-комментарных',
    baseline: { files: baselineFiles, ...baseline },
    dom: { files: domUnique, ...dom },
    checks: { files: checkFiles, ...checks }
};

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(json, null, 2));
} else {
    const row = (label, m) => `| ${label} | ${m.code} | ${m.total} | ${m.perFile.length} |`;
    console.log('Метрика «экран целиком» (строки кода, без комментариев и пустых)\n');
    console.log('| Группа | строк кода | строк всего | файлов |');
    console.log('|---|---|---|---|');
    console.log(row('Phaser (baseline)', baseline));
    console.log(row('DOM (пилот)', dom));
    console.log(row('Проверки DOM (аудит+CSS-гейт+golden)', checks));
    for (const [label, m] of [
        ['Phaser (baseline)', baseline],
        ['DOM (пилот)', dom],
        ['Проверки DOM', checks]
    ]) {
        if (!m.perFile.length) {
            continue;
        }

        console.log(`\n${label}:`);
        for (const f of m.perFile) {
            console.log(`  ${String(f.code).padStart(5)}  ${f.file}`);
        }
    }

    const missing = DOM_PATHS.filter((p) => !fs.existsSync(path.join(ROOT, p)));
    if (missing.length) {
        console.log(`\nещё не создано (0 строк): ${missing.join(', ')}`);
    }
}
