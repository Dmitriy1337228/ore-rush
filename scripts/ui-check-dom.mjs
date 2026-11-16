// DOM-аудит вёрстки (пилот DOM, этап 1, шаг 1.8; гейт — этап 5).
// Playwright + getBoundingClientRect: проверяет DOM-слой по тем же порогам, что
// display-list аудит (UI_RULES из src/dev/uiAudit.js) — БЕЗ ослабления.
//
// Правила (все в CSS px, т.к. DOM уже в CSS px):
//   ROOT-RECT   error  #ui-root не совпадает с канвасом (±1 CSS px)
//   OVERLAP     error  текстовые/интерактивные блоки пересекаются
//   BOUNDS      error  элемент выходит за врезку (по горизонтали / в скролле)
//   MIN-FONT    error < 8, warn < 10   (UI_RULES.minFontCss)
//   TOUCH       warn   интерактив меньше 40 (моб.) / 24 (десктоп) CSS px
//   PADDING     warn   текст ближе порога UI_RULES.minPadding.panel к краю карточки
//
// Обход ВСЕХ рядов: скролл-контейнер прокручивается по шагам (0%, 50%, 100%),
// аудит объединяется; в отчёте — сколько рядов реально проверено.
//
// Запуск: node scripts/ui-check-dom.mjs [--viewports p390,d1280] [--out shots/ui-check-dom]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { UI_RULES } from '../src/dev/uiAudit.js';
import { ITEMS, CRAFT_RECIPES, ARTIFACTS } from '../src/state.js';
import { SAVE_KEY, SEEDS } from './lib/ui-matrix.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

// 6 вьюпортов пилота (этап 1 DoD); на этапе 4 добавится 1920x1080.
const VIEWPORTS = [
    { id: 'p360', width: 360, height: 640 },
    { id: 'p390', width: 390, height: 844 },
    { id: 'p412', width: 412, height: 915 },
    { id: 't768', width: 768, height: 1024 },
    { id: 'l844', width: 844, height: 390 },
    { id: 'd1280', width: 1280, height: 720 },
    { id: 'd1920', width: 1920, height: 1080 }
];

const OUT = path.resolve(opt('out', 'shots/ui-check-dom'));
// Размеченные PNG кладём по общему протоколу осмотра — рядом с Phaser-аудитом
const SHOT_DIR = path.resolve('shots/ui-check');
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const URL = `${BASE}/?dom=1`;
const vpFilter = opt('viewports') ? opt('viewports').split(',') : null;
const viewports = VIEWPORTS.filter((v) => (vpFilter ? vpFilter.includes(v.id) : true));
const ENABLE_SHOTS = !flag('no-shots');
// Сколько строк обязано быть проверено: боевой экран (7 предметов + 10 рецептов
// + 9 артефактов) из каталогов state.js.
const EXPECTED_ROWS = ITEMS.length + CRAFT_RECIPES.length + ARTIFACTS.length;
const EXPECTED_ROW_IDS = [
    ...ITEMS.map((x) => x.id),
    ...CRAFT_RECIPES.map((x) => x.id),
    ...ARTIFACTS.map((x) => x.id)
];

// Допуск на субпиксельные округления при измерении прямоугольников.
// 1 CSS px — тот же порядок, что overlapTolerance UI_RULES (1 игровой px на базовой сетке).
const RECT_TOLERANCE_CSS = 1;
// Шаги прокрутки: по 3/4 видимой высоты скролла — каждый ряд попадает в проверенную
// зону (иначе высокие строки на телефоне пропускаются между 0/50/100%).
const SCROLL_STEP_SHARE = 0.75;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });
const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));
const browser = await chromium.launch();

// Аудит в контексте страницы. Пороги передаются из UI_RULES (не дублируются).
const auditFn = ({ rules, tolerance }) => {
    const result = { violations: [], rows: [], counts: { rectangles: 0 } };
    const root = document.getElementById('ui-root');
    const canvas = document.querySelector('#game canvas');
    if (!root || !canvas) {
        result.violations.push({ rule: 'ROOT-RECT', severity: 'error', msg: 'нет #ui-root или канваса' });
        return result;
    }
    const r = (el) => el.getBoundingClientRect();
    const rootRect = r(root);
    const canvasRect = r(canvas);
    for (const k of ['left', 'top', 'width', 'height']) {
        const d = Math.abs(rootRect[k] - canvasRect[k]);
        if (d > tolerance) {
            result.violations.push({
                rule: 'ROOT-RECT', severity: 'error',
                rect: [rootRect.left, rootRect.top, rootRect.width, rootRect.height],
                msg: `#ui-root.${k} отличается от канваса на ${d.toFixed(1)} CSS px (${rootRect[k].toFixed(1)} vs ${canvasRect[k].toFixed(1)})`
            });
        }
    }
    const panel = root.querySelector('[data-dom-panel]');
    const scroll = root.querySelector('[data-dom-scroll]');
    if (!panel || !scroll || panel.hidden) {
        result.violations.push({ rule: 'ROOT-RECT', severity: 'error', msg: 'панель не смонтирована или скрыта' });
        return result;
    }
    const panelRect = r(panel);
    const scrollRect = r(scroll);
    const contains = (a, b) => a.left <= b.left - tolerance && a.right >= b.right + tolerance
        && a.top <= b.top - tolerance && a.bottom >= b.bottom + tolerance;
    const intersects = (rect, zone) => rect.width > 0 && rect.height > 0
        && rect.right > zone.left - tolerance && rect.left < zone.right + tolerance
        && rect.bottom > zone.top - tolerance && rect.top < zone.bottom + tolerance;
    // Элементы шапки (заголовок/подсказка/чипы) лежат вне скролла — видимость
    // считаем по врезке, иначе их пересечения с крестиком не проверялись.
    const visibleEl = (el) => {
        const zone = scroll.contains(el) ? scrollRect : panelRect;
        return intersects(r(el), zone);
    };
    // Для чисто-текстовых блоков меряем текст (Range), а не блочную коробку:
    // заголовок-блок на всю ширину давал ложные пересечения с крестиком.
    const boxOf = (el) => {
        const onlyText = el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE;
        if (onlyText) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return rect;
        }
        return r(el);
    };

    // Блоки: карточки, текстовые строки и интерактив (Button/role=button).
    const BLOCK_SELECTOR = [
        '.dom-title', '.dom-close', '.dom-hint', '.dom-chip', '.dom-section',
        '.dom-row', '.dom-art', '.dom-name', '.dom-sub', '.dom-desc',
        '.dom-stock', '.dom-error', '.dom-need', '.dom-src', '.dom-status', '.dom-line',
        '.dom-btn'
    ].join(',');
    // Для блоков внутри скролла сравниваем ТОЛЬКО видимую (обрезанную) часть:
    // иначе ряд, ушедший под шапку, «пересекается» с заголовком/чипами фиктивно.
    const clipToScroll = (rect) => {
        const left = Math.max(rect.left, scrollRect.left);
        const right = Math.min(rect.right, scrollRect.right);
        const top = Math.max(rect.top, scrollRect.top);
        const bottom = Math.min(rect.bottom, scrollRect.bottom);
        if (right - left <= tolerance || bottom - top <= tolerance) return null;
        return { left, right, top, bottom, width: right - left, height: bottom - top };
    };
    const clipOf = (el) => {
        const box = boxOf(el);
        if (scroll.contains(el)) return clipToScroll(box);
        return intersects(box, panelRect) ? box : null;
    };

    const blocks = Array.from(panel.querySelectorAll(BLOCK_SELECTOR))
        .filter((el) => el.getClientRects().length)
        .map((el) => ({ el, rect: clipOf(el) }))
        .filter((b) => b.rect);
    result.counts.rectangles = blocks.length;

    const rows = new Set();
    for (const el of panel.querySelectorAll('[data-row], [data-art]')) {
        if (visibleEl(el)) rows.add(el.dataset.row || el.dataset.art);
    }
    result.rows = Array.from(rows);

    // OVERLAP: пересечение двух блоков, ни один не содержит другой.
    for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i], b = blocks[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const ra = a.rect, rb = b.rect;
            const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (ox > tolerance && oy > tolerance) {
                result.violations.push({
                    rule: 'OVERLAP', severity: 'error',
                    rect: [Math.max(ra.left, rb.left), Math.max(ra.top, rb.top), ox, oy],
                    msg: `"${a.el.className}" (${Math.round(ra.left)},${Math.round(ra.top)}) x "${b.el.className}" (${Math.round(rb.left)},${Math.round(rb.top)}) ox=${Math.round(ox)} oy=${Math.round(oy)}`
                });
            }
        }
    }

    // BOUNDS: горизонтальный выход за врезку (вертикаль ограничена скроллом).
    for (const { el } of blocks) {
        const rr = r(el);
        if (rr.left < panelRect.left - tolerance || rr.right > panelRect.right + tolerance) {
            result.violations.push({ rule: 'BOUNDS', severity: 'error', rect: [rr.left, rr.top, rr.width, rr.height], msg: `"${el.className}" выходит за врезку по горизонтали (${Math.round(rr.left)}..${Math.round(rr.right)} vs ${Math.round(panelRect.left)}..${Math.round(panelRect.right)})` });
        }
    }

    // MIN-FONT: кегль на экране (CSS px — масштаба FIT здесь нет).
    for (const { el } of blocks) {
        const style = getComputedStyle(el);
        const size = parseFloat(style.fontSize);
        if (!Number.isFinite(size) || size <= 0) continue;
        if (size < rules.minFontCss.error) {
            const rr = r(el);
            result.violations.push({ rule: 'MIN-FONT', severity: 'error', rect: [rr.left, rr.top, rr.width, rr.height], msg: `"${el.className}": кегль ${size}px < ${rules.minFontCss.error}` });
        } else if (size < rules.minFontCss.warn) {
            const rr = r(el);
            result.violations.push({ rule: 'MIN-FONT', severity: 'warn', rect: [rr.left, rr.top, rr.width, rr.height], msg: `"${el.className}": кегль ${size}px < ${rules.minFontCss.warn}` });
        }
    }

    // TOUCH: мобильный порог по ширине окна (как mobileMaxWidthCss в UI_RULES).
    const mobile = window.innerWidth <= rules.mobileMaxWidthCss;
    const touchMin = mobile ? rules.minTouchCss.mobile : rules.minTouchCss.desktop;
    for (const el of panel.querySelectorAll('.dom-btn, .dom-close')) {
        if (!el.getClientRects().length || !visibleEl(el)) continue;
        const rr = r(el);
        if (rr.width < touchMin - tolerance || rr.height < touchMin - tolerance) {
            result.violations.push({ rule: 'TOUCH', severity: 'warn', rect: [rr.left, rr.top, rr.width, rr.height], msg: `"${el.className}" ${Math.round(rr.width)}x${Math.round(rr.height)} < ${touchMin} CSS px` });
        }
    }

    // PADDING: текст внутри карточки ряда не ближе rules.minPadding.panel к её краю.
    for (const host of panel.querySelectorAll('.dom-row, .dom-art')) {
        if (!visibleEl(host)) continue;
        const hr = r(host);
        for (const text of host.querySelectorAll('.dom-name, .dom-sub, .dom-desc, .dom-stock, .dom-error, .dom-need, .dom-src, .dom-status, .dom-line')) {
            const tr = r(text);
            if (!tr.width || !tr.height) continue;
            const pad = Math.min(tr.left - hr.left, hr.right - tr.right);
            if (pad < rules.minPadding.panel - tolerance) {
                result.violations.push({ rule: 'PADDING', severity: 'warn', rect: [tr.left, tr.top, tr.width, tr.height], msg: `"${text.className}" отступ ${pad.toFixed(1)} < ${rules.minPadding.panel} CSS px` });
            }
        }
    }

    return result;
};

const results = [];
for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
    await page.addInitScript((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, { [SAVE_KEY]: JSON.stringify(SEEDS.mid), domUi: '1' });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => {
        const g = window.__GAME;
        const ui = g && g.scene.getScene('UIScene');
        return !!(ui && ui.L && window.__DOM_CRAFT && document.fonts.status === 'loaded');
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1250); // отложенная ежедневная награда (delayedCall 900 мс)
    await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._pendingDaily = null;
        ui.registry.set('dailyInfo', null);
        if (ui._dailyOpen) ui.hideDailyModal();
    });
    await page.waitForTimeout(350); // updateBlockLock снимет блокировку в следующем кадре
    await page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
        const m = await import(url);
        // Как состояние craft в ui-matrix: компоненты и предметы выданы,
        // пассив = 0 (руда не меняется во время аудита).
        for (const id of Object.keys(m.gameState.levels)) m.gameState.levels[id] = 0;
        for (const c of m.COMPONENTS) m.gameState.components[c.id] = 100;
        for (const i of m.ITEMS) m.gameState.items[i.id] = 2;
        window.__GAME.scene.getScene('UIScene').openCraft();
    });
    await page.waitForFunction(() => window.__DOM_CRAFT.isOpen(), null, { timeout: 10000 });
    await page.waitForTimeout(300);

    const violations = [];
    const seenRows = new Set();
    let failures = '';
    let positions = [0];
    try {
        const metrics = await page.evaluate(() => {
            const el = document.querySelector('[data-dom-scroll]');
            return { max: el.scrollHeight - el.clientHeight, view: el.clientHeight };
        });
        const stepPx = Math.max(1, Math.floor(metrics.view * SCROLL_STEP_SHARE));
        positions = [];
        for (let y = 0; y < metrics.max; y += stepPx) positions.push(y);
        positions.push(metrics.max);

        for (const [i, y] of positions.entries()) {
            await page.evaluate((top) => {
                document.querySelector('[data-dom-scroll]').scrollTop = top;
            }, y);
            await page.waitForTimeout(150);
            const res = await page.evaluate(auditFn, {
                rules: {
                    minFontCss: UI_RULES.minFontCss,
                    minTouchCss: UI_RULES.minTouchCss,
                    minPadding: UI_RULES.minPadding,
                    mobileMaxWidthCss: UI_RULES.mobileMaxWidthCss
                },
                tolerance: RECT_TOLERANCE_CSS
            });
            violations.push(...res.violations.map((v) => ({ ...v, step: `#${i}@${y}` })));
            res.rows.forEach((row) => seenRows.add(row));
        }
    } catch (e) {
        failures = String((e && e.message) || e).split('\n')[0];
    }

    const dedup = new Map();
    for (const v of violations) {
        const key = `${v.rule}|${v.msg}`;
        if (!dedup.has(key)) dedup.set(key, v);
    }
    const unique = Array.from(dedup.values());
    const missingRows = EXPECTED_ROW_IDS.filter((id) => !seenRows.has(id));
    if (!failures && missingRows.length) {
        unique.push({
            rule: 'ROWS', severity: 'error', step: 'scroll',
            msg: `проверено ${seenRows.size} из ${EXPECTED_ROWS} рядов; не попали в проверенную зону: ${missingRows.join(', ')}`
        });
    }

    // Размеченный PNG по протоколу shots/ui-check: рамки нарушений поверх экрана
    if (ENABLE_SHOTS && !failures) {
        const marks = unique.filter((v) => v.rect).map((v) => ({ rect: v.rect, sev: v.severity }));
        await page.evaluate((items) => {
            document.querySelectorAll('.ui-check-mark').forEach((n) => n.remove());
            if (!items.length) return;
            const layer = document.createElement('div');
            layer.className = 'ui-check-mark';
            layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
            for (const it of items) {
                const box = document.createElement('div');
                const [x, y, w, h] = it.rect;
                box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
                    + `outline:2px solid ${it.sev === 'error' ? '#ff3b30' : '#ffcc00'};outline-offset:1px;`;
                layer.appendChild(box);
            }
            document.body.appendChild(layer);
        }, marks);
        await page.evaluate(() => { document.querySelector('[data-dom-scroll]').scrollTop = 0; });
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.id}__craft-dom.png`) });
        await page.evaluate(() => document.querySelectorAll('.ui-check-mark').forEach((n) => n.remove()));
    }
    const errors = unique.filter((v) => v.severity === 'error');
    const warns = unique.filter((v) => v.severity === 'warn');
    results.push({ viewport: vp.id, size: `${vp.width}x${vp.height}`, rows: seenRows.size, rowIds: Array.from(seenRows), errors: errors.length, warns: warns.length, violations: unique, consoleErrors, failure: failures });
    console.log(`${failures ? 'FAIL' : (errors.length ? 'ERR ' : (warns.length ? 'warn' : 'ok  '))} ${vp.id.padEnd(6)} ${String(vp.width + 'x' + vp.height).padEnd(9)} рядов: ${seenRows.size}; новых: ${errors.length} err, ${warns.length} warn${failures ? ' — ' + failures : ''}`);
    unique.slice(0, 20).forEach((v) => console.log(`    ${v.severity === 'error' ? 'ERR ' : 'warn'} #${v.step} ${v.rule}: ${v.msg}`));
    if (consoleErrors.length) consoleErrors.slice(0, 5).forEach((e) => console.log(`    console: ${e}`));
    await ctx.close();
}

const totalErr = results.reduce((s, r) => s + r.errors, 0);
const totalWarn = results.reduce((s, r) => s + r.warns, 0);
const totalConsole = results.reduce((s, r) => s + r.consoleErrors.length, 0);
const totalFail = results.filter((r) => r.failure).length;

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    url: URL,
    rules: UI_RULES,
    tolerance: RECT_TOLERANCE_CSS,
    summary: { viewports: results.length, errors: totalErr, warns: totalWarn, consoleErrors: totalConsole, failures: totalFail },
    results
}, null, 2) + '\n');

console.log(`\n=== Итог ===\nвьюпортов: ${results.length}, ошибок: ${totalErr}, предупреждений: ${totalWarn}, console errors: ${totalConsole}, сбоев: ${totalFail}`);
console.log(`Отчёт: ${path.relative(process.cwd(), OUT)}/report.json`);
await browser.close();
process.exitCode = (totalErr || totalConsole || totalFail) ? 1 : 0;
