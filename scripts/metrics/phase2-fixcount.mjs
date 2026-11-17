// Пересчёт «чистых» fix-коммитов по форме для гейта GA фазы 2
// (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, 0.4/10.1).
//
// - период: последние 90 дней;
// - коммит считается fix, если тема начинается с `fix(`;
// - история файла — с учётом переименований (`git log --follow`);
// - массовым считается коммит, затрагивающий >= 6 файлов в UI-каталогах
//   (прежних src/scenes/ui/, src/dom/, src/ui/ и новых src/ui/phaser|shared|dom/);
//   массовые исключаются из счёта всех форм;
// - вывод: файл, все коммиты, массовые, чистые коммиты, чистые fix.
//
// Запуск: npm run metrics:fixcount [-- --json]
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAYS = 90;
const MASS_THRESHOLD = 6;
const UI_DIRS = ['src/scenes/ui/', 'src/dom/', 'src/ui/', 'src/ui/phaser/', 'src/ui/shared/', 'src/ui/dom/'];
const FORMS = [
    { id: 'settings', label: 'settings.js (был settingsModal.js)', file: 'src/ui/phaser/settingsModal.js' },
    { id: 'status', label: 'statusModals.js', file: 'src/ui/phaser/statusModals.js' },
    { id: 'list', label: 'upgradesList.js (был panel.js)', file: 'src/ui/phaser/upgrades.js' },
    { id: 'map', label: 'map.js (был mapScreen.js)', file: 'src/ui/phaser/mapScreen.js' },
    { id: 'gear', label: 'gear.js', file: 'src/ui/phaser/gear.js' },
    { id: 'hud', label: 'hud.js', file: 'src/ui/phaser/hud.js' },
    { id: 'tutorial', label: 'tutorial.js', file: 'src/ui/phaser/tutorial.js' }
];

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' });

function uiFilesOf(sha) {
    const names = git(`show --name-only --format= ${sha}`).split('\n').filter(Boolean);

    return names.filter((n) => UI_DIRS.some((d) => n === d.slice(0, -1) || n.startsWith(d))).length;
}

const massCache = new Map();
function isMass(sha) {
    if (!massCache.has(sha)) {
        massCache.set(sha, uiFilesOf(sha) >= MASS_THRESHOLD);
    }

    return massCache.get(sha);
}

const rows = [];
for (const form of FORMS) {
    const raw = git(`log --follow --since=${DAYS}.days --format=%H%x09%s -- ${form.file}`)
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [sha, ...rest] = line.split('\t');

            return { sha, subject: rest.join('\t') };
        });
    const mass = raw.filter((c) => isMass(c.sha));
    const clean = raw.filter((c) => !isMass(c.sha));
    const fixes = clean.filter((c) => c.subject.startsWith('fix('));
    rows.push({
        id: form.id,
        label: form.label,
        file: form.file,
        commits: raw.length,
        mass: mass.length,
        clean: clean.length,
        fixes: fixes.length,
        fixSubjects: fixes.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`)
    });
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ days: DAYS, massThreshold: MASS_THRESHOLD, rows }, null, 2));
} else {
    console.log(`Период: ${DAYS} дней, массовый коммит = >= ${MASS_THRESHOLD} файлов в UI-каталогах\n`);
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('Файл', 42)} ${pad('все', 5)} ${pad('масс', 5)} ${pad('чистые', 7)} чистые fix`);
    for (const r of rows) {
        console.log(`${pad(r.file, 42)} ${pad(r.commits, 5)} ${pad(r.mass, 5)} ${pad(r.clean, 7)} ${r.fixes}`);
        for (const s of r.fixSubjects) {
            console.log(`    ${s}`);
        }
    }
}
