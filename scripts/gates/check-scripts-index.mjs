// Гард индекса скриптов (docs/repo-reorg/REPO_REFACTOR_PLAN.md, D8):
//  (а) каждый файл scripts/**/* (кроме lib/, archive/ и README.md) имеет npm-алиас;
//  (б) каждый такой файл упомянут строкой в scripts/README.md;
//  (в) каждый npm-алиас, ссылающийся на scripts/**, указывает на существующий файл.
// Запуск: npm run scripts:check  (код 1 — нарушения, список в stdout).
// Селф-тест: node scripts/check-scripts-index.mjs --self-test — строит заведомо
// плохое дерево во временном каталоге и обязан вернуть код 1.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP_DIRS = new Set(['lib', 'archive']);
const PATH_IN_ALIAS = /scripts\/[\w./-]+/g;

function toPosix(p) {
    return p.split(sep).join('/');
}

function walkScripts(root, dir = join(root, 'scripts')) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
                continue;
            }

            out.push(...walkScripts(root, join(dir, entry.name)));
            continue;
        }

        if (entry.name === 'README.md') {
            continue;
        }

        out.push(toPosix(relative(root, join(dir, entry.name))));
    }

    return out.sort();
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function aliasTargets(root, scripts) {
    const targets = [];
    for (const [name, command] of Object.entries(scripts)) {
        for (const raw of String(command).match(PATH_IN_ALIAS) || []) {
            targets.push({ name, path: raw, abs: join(root, raw) });
        }
    }

    return targets;
}

function validate(root) {
    const violations = [];
    const pkgPath = join(root, 'package.json');
    const readmePath = join(root, 'scripts', 'README.md');
    if (!existsSync(pkgPath)) {
        return ['package.json не найден'];
    }

    const pkg = readJson(pkgPath);
    const scripts = pkg.scripts || {};
    const targets = aliasTargets(root, scripts);
    const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
    const files = walkScripts(root);
    for (const file of files) {
        const own = targets.filter((t) => t.path === file);
        if (!own.length) {
            violations.push(`${file}: нет npm-алиаса`);
        }

        if (!readme.includes(file)) {
            violations.push(`${file}: нет строки в scripts/README.md`);
        }
    }

    for (const target of targets) {
        if (!existsSync(join(root, target.path))) {
            violations.push(`алиас "${target.name}" указывает на несуществующий ${target.path}`);
        }
    }

    return violations;
}

function selfTest() {
    const root = mkdtempSync(join(tmpdir(), 'scripts-check-'));
    try {
        mkdirSync(join(root, 'scripts'), { recursive: true });
        writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'bad:alias': 'node scripts/foo.mjs' } }));
        writeFileSync(join(root, 'scripts', 'foo.mjs'), '// fixture\n');
        writeFileSync(join(root, 'scripts', 'README.md'), '# нет строки про foo\n');
        const found = validate(root);
        if (!found.length) {
            console.error('self-test: детектор НЕ сработал на плохом дереве');

            return 0;
        }

        console.log(`self-test: детектор сработал (${found.length} нарушений) — ок`);
        for (const v of found) {
            console.log(`  ${v}`);
        }

        return 1;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
}

const violations = validate(SELF_ROOT);
if (violations.length) {
    console.error(`scripts:check — нарушений ${violations.length}:`);
    for (const v of violations) {
        console.error(`  ${v}`);
    }

    process.exit(1);
}

console.log('scripts:check — ок: у каждого скрипта есть алиас и строка в scripts/README.md.');
