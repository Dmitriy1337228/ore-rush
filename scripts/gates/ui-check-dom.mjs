// DOM-аудит вёрстки форм (пилот DOM, этап 1, шаг 1.8; фаза 2 — шаг 1.2).
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
//   ROWS        error  ожидаемые элементы/ряды формы не попали в проверенную зону
//
// Формы и селекторы — из реестра scripts/lib/dom-forms.mjs (--form craft|settings|status|all).
// Обход всех рядов: скролл-контейнер прокручивается шагами (если он есть), аудит объединяется.
//
// Запуск: npm run ui:check:dom [-- --form craft] [--viewports p390,d1280] [--out shots/ui-check-dom]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { UI_RULES } from '../../src/dev/uiAudit.js';
import { SAVE_KEY, SEEDS } from '../lib/ui-matrix.mjs';
import { resolveForms } from '../lib/dom-forms.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);

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
const SHOT_DIR = path.resolve('shots/ui-check');
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const vpFilter = opt('viewports') ? opt('viewports').split(',') : null;
const viewports = VIEWPORTS.filter((v) => (vpFilter ? vpFilter.includes(v.id) : true));
const ENABLE_SHOTS = !flag('no-shots');
const RECT_TOLERANCE_CSS = 1;
const SCROLL_STEP_SHARE = 0.75;

const requested = opt('form', 'all');
const forms = resolveForms(requested);
if (!forms) {
    console.error(`ui:check:dom: неизвестная форма "${requested}" (есть: craft, settings, status, all)`);
    process.exit(2);
}

const skipped = requested === 'all' ? [] : forms.filter((f) => f.pending);
const active = forms.filter((f) => !f.pending);

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
let totalErr = 0;
let totalWarn = 0;
let totalConsole = 0;
let totalFail = 0;

if (skipped.length) {
    for (const f of skipped) {
        console.log(`пропущено ${f.id}: форма ещё не на DOM (pending)`);
    }
}

if (active.length) {
    const server = await ensureDevServer();
    process.on('exit', () => releaseDevServer(server));
    const browser = await chromium.launch();

    const auditFn = ({ rules, tolerance, panelSelector }) => {
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
                    rule: 'ROOT-RECT',
                    severity: 'error',
                    rect: [rootRect.left, rootRect.top, rootRect.width, rootRect.height],
                    msg: `#ui-root.${k} отличается от канваса на ${d.toFixed(1)} CSS px (${rootRect[k].toFixed(1)} vs ${canvasRect[k].toFixed(1)})`
                });
            }
        }

        const panel = root.querySelector(panelSelector);
        const scroll = root.querySelector('[data-dom-scroll]');
        if (!panel || panel.hidden) {
            result.violations.push({ rule: 'ROOT-RECT', severity: 'error', msg: 'панель не смонтирована или скрыта' });

            return result;
        }

        const panelRect = r(panel);
        const scrollRect = scroll ? r(scroll) : null;
        const intersects = (rect, zone) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > zone.left - tolerance &&
            rect.left < zone.right + tolerance &&
            rect.bottom > zone.top - tolerance &&
            rect.top < zone.bottom + tolerance;
        const visibleEl = (el) => {
            if (!scroll || !scroll.contains(el)) {
                return intersects(r(el), panelRect);
            }

            return intersects(r(el), scrollRect);
        };
        const boxOf = (el) => {
            const onlyText = el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE;
            if (onlyText) {
                const range = document.createRange();
                range.selectNodeContents(el);
                const rect = range.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    return rect;
                }
            }

            return r(el);
        };

        const BLOCK_SELECTOR = [
            '.dom-title',
            '.dom-close',
            '.dom-hint',
            '.dom-chip',
            '.dom-section',
            '.dom-row',
            '.dom-art',
            '.dom-name',
            '.dom-sub',
            '.dom-desc',
            '.dom-stock',
            '.dom-error',
            '.dom-need',
            '.dom-src',
            '.dom-status',
            '.dom-line',
            '.dom-btn',
            '.dom-toggle',
            '.dom-stat',
            '.dom-range-value'
        ].join(',');
        const clipToScroll = (rect) => {
            const left = Math.max(rect.left, scrollRect.left);
            const right = Math.min(rect.right, scrollRect.right);
            const top = Math.max(rect.top, scrollRect.top);
            const bottom = Math.min(rect.bottom, scrollRect.bottom);
            if (right - left <= tolerance || bottom - top <= tolerance) {
                return null;
            }

            return { left, right, top, bottom, width: right - left, height: bottom - top };
        };
        const clipOf = (el) => {
            const box = boxOf(el);
            if (scroll && scroll.contains(el)) {
                return clipToScroll(box);
            }

            return intersects(box, panelRect) ? box : null;
        };

        const blocks = Array.from(panel.querySelectorAll(BLOCK_SELECTOR))
            .filter((el) => el.getClientRects().length)
            .map((el) => ({ el, rect: clipOf(el) }))
            .filter((b) => b.rect);
        result.counts.rectangles = blocks.length;

        const rows = new Set();
        for (const el of panel.querySelectorAll('[data-row], [data-art], [data-form-id]')) {
            if (visibleEl(el)) {
                rows.add(el.dataset.row || el.dataset.art || el.dataset.formId);
            }
        }

        result.rows = Array.from(rows);

        for (let i = 0; i < blocks.length; i++) {
            for (let j = i + 1; j < blocks.length; j++) {
                const a = blocks[i],
                    b = blocks[j];
                if (a.el.contains(b.el) || b.el.contains(a.el)) {
                    continue;
                }

                const ra = a.rect,
                    rb = b.rect;
                const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                if (ox > tolerance && oy > tolerance) {
                    result.violations.push({
                        rule: 'OVERLAP',
                        severity: 'error',
                        rect: [Math.max(ra.left, rb.left), Math.max(ra.top, rb.top), ox, oy],
                        msg: `"${a.el.className}" (${Math.round(ra.left)},${Math.round(ra.top)}) x "${b.el.className}" (${Math.round(rb.left)},${Math.round(rb.top)}) ox=${Math.round(ox)} oy=${Math.round(oy)}`
                    });
                }
            }
        }

        for (const { el } of blocks) {
            const rr = r(el);
            if (rr.left < panelRect.left - tolerance || rr.right > panelRect.right + tolerance) {
                result.violations.push({
                    rule: 'BOUNDS',
                    severity: 'error',
                    rect: [rr.left, rr.top, rr.width, rr.height],
                    msg: `"${el.className}" выходит за врезку по горизонтали (${Math.round(rr.left)}..${Math.round(rr.right)} vs ${Math.round(panelRect.left)}..${Math.round(panelRect.right)})`
                });
            }
        }

        for (const { el } of blocks) {
            const style = getComputedStyle(el);
            const size = parseFloat(style.fontSize);
            if (!Number.isFinite(size) || size <= 0) {
                continue;
            }

            if (size < rules.minFontCss.error) {
                const rr = r(el);
                result.violations.push({
                    rule: 'MIN-FONT',
                    severity: 'error',
                    rect: [rr.left, rr.top, rr.width, rr.height],
                    msg: `"${el.className}": кегль ${size}px < ${rules.minFontCss.error}`
                });
            } else if (size < rules.minFontCss.warn) {
                const rr = r(el);
                result.violations.push({
                    rule: 'MIN-FONT',
                    severity: 'warn',
                    rect: [rr.left, rr.top, rr.width, rr.height],
                    msg: `"${el.className}": кегль ${size}px < ${rules.minFontCss.warn}`
                });
            }
        }

        const mobile = window.innerWidth <= rules.mobileMaxWidthCss;
        const touchMin = mobile ? rules.minTouchCss.mobile : rules.minTouchCss.desktop;
        for (const el of panel.querySelectorAll('.dom-btn, .dom-close, .dom-toggle, .dom-range-input')) {
            if (!el.getClientRects().length || !visibleEl(el)) {
                continue;
            }

            const rr = r(el);
            if (rr.width < touchMin - tolerance || rr.height < touchMin - tolerance) {
                result.violations.push({
                    rule: 'TOUCH',
                    severity: 'warn',
                    rect: [rr.left, rr.top, rr.width, rr.height],
                    msg: `"${el.className}" ${Math.round(rr.width)}x${Math.round(rr.height)} < ${touchMin} CSS px`
                });
            }
        }

        for (const host of panel.querySelectorAll('.dom-row, .dom-art')) {
            if (!visibleEl(host)) {
                continue;
            }

            const hr = r(host);
            for (const text of host.querySelectorAll(
                '.dom-name, .dom-sub, .dom-desc, .dom-stock, .dom-error, .dom-need, .dom-src, .dom-status, .dom-line'
            )) {
                const tr = r(text);
                if (!tr.width || !tr.height) {
                    continue;
                }

                const pad = Math.min(tr.left - hr.left, hr.right - tr.right);
                if (pad < rules.minPadding.panel - tolerance) {
                    result.violations.push({
                        rule: 'PADDING',
                        severity: 'warn',
                        rect: [tr.left, tr.top, tr.width, tr.height],
                        msg: `"${text.className}" отступ ${pad.toFixed(1)} < ${rules.minPadding.panel} CSS px`
                    });
                }
            }
        }

        return result;
    };

    for (const form of active) {
        const expectedIds = form.expected();
        for (const vp of viewports) {
            const ctx = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                deviceScaleFactor: 1
            });
            const page = await ctx.newPage();
            const consoleErrors = [];
            page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));
            page.on('console', (m) => {
                if (m.type() === 'error') {
                    consoleErrors.push(`console: ${m.text()}`);
                }
            });
            await page.addInitScript(
                (s) => {
                    for (const [k, v] of Object.entries(s)) {
                        localStorage.setItem(k, v);
                    }
                },
                { [SAVE_KEY]: JSON.stringify(SEEDS[form.seed] || SEEDS.mid) }
            );
            await page.goto(BASE, { waitUntil: 'load' });
            await page.waitForFunction(
                (api) => {
                    const g = window.__GAME;
                    const ui = g && g.scene.getScene('UIScene');

                    return !!(ui && ui.L && window[api] && document.fonts.status === 'loaded');
                },
                form.api,
                { timeout: 30000 }
            );
            await page.waitForTimeout(1250);
            if (form.prepare) {
                await page.evaluate(form.prepare);
            }

            await page.waitForTimeout(350);
            await page.evaluate(form.open);
            await page.waitForFunction(form.isOpen, null, { timeout: 10000 });
            await page.waitForTimeout(300);

            const violations = [];
            const seenRows = new Set();
            let failures = '';
            try {
                const scrollMetrics = await page.evaluate(() => {
                    const el = document.querySelector('[data-dom-scroll]');
                    if (!el) {
                        return null;
                    }

                    return { max: el.scrollHeight - el.clientHeight, view: el.clientHeight };
                });
                let positions = [0];
                if (scrollMetrics) {
                    const stepPx = Math.max(1, Math.floor(scrollMetrics.view * SCROLL_STEP_SHARE));
                    positions = [];
                    for (let y = 0; y < scrollMetrics.max; y += stepPx) {
                        positions.push(y);
                    }

                    positions.push(scrollMetrics.max);
                }

                for (const [i, y] of positions.entries()) {
                    if (scrollMetrics) {
                        await page.evaluate((top) => {
                            document.querySelector('[data-dom-scroll]').scrollTop = top;
                        }, y);
                        await page.waitForTimeout(150);
                    }

                    const res = await page.evaluate(auditFn, {
                        rules: {
                            minFontCss: UI_RULES.minFontCss,
                            minTouchCss: UI_RULES.minTouchCss,
                            minPadding: UI_RULES.minPadding,
                            mobileMaxWidthCss: UI_RULES.mobileMaxWidthCss
                        },
                        tolerance: RECT_TOLERANCE_CSS,
                        panelSelector: form.panel
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
                if (!dedup.has(key)) {
                    dedup.set(key, v);
                }
            }

            const unique = Array.from(dedup.values());
            const missingRows = expectedIds.filter((id) => !seenRows.has(id));
            if (!failures && missingRows.length) {
                unique.push({
                    rule: 'ROWS',
                    severity: 'error',
                    step: 'scroll',
                    msg: `проверено ${seenRows.size} из ${expectedIds.length} элементов; не попали в проверенную зону: ${missingRows.join(', ')}`
                });
            }

            if (ENABLE_SHOTS && !failures) {
                const marks = unique.filter((v) => v.rect).map((v) => ({ rect: v.rect, sev: v.severity }));
                await page.evaluate((items) => {
                    document.querySelectorAll('.ui-check-mark').forEach((n) => n.remove());
                    if (!items.length) {
                        return;
                    }

                    const layer = document.createElement('div');
                    layer.className = 'ui-check-mark';
                    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
                    for (const it of items) {
                        const box = document.createElement('div');
                        const [x, y, w, h] = it.rect;
                        box.style.cssText =
                            `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;` +
                            `outline:2px solid ${it.sev === 'error' ? '#ff3b30' : '#ffcc00'};outline-offset:1px;`;
                        layer.appendChild(box);
                    }

                    document.body.appendChild(layer);
                }, marks);
                await page.evaluate(() => {
                    const el = document.querySelector('[data-dom-scroll]');
                    if (el) {
                        el.scrollTop = 0;
                    }
                });
                await page.waitForTimeout(120);
                await page.screenshot({ path: path.join(SHOT_DIR, `${vp.id}__${form.id}-dom.png`) });
                await page.evaluate(() => document.querySelectorAll('.ui-check-mark').forEach((n) => n.remove()));
            }

            const errors = unique.filter((v) => v.severity === 'error');
            const warns = unique.filter((v) => v.severity === 'warn');
            results.push({
                form: form.id,
                viewport: vp.id,
                size: `${vp.width}x${vp.height}`,
                rows: seenRows.size,
                rowIds: Array.from(seenRows),
                errors: errors.length,
                warns: warns.length,
                violations: unique,
                consoleErrors,
                failure: failures
            });
            console.log(
                `${failures ? 'FAIL' : errors.length ? 'ERR ' : warns.length ? 'warn' : 'ok  '} ${form.id.padEnd(9)} ${vp.id.padEnd(6)} ${String(vp.width + 'x' + vp.height).padEnd(9)} элементов: ${seenRows.size}/${expectedIds.length}; новых: ${errors.length} err, ${warns.length} warn${failures ? ' — ' + failures : ''}`
            );
            unique
                .slice(0, 20)
                .forEach((v) =>
                    console.log(`    ${v.severity === 'error' ? 'ERR ' : 'warn'} #${v.step} ${v.rule}: ${v.msg}`)
                );
            if (consoleErrors.length) {
                consoleErrors.slice(0, 5).forEach((e) => console.log(`    console: ${e}`));
            }

            await ctx.close();
        }
    }

    await browser.close();
    totalErr = results.reduce((s, r) => s + r.errors, 0);
    totalWarn = results.reduce((s, r) => s + r.warns, 0);
    totalConsole = results.reduce((s, r) => s + r.consoleErrors.length, 0);
    totalFail = results.filter((r) => r.failure).length;
}

fs.writeFileSync(
    path.join(OUT, 'report.json'),
    JSON.stringify(
        {
            createdAt: new Date().toISOString(),
            url: BASE,
            form: requested,
            skipped: skipped.map((f) => f.id),
            rules: UI_RULES,
            tolerance: RECT_TOLERANCE_CSS,
            summary: {
                forms: active.map((f) => f.id),
                viewports: results.length,
                errors: totalErr,
                warns: totalWarn,
                consoleErrors: totalConsole,
                failures: totalFail
            },
            results
        },
        null,
        2
    ) + '\n'
);

console.log(
    `\n=== Итог ===\nформ: ${active.map((f) => f.id).join(', ') || '—'}, прогонов: ${results.length}, ошибок: ${totalErr}, предупреждений: ${totalWarn}, console errors: ${totalConsole}, сбоев: ${totalFail}`
);
console.log(`Отчёт: ${path.relative(process.cwd(), OUT)}/report.json`);
process.exitCode = totalErr || totalConsole || totalFail ? 1 : 0;
