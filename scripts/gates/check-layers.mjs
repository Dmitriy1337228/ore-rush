// Гард слоёв (docs/repo-reorg/REPO_REFACTOR_PLAN.md, этап 4.3): правила изоляции ui/dom, ui/phaser,
// ui/shared и game. Запуск: npm run layers:check (код 1 — нарушения, список в stdout).
// Селф-тест: node scripts/gates/check-layers.mjs --self-test — строит заведомо плохое
// дерево во временном каталоге и обязан вернуть код 1.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SPEC = /(?:from\s+|import\(\s*|require\(\s*)'([^']+)'/g;

function toPosix(p) {
    return p.split(sep).join('/');
}

function walk(dir, out = []) {
    if (!existsSync(dir)) {
        return out;
    }

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
            continue;
        }

        if (/\.(js|mjs|cjs)$/.test(entry.name)) {
            out.push(full);
        }
    }

    return out;
}

function importsOf(file) {
    const src = readFileSync(file, 'utf8');
    const out = [];
    for (const m of src.matchAll(SPEC)) {
        out.push(m[1]);
    }

    return out;
}

function resolveSpec(root, fromFile, spec) {
    if (!spec.startsWith('.')) {
        return spec;
    }

    const [clean] = spec.split(/[?#]/);

    return toPosix(relative(root, resolve(dirname(fromFile), clean)));
}

function scan(root) {
    const violations = [];
    const rel = (p) => toPosix(relative(root, p));
    const inLayer = (spec, layer) => spec === layer || spec.startsWith(`${layer}/`);
    const groups = [
        { dir: 'src/ui/dom', forbid: ['phaser', 'src/ui/phaser'], label: 'ui/dom' },
        { dir: 'src/ui/phaser', forbid: ['src/ui/dom'], label: 'ui/phaser' },
        { dir: 'src/ui/shared', forbid: ['phaser', 'src/ui/phaser', 'src/ui/dom'], label: 'ui/shared' },
        { dir: 'src/game', forbid: ['src/ui/dom'], label: 'game' }
    ];
    for (const group of groups) {
        for (const file of walk(join(root, group.dir))) {
            for (const spec of importsOf(file)) {
                const target = resolveSpec(root, file, spec);
                for (const bad of group.forbid) {
                    if (target === bad || inLayer(target, bad)) {
                        violations.push(`${rel(file)}: ${group.label} импортирует ${target} (${spec})`);
                    }
                }
            }
        }
    }

    for (const legacy of ['src/dom', 'src/scenes/ui', 'src/scenes/game']) {
        if (existsSync(join(root, legacy))) {
            violations.push(`${legacy}/ существует — слой не перенесён`);
        }
    }

    for (const file of walk(join(root, 'src'))) {
        const relFile = rel(file);
        if (relFile.startsWith('src/ui/dom/dev/')) {
            continue;
        }

        for (const spec of importsOf(file)) {
            const target = resolveSpec(root, file, spec);
            if (target.startsWith('src/ui/dom/dev/')) {
                violations.push(`${relFile}: прод-код импортирует dev-модуль ${target}`);
            }
        }
    }

    return violations;
}

function selfTest() {
    const root = mkdtempSync(join(tmpdir(), 'layers-check-'));
    try {
        mkdirSync(join(root, 'src', 'ui', 'dom'), { recursive: true });
        writeFileSync(
            join(root, 'src', 'ui', 'dom', 'bad.js'),
            "import Phaser from 'phaser';\nexport const x = Phaser;\n"
        );
        const found = scan(root);
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

const violations = scan(SELF_ROOT);
if (violations.length) {
    console.error(`layers:check — нарушений ${violations.length}:`);
    for (const v of violations) {
        console.error(`  ${v}`);
    }

    process.exit(1);
}

console.log('layers:check — ок: слои ui/dom, ui/phaser, ui/shared и game изолированы.');
