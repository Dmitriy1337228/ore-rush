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
const consoleErrors = {};

async function shoot(page, name) {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`shot: ${name}`);
}

async function newPage({ viewport = { width: 1280, height: 720 }, seed = null } = {}) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const key = ctx.browser() ? page.url() : 'x';
    consoleErrors[page.url?.() || 'page'] = [];
    page.on('pageerror', (e) => consoleErrors._list?.push(String(e)) || (consoleErrors._list ||= []).push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') (consoleErrors._list ||= []).push(m.text()); });
    consoleErrors._list = [];
    if (seed) {
        await page.addInitScript((s) => {
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        }, seed);
    }
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(2800); // шрифты + boot + create
    return { ctx, page };
}

// 1. Чистый старт + аудит вёрстки
{
    const { ctx, page } = await newPage();
    const audit = await auditLayout(page);
    fs.writeFileSync(path.join(OUT, 'layout_audit.txt'), audit.violations.join('\n') || 'layout audit: 0 violations');
    console.log('layout violations:', audit.violations.length);
    audit.violations.forEach((v) => console.log('  ' + v));
    await shoot(page, '01_fresh');
    // 2. Серия кликов по блоку (всплывающие цифры, частицы)
    for (let i = 0; i < 10; i++) {
        await page.mouse.click(400, 390);
        await page.waitForTimeout(110);
    }
    await shoot(page, '02_clicks');
    // 3. Покупки: кирка x3 (ряд 0: кнопка в центре x1184, y280)
    for (let i = 0; i < 3; i++) { await page.mouse.click(1184, 280); await page.waitForTimeout(140); }
    await page.waitForTimeout(300);
    await shoot(page, '03_buys');
    await ctx.close();
}

// 4. Скролл списка (сохранение с 12+ улучшениями)
{
    const { ctx, page } = await newPage({ seed: { 'minecraft-clicker-save': SAVE_SEED } });
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
            'minecraft-clicker-save': SAVE_SEED,
            'minecraft-clicker-lastExit': String(exit),
            mockStats: JSON.stringify({ lastExit: exit })
        }
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
    const { ctx, page } = await newPage({ seed: { 'minecraft-clicker-save': JSON.stringify(rich) } });
    await shoot(page, '08_unlock_ready');
    await ctx.close();
}

// 8. Меньший viewport (масштаб FIT)
{
    const { ctx, page } = await newPage({ viewport: { width: 900, height: 506 } });
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
    const { ctx, page } = await newPage({ seed: { 'minecraft-clicker-save': JSON.stringify(deep) } });
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

// 10. Портрет (мобилка 390x844 -> сетка 720x1280): аудит + модалка
{
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
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

fs.writeFileSync(path.join(OUT, 'console_errors.txt'), (consoleErrors._list || []).join('\n') || 'no console errors');
console.log('console errors:', (consoleErrors._list || []).length);
await browser.close();
