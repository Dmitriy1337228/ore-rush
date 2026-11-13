// UI review runner (по воркфлоу web-design-reviewer): снимает состояние игры
// в разных сценариях. Запуск: node scripts/ui-review.mjs — dev-сервер поднимается
// сам и гасится после проверки (если порт уже занят, подключается к чужому).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('./lib/dev-server.cjs');
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const OUT = path.resolve(process.env.OUT_DIR || 'shots');
fs.mkdirSync(OUT, { recursive: true });

const SAVE_SEED = JSON.stringify({
    version: 2, ore: 5000, tier: 1, stars: 12, clicks: 120, lifetimeMined: 8000,
    tierEarned: [8000, 5000, 0, 0, 0],
    levels: { pickaxe: 13, sledge: 0, dynamite: 2, lucky: 0, resonance: 0, miner: 5, drill: 0, excavator: 0, factory: 0, tech: 0, lantern: 0, warehouse: 0 }
});

const server = await ensureDevServer();
process.on('exit', () => releaseDevServer(server));

const browser = await chromium.launch();

// Аудит вёрстки: обходим объекты сцен через window.__GAME, берём world bounds и ищем
// пересечения текст/кнопка и вылезания содержимого ряда за карточку. 0 нарушений = ок.
// СЛЕПЫЕ ЗОНЫ аудита (сознательные упрощения — помнить при добавлении визуала):
// - Rectangle/Graphics/ParticleEmitter исключены целиком: трек слайдера громкости,
//   учебные кольцо/стрелка/пузырь, затемнения не проверяются на пересечения;
// - getBounds() не учитывает setCrop — иконка проверяется по полному кадру;
// - глифы текста приближены (бокс минус 3px);
// - врезки 9-slice не видны: текст на декоративной фаске внутри bbox проходит;
// - depth/z-order не проверяются (слои модалок поверх — только визуальной съёмкой).
async function auditLayout(page) {
    return page.evaluate(() => {
        const game = window.__GAME;
        if (!game) return { violations: ['window.__GAME не найден'] };
        const items = [];
        const ui = game.scene.getScene('UIScene');
        const listCam = ui ? ui.listCam : null;
        for (const scene of game.scene.getScenes(true)) {
            const walk = (list, parentVisible) => {
                for (const go of list) {
                    if (go.visible === false || parentVisible === false) { if (go.list) walk(go.list, false); continue; }
                    if (go.list) { walk(go.list, true); continue; }
                    if (go.type === 'ParticleEmitter' || go.type === 'Graphics' || go.type === 'Rectangle') continue;
                    if (go.alpha !== undefined && go.alpha < 0.05) continue;
                    try {
                        const b = go.getBounds();
                        if (b.width <= 1 && b.height <= 1) continue;
                        let x = b.x, y = b.y, r = b.right, bt = b.bottom;
                        // Ряды живут в мировых координатах и рисуются камерой списка:
                        // переводим в экранные координаты (viewport самой камеры)
                        // и отсеиваем невидимые строки
                        let inList = false;
                        if (scene.scene.key === 'UIScene' && ui && ui.listContent && inTree(ui.listContent, go)) {
                            inList = true;
                            const vy = y - listCam.scrollY + listCam.y;
                            if (bt - listCam.scrollY + listCam.y < listCam.y - 2 || vy > listCam.y + listCam.height + 2) continue; // вне видимой полосы
                            y = vy; bt = bt - listCam.scrollY + listCam.y;
                            x = x - listCam.scrollX + listCam.x; r = r - listCam.scrollX + listCam.x;
                        }
                        // Текстовый бокс выше/ниже глифов на ~3px — приближаем к глифам
                        if (go.type === 'Text') { y += 3; bt -= 3; }
                        items.push({
                            scene: scene.scene.key,
                            kind: go.type,
                            text: (go.text || '').slice(0, 26),
                            tex: (go.texture && go.texture.key) || '',
                            x, y, r, bt,
                            interactive: !!(go.input && go.enabled)
                        });
                    } catch (e) { /* нет bounds — пропускаем */ }
                }
            };
            const inTree = (container, go) => {
                if (container === go) return true;
                if (!container.list) return false;
                for (const ch of container.list) { if (ch === go || inTree(ch, go)) return true; }
                return false;
            };
            walk(scene.children.list, true);
        }
        const violations = [];
        const isContained = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.r <= b.r + 1 && a.b <= b.b + 1;
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i], b = items[j];
                if (a.scene !== b.scene) continue;
                if (isContained(a, b) || isContained(b, a)) continue;
                const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
                const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
                if (ox > 1 && oy > 1) {
                    violations.push(`OVERLAP [${a.scene}] "${a.text || a.tex || a.kind}" (${Math.round(a.x)},${Math.round(a.y)}) x "${b.text || b.tex || b.kind}" (${Math.round(b.x)},${Math.round(b.y)}) ox=${Math.round(ox)} oy=${Math.round(oy)}`);
                }
            }
        }
        // Ряды улучшений: содержимое не должно вылезать за карточку (запас 5px)
        if (ui && ui.listContent) {
            const cards = ui.listContent.list.filter((go) => go.texture && go.texture.key === 'upgrade_row_card_1');
            for (const card of cards) {
                const cb = card.getBounds();
                const csx = cb.x - listCam.scrollX + listCam.x, csy = cb.y - listCam.scrollY + listCam.y;
                const csrx = cb.right - listCam.scrollX + listCam.x, csby = cb.bottom - listCam.scrollY + listCam.y;
                if (csby < listCam.y - 2 || csy > listCam.y + listCam.height + 2) continue; // карточка вне экрана
                const inner = { x: csx + 5, y: csy + 5, r: csrx - 5, b: csby - 5 };
                for (const go of ui.listContent.list) {
                    if (go === card || go.type === 'Rectangle') continue;
                    const gb = go.getBounds();
                    if (!gb || gb.width === 0) continue;
                    if (gb.bottom < cb.y || gb.y > cb.bottom) continue;
                    const gy = gb.y - listCam.scrollY + listCam.y, gby = gb.bottom - listCam.scrollY + listCam.y;
                    const gx = gb.x - listCam.scrollX + listCam.x, grx = gb.right - listCam.scrollX + listCam.x;
                    const adj = go.type === 'Text' ? 3 : 0;
                    if (gx < inner.x - 1 || grx > inner.r + 1 || gy + adj < inner.y - 1 || gby - adj > inner.b + 1) {
                        violations.push(`OUTSIDE-CARD row@${Math.round(csy)}: "${go.text || go.texture?.key || go.type}" (${Math.round(gx)},${Math.round(gy)})..(${Math.round(grx)},${Math.round(gby)}) вне зоны (${Math.round(inner.x)},${Math.round(inner.y)})..(${Math.round(inner.r)},${Math.round(inner.b)})`);
                    }
                }
            }
        }
        // Имена рядов: детерминированная проверка ширины, независимо от видимости
        // ряда (длинные имена машин видны только на глубоких тирах и не всегда
        // попадают в сценарии). Лимит — от ширины карточки (row.nameMaxW).
        if (ui && ui.rows) {
            for (const row of ui.rows) {
                if (!row.nameText || !row.nameText.width) continue;
                if (row.nameText.width > row.nameMaxW + 1) {
                    violations.push(`NAME-TOO-LONG "${row.nameText.text}" width=${Math.round(row.nameText.width)} > ${row.nameMaxW}`);
                }
            }
        }
        return { violations };
    });
}
// Ошибки страниц: одна копилка на ВСЕ сценарии (раньше _list сбрасывался в
// newPage и финальный отчёт видел только последний сценарий — гейт «console
// errors 0» был фиктивен для 9/10 прогонов).
const consoleErrors = [];
const scenarioFailures = [];

async function shoot(page, name) {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`shot: ${name}`);
}

async function newPage({ viewport = { width: 1280, height: 720 }, seed = null, name = '' } = {}) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const bucket = { name: name || `page_${consoleErrors.length + 1}`, errors: [] };
    consoleErrors.push(bucket);
    page.on('pageerror', (e) => bucket.errors.push(`pageerror: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') bucket.errors.push(`console: ${m.text()}`); });
    if (seed) {
        await page.addInitScript((s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        }, seed);
    }
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(2800); // шрифты + boot + create
    return { ctx, page };
}

// state-модуль в браузере: URL резолвим из resource-entries — dev-сервер отдаёт
// изменённые модули как '/src/state.js?t=...' (прямой import создал бы второй
// экземпляр с дефолтным состоянием).
async function withState(page, fnBody) {
    return page.evaluate(async (body) => {
        const res = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('/src/state.js'));
        const m = await import(res);
        // eslint-disable-next-line no-new-func
        return (new Function('m', `return (${body})(m);`))(m);
    }, fnBody);
}

// 1. Чистый старт + аудит вёрстки
{
    const { ctx, page } = await newPage({ name: '01_fresh' });
    const audit = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit.txt'), audit.violations.join('\n') || 'layout audit: 0 violations');
    console.log('layout violations:', audit.violations.length);
    audit.violations.forEach((v) => console.log('  ' + v));
    await shoot(page, '01_fresh');
    // Свежий старт выдаёт дневную награду — модалка блокирует ввод (dim),
    // закрываем перед сценариями кликов
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(200);
    // 2. Серия кликов по блоку (всплывающие цифры, частицы)
    for (let i = 0; i < 10; i++) {
        await page.mouse.click(400, 390);
        await page.waitForTimeout(110);
    }
    await shoot(page, '02_clicks');
    // 3. Покупки: выдаём руду через state-модуль (на чистом старте её меньше цены
    // кирки — покупка не случилась бы и с верными координатами), затем «Купить»
    // первого ряда: центр кнопки = listCam(934,270) + btn(242,48) = (1176, 318)
    const lvlBefore = await withState(page, 'm => { m.addOre(100000); return m.gameState.levels.pickaxe; }');
    for (let i = 0; i < 3; i++) { await page.mouse.click(1176, 318); await page.waitForTimeout(140); }
    await page.waitForTimeout(300);
    const lvlAfter = await withState(page, 'm => m.gameState.levels.pickaxe');
    if (lvlAfter !== lvlBefore + 3) {
        scenarioFailures.push(`03_buys: уровень кирки ${lvlBefore} -> ${lvlAfter}, ожидалось +3 (клик/покупка не работают)`);
    }
    await shoot(page, '03_buys');
    await ctx.close();
}

// 4. Скролл списка (сохранение с 12+ улучшениями)
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': SAVE_SEED }, name: '04_list' });
    await shoot(page, '04_list_top');
    const auditSeeded = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit_seeded.txt'), auditSeeded.violations.join('\n') || 'layout audit (seeded, stars=12): 0 violations');
    console.log('seeded violations:', auditSeeded.violations.length);
    auditSeeded.violations.forEach((v) => console.log('  ' + v));
    await page.mouse.move(1082, 430);
    await page.mouse.wheel(0, 1400); // до конца списка — видна строка «Фонарь»
    await page.waitForTimeout(400);
    await shoot(page, '05_list_scrolled');
    await page.mouse.wheel(0, -900); // назад к середине списка — строка «Робо-рука»
    await page.waitForTimeout(400);
    await shoot(page, '05b_list_middle');
    // 5. Модалка настроек + престиж
    await page.mouse.click(1146, 62);
    await page.waitForTimeout(300);
    await shoot(page, '06_settings_modal');
    const auditModal = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit_modal.txt'), auditModal.violations.join('\n') || 'layout audit (modal): 0 violations');
    console.log('modal violations:', auditModal.violations.length);
    auditModal.violations.forEach((v) => console.log('  ' + v));
    await page.mouse.click(860, 132); // закрыть (крестик в углу: контейнер 640,360 + (220,-228))
    await page.waitForTimeout(200);
    await ctx.close();
}

// 6. Офлайн-возврат (2 часа отсутствия)
{
    const exit = Date.now() - 2 * 3600 * 1000;
    const { ctx, page } = await newPage({
        seed: {
            'ore-rush-save': SAVE_SEED,
            'ore-rush-lastExit': String(exit),
            mockStats: JSON.stringify({ lastExit: exit })
        },
        name: '06_offline'
    });
    await shoot(page, '07_offline_modal');
    const auditOff = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit_offline.txt'), auditOff.violations.join('\n') || 'layout audit (offline): 0 violations');
    console.log('offline violations:', auditOff.violations.length);
    auditOff.violations.forEach((v) => console.log('  ' + v));
    // Забрать
    await page.mouse.click(640, 456);
    await page.waitForTimeout(300);
    await shoot(page, '07_offline_claimed');
    await ctx.close();
}

// 7. Готов спуск на новый тир (2600 железа при тире 0? нет — тир 1, накопим золото недоступно; проверим железо->золото)
{
    const rich = JSON.parse(SAVE_SEED);
    rich.ore = 26000; // >= 25000, спуск к золоту готов
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': JSON.stringify(rich) }, name: '07_unlock' });
    await shoot(page, '08_unlock_ready');
    await ctx.close();
}

// 8. Меньший viewport (масштаб FIT)
{
    const { ctx, page } = await newPage({ viewport: { width: 900, height: 506 }, name: '08_viewport900' });
    await shoot(page, '09_viewport_900');
    await ctx.close();
}

// 9. Глубокие ряды: длинные имена машин (Орбитальная станция, Квантовая лаборатория,
// Гравитационный резак) видны только на глубоких тирах — отдельный сценарий с тиром 6,
// скролл к «Орбитальной станции» (ряд 11) и гейт-анонсу «Квантовой лаборатории» (ряд 12).
{
    const deep = {
        version: 4, ore: 5e5, tier: 6, stars: 0, clicks: 500, lifetimeMined: 5e6,
        tierEarned: TIERS_SEED_EARNED(), tierAnchorRate: 0,
        levels: { pickaxe: 20, sledge: 5, hydraulic: 5, plasma: 2, miner: 30, robotarm: 2, drill: 20, excavator: 15, factory: 10, quarry: 8, megafactory: 5, tech: 2, dynamite: 10, lucky: 8, resonance: 5, lantern: 2, warehouse: 1 }
    };
    function TIERS_SEED_EARNED() { return Array.from({ length: 12 }, (_, i) => (i <= 6 ? 1e5 : 0)); }
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': JSON.stringify(deep) }, name: '09_deep' });
    await page.mouse.move(1082, 430);
    await page.mouse.wheel(0, 2200); // scrollY ~1100: «Орбитальная» и «Квантовая» целиком в окне 262..664
    await page.waitForTimeout(400);
    const auditDeep = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit_deep.txt'), auditDeep.violations.join('\n') || 'layout audit (deep rows, tier 6): 0 violations');
    console.log('deep violations:', auditDeep.violations.length);
    auditDeep.violations.forEach((v) => console.log('  ' + v));
    await shoot(page, '10_deep_rows');
    await ctx.close();
}

// 10b. Настройки при активном дневном бафе: блок статов не должен наезжать на
// тумблеры Звук/Музыка (наезд 6-й строки пойман скриншотом игрока с Pages —
// layout-аудит внутренности модалок не проверяет, тут детерминированный зазор).
{
    const { ctx, page } = await newPage({ name: '12_settings_daily' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown')); // «Настройки»
    await page.waitForTimeout(400);
    const check = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const statsBottom = ui.modalStats.y + ui.modalStats.height;
        const toggleTop = ui.soundBtn.y - ui.soundBtn.displayHeight / 2;
        return { gap: toggleTop - statsBottom, lines: ui.modalStats.text.split('\n').length, buff: ui.buffLine.text };
    });
    console.log(`settings/daily: gap ${Math.round(check.gap)}px, stat lines ${check.lines}, hud buff "${check.buff}"`);
    if (check.lines !== 5) scenarioFailures.push(`12_settings_daily: строк статов ${check.lines}, ожидалось 5 (баф не должен удлинять блок)`);
    if (check.gap < 8) scenarioFailures.push(`12_settings_daily: тумблеры наезжают на статы (зазор ${Math.round(check.gap)}px)`);
    if (!check.buff) scenarioFailures.push('12_settings_daily: HUD-таймер бафа пуст на свежем сейве');
    await shoot(page, '12_settings_daily');
    await ctx.close();
}

// 10. Портрет (мобилка 390x844 -> сетка 720x1280): аудит + модалка
{
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, name: '10_portrait' });
    const auditP = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit_portrait.txt'), auditP.violations.join('\n') || 'layout audit (portrait 390x844): 0 violations');
    console.log('portrait violations:', auditP.violations.length);
    auditP.violations.forEach((v) => console.log('  ' + v));
    await shoot(page, '11_portrait');
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown'));
    await page.waitForTimeout(300);
    await shoot(page, '12_portrait_modal');
    const auditPM = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit_portrait_modal.txt'), auditPM.violations.join('\n') || 'layout audit (portrait modal): 0 violations');
    console.log('portrait modal violations:', auditPM.violations.length);
    auditPM.violations.forEach((v) => console.log('  ' + v));
    await ctx.close();
}

// Финал: ошибки ВСЕХ сценариев + провалы сценарных ассертов (03_buys и т.п.)
const allErrors = consoleErrors.flatMap((b) => b.errors.map((e) => `[${b.name}] ${e}`));
const allFailures = allErrors.concat(scenarioFailures);
fs.writeFileSync(path.join(OUT, 'console_errors.txt'), allFailures.join('\n') || 'no console errors');
console.log('console errors:', allErrors.length);
allErrors.forEach((e) => console.log('  ' + e));
if (scenarioFailures.length) {
    console.log('scenario failures:', scenarioFailures.length);
    scenarioFailures.forEach((f) => console.log('  FAIL ' + f));
    process.exitCode = 1;
}
await browser.close();
