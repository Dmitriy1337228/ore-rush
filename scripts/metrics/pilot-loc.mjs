// Метрика «экран целиком» по форме (пилот DOM, этап 0.4; фаза 2 — шаг 1.4).
// Считает по явному списку файлов (не эвристикой), чтобы baseline и DOM-версия
// мерились одинаково. Общие модули (theme/uiKit/panel/button/stack, uiAudit,
// ui-matrix, golden-обвязка ui-review) НЕ входят: они одинаковы для обоих стеков.
//
// Строки кода = непустые строки без чисто-комментарных (//, /*, *, <!--, CSS /* ) строк.
//
// Запуск: npm run metrics:loc [-- --form craft|settings|status|upgrades] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { FORMS } from '../lib/dom-forms.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const optIdx = argv.indexOf('--form');
const FORM_ID = optIdx >= 0 && argv[optIdx + 1] && !argv[optIdx + 1].startsWith('--') ? argv[optIdx + 1] : 'craft';

// Списки файлов формы: baseline — Phaser-реализация (для settings/status живая),
// dom — DOM-реализация и специфичные тесты, checks — обвязка гейтов формы.
const SETS = {
    craft: {
        baseline: [], // Phaser-экран мастерской удалён вместе с пилотом (G3 = go)
        dom: [
            'src/ui/dom/craft.js',
            'src/ui/dom/bridge.js',
            'src/ui/dom/components.js',
            'src/ui/dom/html.js',
            'src/ui/dom/root.js',
            'src/ui/dom/iconFit.js',
            'src/ui/dom/dom.css',
            'src/ui/dom/tokens.css',
            'scripts/verify/verify-craft-dom.mjs'
        ],
        checks: ['scripts/gates/ui-check-dom.mjs', 'scripts/gates/ui-tokens-css.mjs', 'scripts/gates/dom-golden.mjs']
    },
    settings: {
        baseline: ['src/ui/phaser/settingsModal.js'],
        dom: [
            'src/ui/dom/settingsScreen.js',
            'src/ui/dom/modal.js',
            'src/ui/dom/lock.js',
            'src/state/settings.js',
            'src/state/settingsMessages.js',
            'scripts/verify/verify-settings-dom.mjs'
        ],
        checks: ['scripts/gates/ui-check-dom.mjs', 'scripts/gates/dom-golden.mjs']
    },
    status: {
        baseline: ['src/ui/phaser/statusModals.js'],
        dom: [
            'src/ui/dom/statusModals.js',
            'src/ui/dom/modal.js',
            'src/state/statusMessages.js',
            'scripts/verify/verify-status-dom.mjs'
        ],
        checks: ['scripts/gates/ui-check-dom.mjs', 'scripts/gates/dom-golden.mjs']
    },
    upgrades: {
        // Baseline фазы 3: список + боевая панель снаряжения (W1 сравнивает только
        // upgrades.js; gear.js в baseline-доке как справка — Q2 выводит его из M3).
        baseline: ['src/ui/phaser/upgrades.js', 'src/ui/phaser/gear.js'],
        dom: ['src/ui/dom/upgradesPanel.js', 'src/state/upgradesMessages.js', 'scripts/verify/verify-upgrades-dom.mjs'],
        checks: ['scripts/gates/ui-check-dom.mjs', 'scripts/gates/dom-golden.mjs']
    }
};

if (!SETS[FORM_ID]) {
    console.error(`metrics:loc: неизвестная форма "${FORM_ID}" (есть: craft, settings, status, upgrades)`);
    process.exit(2);
}

const form = FORMS.find((f) => f.id === FORM_ID);
const set = SETS[FORM_ID];

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

const expand = (list) => {
    const out = [];
    for (const p of list) {
        walk(p, out);
    }

    return Array.from(new Set(out.map((f) => f.replace(/\\/g, '/'))));
};

// Стенды/фикстуры и разовые тулинг-скрипты не входят в «экран целиком».
const SKIP_FILES = new Set(['fixtures.js', 'fixtureMarkup.js', 'fixtureApp.js', 'lab.js']);
const SKIP_SCRIPTS = [/^scripts[\\/]stands[\\/]build-dom-.*\.mjs$/];

const baselineFiles = set.baseline.filter((f) => fs.existsSync(path.join(ROOT, f)));
const domFiles = expand(set.dom).filter(
    (f) => !SKIP_FILES.has(path.basename(f)) && !SKIP_SCRIPTS.some((re) => re.test(f))
);
const checkFiles = expand(set.checks);

const baseline = measure(baselineFiles);
const dom = measure(domFiles);
const checks = measure(checkFiles);

const json = {
    createdAt: new Date().toISOString(),
    form: FORM_ID,
    method: 'code = непустые строки без чисто-комментарных',
    baseline: { files: baselineFiles, ...baseline },
    dom: { files: domFiles, ...dom },
    checks: { files: checkFiles, ...checks }
};

if (argv.includes('--json')) {
    console.log(JSON.stringify(json, null, 2));
} else {
    const row = (label, m) => `| ${label} | ${m.code} | ${m.total} | ${m.perFile.length} |`;
    console.log(`Метрика «экран целиком» — форма ${FORM_ID} (${form ? form.label : '?'})\n`);
    console.log('| Группа | строк кода | строк всего | файлов |');
    console.log('|---|---|---|---|');
    console.log(row('Phaser (baseline)', baseline));
    console.log(row('DOM', dom));
    console.log(row('Проверки формы (аудит + golden)', checks));
    for (const [label, m] of [
        ['Phaser (baseline)', baseline],
        ['DOM', dom],
        ['Проверки формы', checks]
    ]) {
        if (!m.perFile.length) {
            continue;
        }

        console.log(`\n${label}:`);
        for (const f of m.perFile) {
            console.log(`  ${String(f.code).padStart(5)}  ${f.file}`);
        }
    }

    const missing = [...set.baseline, ...set.dom].filter((p) => !fs.existsSync(path.join(ROOT, p)));
    if (missing.length) {
        console.log(`\nещё не создано (0 строк): ${missing.join(', ')}`);
    }

    if (FORM_ID === 'craft' && !baselineFiles.length) {
        console.log('\nPhaser-экран мастерской удалён (пилот DOM, G3 = go): baseline-число историческое,');
        console.log('см. docs/dom-pilot/UI_DOM_PILOT_BASELINE.md (1138 строк кода).');
    }
}
