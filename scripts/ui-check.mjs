// UI layout check: матрица вьюпортов x состояний + измеряемый аудит вёрстки
// (src/dev/uiAudit.js) + размеченные скриншоты + baseline «известного долга».
//
// Запуск:
//   npm run ui:check                      — полная матрица (9 вьюпортов x все состояния)
//   npm run ui:check -- --quick           — быстрый прогон (3 вьюпорта)
//   npm run ui:check -- --viewports p390,d1280 --states settings,map
//   npm run ui:check -- --replay <ui-report-*.json>   — воспроизвести репорт из игры (F9)
//   npm run ui:check -- --update-baseline — принять текущие нарушения как известный долг (замена)
//   npm run ui:check -- --merge-baseline  — то же, но слияние по максимуму с текущим baseline
//   npm run ui:check -- --strict          — новые предупреждения (warn) тоже валят прогон
//   npm run ui:check -- --no-baseline     — игнорировать baseline: любая ошибка валит прогон
//
// Результат: shots/ui-check/<viewport>__<state>.png (размеченный скриншот),
// report.json, report.md. Нумерация рамок на PNG = номера нарушений в report.json.
// Код выхода 1 — есть НОВЫЕ ошибки (сверх baseline) или console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { VIEWPORTS, STATES, SEEDS, SAVE_KEY, applyScreens } from './lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

// ---------- Аргументы ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const OUT = path.resolve(opt('out', 'shots/ui-check'));
const BASELINE_PATH = path.resolve('tests/ui-check/baseline.json');
const CONCURRENCY = Number(opt('jobs', 3));
const STRICT = flag('strict');
const USE_BASELINE = !flag('no-baseline');
const LIST_LIMIT = Number(opt('list', 50));

fs.mkdirSync(OUT, { recursive: true });
const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();

// ---------- Baseline ----------
const baseline = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    : { version: 1, combos: {} };

function countSigs(violations) {
    const counts = {};
    for (const v of violations) counts[v.sig] = (counts[v.sig] || 0) + 1;
    return counts;
}

// Какие нарушения «известный долг»: первые N экземпляров каждой сигнатуры, где N — из baseline
function classify(comboKey, violations) {
    const allowed = USE_BASELINE ? { ...(baseline.combos[comboKey] || {}) } : {};
    return violations.map((v) => {
        if (allowed[v.sig] > 0) { allowed[v.sig] -= 1; return { ...v, known: true }; }
        return { ...v, known: false };
    });
}

// ---------- Один прогон ----------
async function openPage({ viewport, seed, extraStorage = {}, name }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    const storage = { ...extraStorage };
    if (seed) storage[SAVE_KEY] = JSON.stringify(seed);
    await page.addInitScript((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, storage);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => {
        const g = window.__GAME;
        const ui = g && g.scene.getScene('UIScene');
        return !!(ui && ui.L && window.__uiAudit && document.fonts.status === 'loaded');
    }, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    return { ctx, page, errors, name };
}

// Состояние игры «живое» (доход растёт, ряды открываются, твины доигрывают): замораживаем
// таймеры экономики и ждём, пока набор нарушений перестанет меняться между замерами.
async function settle(page) {
    await page.evaluate(() => { window.__GAME.scene.getScene('GameScene').time.paused = true; });
    let prev = null;
    let audit = null;
    let stable = 0;
    for (let i = 0; i < 16 && stable < 3; i++) {
        await page.waitForTimeout(300);
        audit = await page.evaluate(() => window.__uiAudit());
        const key = audit.violations.map((v) => v.sig).sort().join('\n') + `|${audit.counts.items}`;
        stable = key === prev ? stable + 1 : 0;
        prev = key;
    }
    return audit;
}

async function auditAndShoot(page, file, comboKey) {
    const audit = await settle(page);
    const violations = classify(comboKey, audit.violations);
    const knownIdx = violations.map((v, i) => (v.known ? i : -1)).filter((i) => i >= 0);
    await page.evaluate(({ v, known }) => window.__uiOverlay.show(window.__GAME, v, new Set(known)), { v: violations, known: knownIdx });
    await page.screenshot({ path: file });
    await page.evaluate(() => window.__uiOverlay.hide());
    return { audit, violations };
}

async function runCombo(vp, state) {
    const comboKey = `${vp.id}|${state.id}`;
    const extra = {};
    if (state.offlineHours) {
        const exit = Date.now() - state.offlineHours * 3600 * 1000;
        extra['ore-rush-lastExit'] = String(exit);
        extra.mockStats = JSON.stringify({ lastExit: exit });
    }
    const errors = [];
    let ctx = null;
    try {
        const opened = await openPage({ viewport: { width: vp.width, height: vp.height }, seed: state.seed, extraStorage: extra, name: comboKey });
        ctx = opened.ctx;
        errors.push(...opened.errors);
        opened.errors = errors;
        await state.setup(opened.page);
        const file = path.join(OUT, `${vp.id}__${state.id}.png`);
        const { audit, violations } = await auditAndShoot(opened.page, file, comboKey);
        return { comboKey, vp: vp.id, state: state.id, file: path.relative(process.cwd(), file), audit, violations, errors };
    } catch (e) {
        return { comboKey, vp: vp.id, state: state.id, failure: String((e && e.message) || e).split('\n')[0], violations: [], errors };
    } finally {
        if (ctx) await ctx.close();
    }
}
// ---------- Replay ----------
if (opt('replay')) {
    const rep = JSON.parse(fs.readFileSync(path.resolve(opt('replay')), 'utf8'));
    const { ctx, page, errors } = await openPage({
        viewport: { width: rep.viewport.w, height: rep.viewport.h },
        seed: rep.gameState,
        name: 'replay'
    });
    await applyScreens(page, rep.screens, rep.listScroll);
    const file = path.join(OUT, 'replay.png');
    const { audit, violations } = await auditAndShoot(page, file, 'replay');
    fs.writeFileSync(path.join(OUT, 'replay.json'), JSON.stringify({ ...audit, violations }, null, 2));
    console.log(`replay: ${rep.viewport.w}x${rep.viewport.h}, экраны [${rep.screens.join(', ')}] -> ${path.relative(process.cwd(), file)}`);
    printViolations(violations, 'replay');
    console.log(`в репорте было: ошибок ${rep.counts.error}, предупреждений ${rep.counts.warn}; сейчас: ошибок ${audit.counts.error}, предупреждений ${audit.counts.warn}`);
    if (errors.length) errors.forEach((e) => console.log('  console: ' + e));
    await ctx.close();
    await browser.close();
    process.exit(audit.counts.error > 0 ? 1 : 0);
}

// ---------- Печать ----------
function printViolations(violations, label, limit = LIST_LIMIT) {
    violations.slice(0, limit).forEach((v, i) => {
        console.log(`  #${i + 1} ${v.severity === 'error' ? 'ERR ' : 'warn'} ${v.known ? '(долг) ' : ''}${v.rule}: ${v.msg}`);
    });
    if (violations.length > limit) console.log(`  ... ещё ${violations.length - limit} (см. ${label})`);
}

// ---------- Матрица ----------
const vpFilter = opt('viewports') ? opt('viewports').split(',') : null;
const stFilter = opt('states') ? opt('states').split(',') : null;
let viewports = VIEWPORTS.filter((v) => (vpFilter ? vpFilter.includes(v.id) : (flag('quick') ? v.quick : true)));
const states = STATES.filter((s) => (stFilter ? stFilter.includes(s.id) : true));
if (!viewports.length || !states.length) {
    console.error('Пустая матрица. Вьюпорты:', VIEWPORTS.map((v) => v.id).join(', '), '| состояния:', STATES.map((s) => s.id).join(', '));
    await browser.close();
    process.exit(2);
}

const jobs = [];
for (const vp of viewports) for (const st of states) jobs.push({ vp, st });
console.log(`ui:check: ${viewports.length} вьюпортов x ${states.length} состояний = ${jobs.length} прогонов, параллельно ${CONCURRENCY}`);

const results = [];
let cursor = 0;
async function worker() {
    while (cursor < jobs.length) {
        const job = jobs[cursor++];
        const r = await runCombo(job.vp, job.st);
        results.push(r);
        const n = r.violations;
        const newErr = n.filter((v) => !v.known && v.severity === 'error').length;
        const newWarn = n.filter((v) => !v.known && v.severity === 'warn').length;
        const mark = r.failure ? 'FAIL' : (newErr ? 'ERR ' : (newWarn ? 'warn' : 'ok  '));
        console.log(`[${String(results.length).padStart(3)}/${jobs.length}] ${mark} ${r.vp.padEnd(6)} ${r.state.padEnd(16)} новых: ${newErr} err, ${newWarn} warn; долг: ${n.filter((v) => v.known).length}${r.failure ? ' — ' + r.failure : ''}`);
    }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
results.sort((a, b) => a.comboKey.localeCompare(b.comboKey));

// ---------- Baseline update ----------
if (flag('update-baseline') || flag('merge-baseline')) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    for (const r of results) {
        if (r.failure) continue;
        const counts = countSigs(r.violations);
        if (flag('merge-baseline')) {
            // слияние по максимуму: сглаживает «мерцающие» нарушения (набор видимых рядов списка
            // чуть плавает между прогонами) — прогоните 2-3 раза подряд
            const prev = baseline.combos[r.comboKey] || {};
            for (const [sig, n] of Object.entries(prev)) counts[sig] = Math.max(counts[sig] || 0, n);
        }
        baseline.combos[r.comboKey] = counts;
        if (!Object.keys(counts).length) delete baseline.combos[r.comboKey];
    }
    baseline.updatedAt = new Date().toISOString();
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
    const debt = Object.values(baseline.combos).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
    console.log(`baseline обновлён: ${path.relative(process.cwd(), BASELINE_PATH)}, известный долг: ${debt} нарушений`);
}

// ---------- Отчёты ----------
const allErrors = results.flatMap((r) => (r.errors || []).map((e) => `[${r.comboKey}] ${e}`));
const failures = results.filter((r) => r.failure);
const flat = results.flatMap((r) => r.violations.map((v, i) => ({ combo: r.comboKey, file: r.file, n: i + 1, ...v })));
const newErrors = flat.filter((v) => !v.known && v.severity === 'error');
const newWarns = flat.filter((v) => !v.known && v.severity === 'warn');
const debtCount = flat.filter((v) => v.known).length;
const byRule = {};
for (const v of flat) {
    const k = byRule[v.rule] || (byRule[v.rule] = { error: 0, warn: 0, newE: 0, newW: 0, known: 0 });
    k[v.severity === 'error' ? 'error' : 'warn'] += 1;
    if (v.known) k.known += 1; else if (v.severity === 'error') k.newE += 1; else k.newW += 1;
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    summary: { combos: results.length, newErrors: newErrors.length, newWarns: newWarns.length, debt: debtCount, consoleErrors: allErrors.length, failures: failures.length },
    byRule,
    violations: flat,
    consoleErrors: allErrors,
    failures: failures.map((f) => ({ combo: f.comboKey, failure: f.failure }))
}, null, 2));

const md = [];
md.push('# UI check report', '');
md.push(`Прогонов: ${results.length}. Новых ошибок: **${newErrors.length}**, новых предупреждений: **${newWarns.length}**, известный долг: ${debtCount}, console errors: ${allErrors.length}.`, '');
md.push('| Правило | всего err | всего warn | новых err | новых warn | долг |', '|---|---|---|---|---|---|');
for (const [rule, k] of Object.entries(byRule)) md.push(`| ${rule} | ${k.error} | ${k.warn} | ${k.newE} | ${k.newW} | ${k.known} |`);
md.push('', '## Новые нарушения', '');
const listNew = newErrors.concat(newWarns);
if (!listNew.length) md.push('нет');
for (const v of listNew) md.push(`- **${v.severity.toUpperCase()} ${v.rule}** \`${v.combo}\` #${v.n}: ${v.msg} (${v.file})`);
if (failures.length) { md.push('', '## Сбои прогонов', ''); failures.forEach((f) => md.push(`- ${f.comboKey}: ${f.failure}`)); }
if (allErrors.length) { md.push('', '## Console errors', ''); allErrors.forEach((e) => md.push(`- ${e}`)); }
fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');

// ---------- Итог ----------
console.log('\n=== Итог ===');
console.log(`новых ошибок: ${newErrors.length}, новых предупреждений: ${newWarns.length}, долг: ${debtCount}, console errors: ${allErrors.length}, сбоев: ${failures.length}`);
Object.entries(byRule).forEach(([rule, k]) => console.log(`  ${rule.padEnd(13)} err ${String(k.error).padStart(3)} / warn ${String(k.warn).padStart(3)}  (новых ${k.newE}/${k.newW}, долг ${k.known})`));
if (listNew.length) {
    console.log('\nНовые нарушения (рамка с этим номером на PNG):');
    listNew.slice(0, LIST_LIMIT).forEach((v) => console.log(`  ${v.severity === 'error' ? 'ERR ' : 'warn'} ${v.combo} #${v.n} ${v.rule}: ${v.msg}\n        -> ${v.file}`));
    if (listNew.length > LIST_LIMIT) console.log(`  ... ещё ${listNew.length - LIST_LIMIT} — полный список в ${path.relative(process.cwd(), path.join(OUT, 'report.md'))}`);
}
allErrors.slice(0, 20).forEach((e) => console.log('  console: ' + e));
console.log(`\nОтчёты: ${path.relative(process.cwd(), OUT)}/report.md, report.json, размеченные PNG рядом.`);

await browser.close();
const fail = newErrors.length > 0 || allErrors.length > 0 || failures.length > 0 || (STRICT && newWarns.length > 0);
process.exitCode = fail ? 1 : 0;
