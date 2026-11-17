// UI review runner (по воркфлоу web-design-reviewer): снимает состояние игры
// в разных сценариях. Запуск: node scripts/ui-review.mjs — dev-сервер поднимается
// сам и гасится после проверки (если порт уже занят, подключается к чужому).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { withLegacy } from '../lib/forms-flag.mjs';

const { ensureDevServer, releaseDevServer } = createRequire(import.meta.url)('../lib/dev-server.cjs');
const BASE = process.env.BASE_URL || 'http://localhost:5174';
const OUT = path.resolve(process.env.OUT_DIR || 'shots');
fs.mkdirSync(OUT, { recursive: true });

const SAVE_SEED = JSON.stringify({
    version: 2,
    ore: 5000,
    tier: 1,
    stars: 12,
    clicks: 120,
    lifetimeMined: 8000,
    tierEarned: [8000, 5000, 0, 0, 0],
    levels: {
        pickaxe: 13,
        sledge: 0,
        dynamite: 2,
        lucky: 0,
        resonance: 0,
        miner: 5,
        drill: 0,
        excavator: 0,
        factory: 0,
        tech: 0,
        lantern: 0,
        warehouse: 0
    }
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
        if (!game) {
            return { violations: ['window.__GAME не найден'] };
        }

        const items = [];
        const ui = game.scene.getScene('UIScene');
        const listCam = ui ? ui.listCam : null;
        for (const scene of game.scene.getScenes(true)) {
            const walk = (list, parentVisible) => {
                for (const go of list) {
                    if (go.visible === false || parentVisible === false) {
                        if (go.list) {
                            walk(go.list, false);
                        }

                        continue;
                    }

                    if (go.list) {
                        walk(go.list, true);
                        continue;
                    }

                    if (go.type === 'ParticleEmitter' || go.type === 'Graphics' || go.type === 'Rectangle') {
                        continue;
                    }

                    if (go.alpha !== undefined && go.alpha < 0.05) {
                        continue;
                    }

                    try {
                        const b = go.getBounds();
                        if (b.width <= 1 && b.height <= 1) {
                            continue;
                        }

                        let x = b.x,
                            y = b.y,
                            r = b.right,
                            bt = b.bottom;
                        // Ряды живут в мировых координатах и рисуются камерой списка:
                        // переводим в экранные координаты (viewport самой камеры)
                        // и отсеиваем невидимые строки. Тот же перевод для контента
                        // карты/мастерской (П6, как в verify-map П3) — иначе их ряды
                        // сравнивались бы по content-координатам (сдвиг на viewport).
                        let inList = false;
                        if (scene.scene.key === 'UIScene' && ui && ui.listContent && inTree(ui.listContent, go)) {
                            inList = true;
                            const vy = y - listCam.scrollY + listCam.y;
                            if (
                                bt - listCam.scrollY + listCam.y < listCam.y - 2 ||
                                vy > listCam.y + listCam.height + 2
                            ) {
                                continue;
                            } // вне видимой полосы

                            y = vy;
                            bt = bt - listCam.scrollY + listCam.y;
                            x = x - listCam.scrollX + listCam.x;
                            r = r - listCam.scrollX + listCam.x;
                        }

                        if (
                            scene.scene.key === 'UIScene' &&
                            ui &&
                            ui._mapOpen &&
                            ui.mapContent &&
                            inTree(ui.mapContent, go)
                        ) {
                            const cam = ui.mapCam;
                            const vy = y - cam.scrollY + cam.y;
                            if (bt - cam.scrollY + cam.y < cam.y - 2 || vy > cam.y + cam.height + 2) {
                                continue;
                            } // вне вьюпорта карты

                            y = vy;
                            bt = bt - cam.scrollY + cam.y;
                            x = x - cam.scrollX + cam.x;
                            r = r - cam.scrollX + cam.x;
                        }

                        if (
                            scene.scene.key === 'UIScene' &&
                            ui &&
                            ui._craftOpen &&
                            ui.craftContent &&
                            inTree(ui.craftContent, go)
                        ) {
                            const cam = ui.craftCam;
                            const vy = y - cam.scrollY + cam.y;
                            if (bt - cam.scrollY + cam.y < cam.y - 2 || vy > cam.y + cam.height + 2) {
                                continue;
                            } // вне вьюпорта крафта

                            y = vy;
                            bt = bt - cam.scrollY + cam.y;
                            x = x - cam.scrollX + cam.x;
                            r = r - cam.scrollX + cam.x;
                        }

                        // Текстовый бокс выше/ниже глифов на ~3px — приближаем к глифам
                        if (go.type === 'Text') {
                            y += 3;
                            bt -= 3;
                        }

                        items.push({
                            scene: scene.scene.key,
                            kind: go.type,
                            text: (go.text || '').slice(0, 26),
                            tex: (go.texture && go.texture.key) || '',
                            x,
                            y,
                            r,
                            bt,
                            interactive: !!(go.input && go.enabled)
                        });
                    } catch (e) {
                        /* нет bounds — пропускаем */
                    }
                }
            };
            const inTree = (container, go) => {
                if (container === go) {
                    return true;
                }

                if (!container.list) {
                    return false;
                }

                for (const ch of container.list) {
                    if (ch === go || inTree(ch, go)) {
                        return true;
                    }
                }

                return false;
            };
            walk(scene.children.list, true);
        }

        const violations = [];
        const isContained = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.r <= b.r + 1 && a.b <= b.b + 1;
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i],
                    b = items[j];
                if (a.scene !== b.scene) {
                    continue;
                }

                if (isContained(a, b) || isContained(b, a)) {
                    continue;
                }

                const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
                const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
                if (ox > 1 && oy > 1) {
                    violations.push(
                        `OVERLAP [${a.scene}] "${a.text || a.tex || a.kind}" (${Math.round(a.x)},${Math.round(a.y)}) x "${b.text || b.tex || b.kind}" (${Math.round(b.x)},${Math.round(b.y)}) ox=${Math.round(ox)} oy=${Math.round(oy)}`
                    );
                }
            }
        }

        // Ряды улучшений: содержимое не должно вылезать за карточку (запас 5px)
        if (ui && ui.listContent) {
            const cards = ui.listContent.list.filter((go) => go.texture && go.texture.key === 'upgrade_row_card_1');
            for (const card of cards) {
                const cb = card.getBounds();
                const csx = cb.x - listCam.scrollX + listCam.x,
                    csy = cb.y - listCam.scrollY + listCam.y;
                const csrx = cb.right - listCam.scrollX + listCam.x,
                    csby = cb.bottom - listCam.scrollY + listCam.y;
                if (csby < listCam.y - 2 || csy > listCam.y + listCam.height + 2) {
                    continue;
                } // карточка вне экрана

                const inner = { x: csx + 5, y: csy + 5, r: csrx - 5, b: csby - 5 };
                for (const go of ui.listContent.list) {
                    if (go === card || go.type === 'Rectangle') {
                        continue;
                    }

                    const gb = go.getBounds();
                    if (!gb || gb.width === 0) {
                        continue;
                    }

                    if (gb.bottom < cb.y || gb.y > cb.bottom) {
                        continue;
                    }

                    const gy = gb.y - listCam.scrollY + listCam.y,
                        gby = gb.bottom - listCam.scrollY + listCam.y;
                    const gx = gb.x - listCam.scrollX + listCam.x,
                        grx = gb.right - listCam.scrollX + listCam.x;
                    const adj = go.type === 'Text' ? 3 : 0;
                    if (gx < inner.x - 1 || grx > inner.r + 1 || gy + adj < inner.y - 1 || gby - adj > inner.b + 1) {
                        violations.push(
                            `OUTSIDE-CARD row@${Math.round(csy)}: "${go.text || go.texture?.key || go.type}" (${Math.round(gx)},${Math.round(gy)})..(${Math.round(grx)},${Math.round(gby)}) вне зоны (${Math.round(inner.x)},${Math.round(inner.y)})..(${Math.round(inner.r)},${Math.round(inner.b)})`
                        );
                    }
                }
            }
        }

        // Имена рядов: детерминированная проверка ширины, независимо от видимости
        // ряда (длинные имена машин видны только на глубоких тирах и не всегда
        // попадают в сценарии). Лимит — от ширины карточки (row.nameMaxW).
        if (ui && ui.rows) {
            for (const row of ui.rows) {
                if (!row.nameText || !row.nameText.width) {
                    continue;
                }

                if (row.nameText.width > row.nameMaxW + 1) {
                    violations.push(
                        `NAME-TOO-LONG "${row.nameText.text}" width=${Math.round(row.nameText.width)} > ${row.nameMaxW}`
                    );
                }
            }
        }

        return { violations };
    });
}
// Ошибки страниц: одна копилка на ВСЕ сценарии (раньше _list сбрасывался в
// newPage и финальный отчёт видел только последний сценарий — гейт «console
// errors 0» был фиктивен для 9/10 прогонов).
// П6, аудит открытых оверлеев (17/21): полноэкранные панели легитимно перекрывают
// под-UI (задокументированная слепая зона — depth не проверяется), поэтому классы
// «панель оверлея × что-то под ней» выпадают; остальное сравнивается по сигнатуре
// с базой (оверлей закрыт) — нарушение = только НОВЫЙ класс пары (как в П3).
const sig = (v) => v.replace(/\d+(\.\d+)?/g, '#');
const notPanelClass = (v) => !v.includes('modal_panel_metal');
function baseSignatures(violations) {
    return new Set(violations.filter(notPanelClass).map(sig));
}
function newOverlayViolations(violations, base) {
    return violations.filter(notPanelClass).filter((v) => !base.has(sig(v)));
}
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
    page.on('console', (m) => {
        if (m.type() === 'error') {
            bucket.errors.push(`console: ${m.text()}`);
        }
    });
    if (seed) {
        await page.addInitScript((s) => {
            for (const [k, v] of Object.entries(s)) {
                localStorage.setItem(k, v);
            }
        }, seed);
    }

    await page.goto(withLegacy(BASE), { waitUntil: 'load' });
    await page.waitForTimeout(2800); // шрифты + boot + create

    return { ctx, page };
}

// state-модуль в браузере: URL резолвим из resource-entries — dev-сервер отдаёт
// изменённые модули как '/src/state.js?t=...' (прямой import создал бы второй
// экземпляр с дефолтным состоянием).
async function withState(page, fnBody) {
    return page.evaluate(async (body) => {
        const res = performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .find((u) => u.includes('/src/state.js'));
        const m = await import(res);

        return new Function('m', `return (${body})(m);`)(m);
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
    for (let i = 0; i < 3; i++) {
        await page.mouse.click(1176, 318);
        await page.waitForTimeout(140);
    }

    await page.waitForTimeout(300);
    const lvlAfter = await withState(page, 'm => m.gameState.levels.pickaxe');
    if (lvlAfter !== lvlBefore + 3) {
        scenarioFailures.push(
            `03_buys: уровень кирки ${lvlBefore} -> ${lvlAfter}, ожидалось +3 (клик/покупка не работают)`
        );
    }

    await shoot(page, '03_buys');
    await ctx.close();
}

// 4. Скролл списка (сохранение с 12+ улучшениями)
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': SAVE_SEED }, name: '04_list' });
    // daily-модалка перекрывала список/настройки: кадры 04-06 снимали её вместо сценария
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await shoot(page, '04_list_top');
    const auditSeeded = await auditLayout(page);
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_seeded.txt'),
        auditSeeded.violations.join('\n') || 'layout audit (seeded, stars=12): 0 violations'
    );
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
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_modal.txt'),
        auditModal.violations.join('\n') || 'layout audit (modal): 0 violations'
    );
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
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_offline.txt'),
        auditOff.violations.join('\n') || 'layout audit (offline): 0 violations'
    );
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
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await shoot(page, '08_unlock_ready');
    await ctx.close();
}

// 8. Меньший viewport (масштаб FIT)
{
    const { ctx, page } = await newPage({ viewport: { width: 900, height: 506 }, name: '08_viewport900' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await shoot(page, '09_viewport_900');
    await ctx.close();
}

// 9. Глубокие ряды: длинные имена машин (Орбитальная станция, Квантовая лаборатория,
// Гравитационный резак) видны только на глубоких тирах — отдельный сценарий с тиром 6,
// скролл к «Орбитальной станции» (ряд 11) и гейт-анонсу «Квантовой лаборатории» (ряд 12).
{
    const deep = {
        version: 4,
        ore: 5e5,
        tier: 6,
        stars: 0,
        clicks: 500,
        lifetimeMined: 5e6,
        tierEarned: TIERS_SEED_EARNED(),
        tierAnchorRate: 0,
        levels: {
            pickaxe: 20,
            sledge: 5,
            hydraulic: 5,
            plasma: 2,
            miner: 30,
            robotarm: 2,
            drill: 20,
            excavator: 15,
            factory: 10,
            quarry: 8,
            megafactory: 5,
            tech: 2,
            dynamite: 10,
            lucky: 8,
            resonance: 5,
            lantern: 2,
            warehouse: 1
        }
    };
    function TIERS_SEED_EARNED() {
        return Array.from({ length: 12 }, (_, i) => (i <= 6 ? 1e5 : 0));
    }
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': JSON.stringify(deep) }, name: '09_deep' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.mouse.move(1082, 430);
    await page.mouse.wheel(0, 2200); // scrollY ~1100: «Орбитальная» и «Квантовая» целиком в окне 262..664
    await page.waitForTimeout(400);
    const auditDeep = await auditLayout(page);
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_deep.txt'),
        auditDeep.violations.join('\n') || 'layout audit (deep rows, tier 6): 0 violations'
    );
    console.log('deep violations:', auditDeep.violations.length);
    auditDeep.violations.forEach((v) => console.log('  ' + v));
    // Строка тира с длинным названием руды («Аметист») не должна заходить под
    // кнопку мультипокупки (наезд пойман скриншотом игрока — общий аудит слеп
    // к длинным названиям, они видны только на глубоких тирах)
    const tier = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const btnLeft = ui.amountC.x - ui.amountBg.displayWidth / 2;

        return { text: ui.tierLabel.text, right: ui.tierLabel.x + ui.tierLabel.width, btnLeft };
    });
    if (tier.right > tier.btnLeft) {
        scenarioFailures.push(
            `09_deep: строка тира "${tier.text}" заходит под кнопку мультипокупки (right ${Math.round(tier.right)} > btnLeft ${Math.round(tier.btnLeft)})`
        );
    }

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
    if (check.lines !== 5) {
        scenarioFailures.push(
            `12_settings_daily: строк статов ${check.lines}, ожидалось 5 (баф не должен удлинять блок)`
        );
    }

    if (check.gap < 8) {
        scenarioFailures.push(`12_settings_daily: тумблеры наезжают на статы (зазор ${Math.round(check.gap)}px)`);
    }

    if (!check.buff) {
        scenarioFailures.push('12_settings_daily: HUD-таймер бафа пуст на свежем сейве');
    }

    await shoot(page, '12_settings_daily');
    await ctx.close();
}

// 10. Портрет (мобилка 390x844 -> сетка 720x1280): аудит + модалка
{
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, name: '10_portrait' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    const auditP = await auditLayout(page);
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_portrait.txt'),
        auditP.violations.join('\n') || 'layout audit (portrait 390x844): 0 violations'
    );
    console.log('portrait violations:', auditP.violations.length);
    auditP.violations.forEach((v) => console.log('  ' + v));
    await shoot(page, '11_portrait');
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').settingsBtn.emit('pointerdown'));
    await page.waitForTimeout(300);
    await shoot(page, '12_portrait_modal');
    const auditPM = await auditLayout(page);
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_portrait_modal.txt'),
        auditPM.violations.join('\n') || 'layout audit (portrait modal): 0 violations'
    );
    console.log('portrait modal violations:', auditPM.violations.length);
    auditPM.violations.forEach((v) => console.log('  ' + v));
    await ctx.close();
}

// 17 (П6). Карта открыта: 18 узлов (12 тиров + 6 боссов), баннер уровня,
// аудит с фильтром оверлея (база — карта закрыта)
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': SAVE_SEED }, name: '17_map_open' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(300);
    const base17 = baseSignatures((await auditLayout(page)).violations);
    await page.mouse.click(885, 62); // «Карта» (центр кнопки L.hud.mapBtn)
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return {
            open: ui._mapOpen,
            locked: window.__GAME.registry.get('blockLocked'),
            nodes: ui.mapNodes.length,
            tiers: ui.mapNodes.filter((n) => n.kind === 'tier').length,
            bosses: ui.mapNodes.filter((n) => n.kind === 'boss').length,
            camVisible: ui.mapCam.visible
        };
    });
    if (!m.open || !m.locked || !m.camVisible) {
        scenarioFailures.push(`17_map_open: карта не открылась/лок не встал (${JSON.stringify(m)})`);
    }

    if (m.nodes !== 18 || m.tiers !== 12 || m.bosses !== 6) {
        scenarioFailures.push(`17_map_open: узлов ${m.nodes} (тиры ${m.tiers}, боссы ${m.bosses}), ожидалось 18/12/6`);
    }

    // Баннер уровня: fx прибытия рисует его в mapContent (камера карты)
    const banner = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        ui._arriveFx(0);

        return ui.mapContent.list.some((o) => o.type === 'Text' && /^Уровень 1: /.test(o.text));
    });
    if (!banner) {
        scenarioFailures.push('17_map_open: баннер «Уровень 1: …» не найден в mapContent');
    }

    const auditMap = (await auditLayout(page)).violations;
    const newMap = newOverlayViolations(auditMap, base17);
    fs.writeFileSync(
        path.join(OUT, 'layout_audit_map_open.txt'),
        newMap.join('\n') || 'layout audit (map open): 0 новых нарушений'
    );
    console.log('map open new violations:', newMap.length);
    newMap.forEach((v) => console.log('  ' + v));
    if (newMap.length) {
        scenarioFailures.push(`17_map_open: новые нарушения вёрстки: ${newMap.join(' | ')}`);
    }

    await shoot(page, '17_map_open');
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeMap());
    await ctx.close();
}

// 18 (П6). Спуск с анимацией и skip по dim: мгновенное прибытие (scroll на цели,
// баннер), затем мгновенный closeMap-кадр без остаточных твинов/лока.
// Сид v5 с явным тиром: SAVE_SEED тут не годится — миграция v2->v5 сдвигает
// тир (1 -> 2), и цена спуска уходит за выданную руду (клик не срабатывает).
const V5_SEED = JSON.stringify({
    version: 5,
    ore: 5000,
    tier: 1,
    stars: 0,
    clicks: 50,
    lifetimeMined: 5e5,
    tierEarned: [5e5, 5000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tierAnchorRate: 50,
    tutorialDone: true,
    bossesDefeated: {},
    components: {},
    artifacts: [],
    items: {},
    crafting: null,
    levels: {
        pickaxe: 12,
        miner: 10,
        dynamite: 0,
        lucky: 0,
        resonance: 0,
        focuslens: 0,
        magnet: 0,
        robotarm: 0,
        drill: 0,
        tech: 0
    }
});
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': V5_SEED }, name: '18_map_anim_skip' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(200);
    await withState(page, 'm => { m.addOre(200000); }'); // цена спуска тира 1 ~29K
    await page.waitForTimeout(200);
    const unlockPt = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return {
            x: ui.unlockBtn.x + ui.unlockBtn.displayWidth / 2,
            y: ui.unlockBtn.y + ui.unlockBtn.displayHeight / 2
        };
    });
    await page.mouse.click(unlockPt.x, unlockPt.y);
    await page.waitForTimeout(300); // анимация 1400 мс — skip раньше её конца
    const animOn = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return { open: ui._mapOpen, anim: !!ui._mapAnim };
    });
    if (!animOn.open || !animOn.anim) {
        scenarioFailures.push(`18_map_anim_skip: анимация спуска не запустилась (${JSON.stringify(animOn)})`);
    }

    await page.mouse.click(150, 400); // тап по dim вне панели — skip
    await page.waitForTimeout(150);
    const skipped = await withState(
        page,
        `m => {
        const ui = window.__GAME.scene.getScene('UIScene');
        return {
            tier: m.gameState.tier,
            anim: !!ui._mapAnim,
            scroll: ui.mapCam.scrollY,
            target: ui._mapScrollTarget(ui._findNodeIndex(m.gameState.tier))
        };
    }`
    );
    if (skipped.anim) {
        scenarioFailures.push('18_map_anim_skip: тап по dim не остановил анимацию');
    }

    if (skipped.scroll !== skipped.target) {
        scenarioFailures.push(`18_map_anim_skip: scrollY ${skipped.scroll} != цель ${skipped.target}`);
    }

    if (skipped.tier !== 2) {
        scenarioFailures.push(`18_map_anim_skip: тир после спуска ${skipped.tier}, ожидался 2`);
    }

    await shoot(page, '18_map_anim_skip');
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeMap());
    await page.waitForTimeout(100);
    const afterClose = await page.evaluate(() => ({
        open: window.__GAME.scene.getScene('UIScene')._mapOpen,
        locked: window.__GAME.registry.get('blockLocked')
    }));
    if (afterClose.open || afterClose.locked) {
        scenarioFailures.push(`18_map_anim_skip: мгновенный closeMap не снял лок (${JSON.stringify(afterClose)})`);
    }

    await shoot(page, '18b_map_closed_instant');
    await ctx.close();
}

// 19 (П6). Бой с боссом: HP-бар, слот бомбы (через dev-кнопку «Бомба +5»),
// урон по спрайту, ретрит снимает бой. Аудит не гоняем: оверлей в GameScene
// уже проверен геометрией verify-boss (P-чеки), здесь — состояния и скриншот.
// R2 (доработка): бой НЕ держит blockLocked — locked=false на весь бой.
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': SAVE_SEED }, name: '19_boss_fight' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(200);
    await page.keyboard.press('Backquote');
    await page.click('#dev-admin-panel button:has-text("Бомба +5")');
    await page.click('#dev-admin-panel button:has-text("Босс: Медный страж")');
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(400);
    const f = await page.evaluate(() => {
        const gs = window.__GAME.scene.getScene('GameScene');

        return {
            id: gs.boss && gs.boss.def.id,
            hp: gs.boss && gs.boss.hp,
            maxHp: gs.boss && gs.boss.maxHp,
            active: window.__GAME.registry.get('bossActive'),
            locked: window.__GAME.registry.get('blockLocked'),
            bar: !!gs.bossBar,
            slots: gs.bossItems ? gs.bossItems.map((s) => ({ id: s.id, cnt: s.cnt.text })) : null
        };
    });
    if (!f.id || !f.active || f.locked !== false || !f.bar) {
        scenarioFailures.push(`19_boss_fight: бой не активен (${JSON.stringify(f)})`);
    }

    if (f.hp !== f.maxHp) {
        scenarioFailures.push(`19_boss_fight: HP при старте ${f.hp}/${f.maxHp}`);
    }

    if (!f.slots || !f.slots.some((s) => s.id === 'item_bomb')) {
        scenarioFailures.push(`19_boss_fight: слот бомбы не найден (${JSON.stringify(f.slots)})`);
    }

    // Геометрия секции «Снаряжение» (пойманный скриншотом игрока наезд текстов
    // и кнопок при addNine-карточке 10px + setDisplaySize): карточка на ширину
    // вьюпорта, тексты не вылезают за кнопки, кнопки в нижнем ряду без наезда
    const g = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const gs = window.__GAME.scene.getScene('GameScene');
        const r = ui.gearRows && ui.gearRows[0];
        if (!r) {
            return null;
        }

        const c = (o) => ({
            x: o.x,
            y: o.y,
            w: o.displayWidth,
            h: o.displayHeight,
            right: o.x + o.displayWidth / 2,
            bottom: o.y + o.displayHeight / 2,
            top: o.y - o.displayHeight / 2,
            left: o.x - o.displayWidth / 2
        });

        return {
            card: r._geom || { x: 0, y: 0, w: 0, h: 0 },
            rowH: ui.L.gear.rowH,
            name: { left: r.name.x, right: r.name.x + r.name.width },
            stock: { left: r.stock.x - r.stock.width },
            desc: { bottom: r.desc.y + r.desc.height },
            buy: { ...c(r.buyBtn), lbl: r.buyLbl.text },
            use: c(r.useBtn),
            icon: c(r.icon),
            vw: { x: ui.L.viewport.x, w: ui.L.viewport.w },
            // HUD: статы не наезжают на «Карта», звёзды (под баром справа) — на строку бафов
            statsRight: Math.round(ui.statsLine.x + ui.statsLine.width),
            statsX: Math.round(ui.statsLine.x),
            statsSize: ui.statsLine.style ? ui.statsLine.style.fontSize : null,
            statsText: ui.statsLine.text,
            mapBtnLeft: Math.round(ui.L.hud.mapBtn.x),
            starsLeft: Math.round(ui.starsText.x - ui.starsText.width),
            buffRight: Math.round(ui.buffLine.x + ui.buffLine.width),
            // Полоса живучести шахтёра — ОБЪЕКТ GameScene (не UIScene)
            playerBarText: gs.playerHpText ? gs.playerHpText.text : null,
            playerBarVis: gs.playerBar ? gs.playerBar.visible : false
        };
    });
    if (!g) {
        scenarioFailures.push('19_boss_fight: секция «Снаряжение» не построена');
    } else {
        if (g.statsRight > g.mapBtnLeft - 8) {
            scenarioFailures.push(
                `19_boss_fight: статы HUD наезжают на «Карта» (${JSON.stringify({ statsRight: g.statsRight, statsX: g.statsX, statsSize: g.statsSize, statsText: g.statsText, mapBtnLeft: g.mapBtnLeft })})`
            );
        }

        if (g.buffRight > 0 && g.starsLeft - g.buffRight < 12) {
            scenarioFailures.push(
                `19_boss_fight: звёзды наезжают на строку бафов (${JSON.stringify({ starsLeft: g.starsLeft, buffRight: g.buffRight })})`
            );
        }

        if (!g.playerBarVis || !/ты: [\d.KMB]+ \/ [\d.KMB]+/.test(g.playerBarText || '')) {
            scenarioFailures.push(`19_boss_fight: полоса живучести шахтёра не видна (${g.playerBarText})`);
        }

        // Высота карточки — из спеки раскладки (L.gear.rowH); ширина — врезка минус
        // боковые врезки (cardInset * 2 = 8)
        if (Math.abs(g.card.w - (g.vw.w - 8)) > 2 || Math.abs(g.card.h - g.rowH) > 2) {
            scenarioFailures.push(
                `19_boss_fight: карточка снаряжения не на ширину вьюпорта (${JSON.stringify(g.card)})`
            );
        }

        // Карточка центрирована во вьюпорте (сдвиг на полширины = вылезание за край)
        if (Math.abs((g.card.left + g.card.right) / 2 - (g.vw.x + g.vw.w / 2)) > 2) {
            scenarioFailures.push(`19_boss_fight: карточка смещена относительно вьюпорта (${JSON.stringify(g.card)})`);
        }

        if (g.name.right > g.card.right - 8 || g.stock.right > g.card.right - 8) {
            scenarioFailures.push(
                `19_boss_fight: имя/запас вылезают за карточку (${JSON.stringify({ nameRight: g.name.right, stockRight: g.card ? g.card.right - (g.card.right - g.stock.right) : 0, cardRight: Math.round(g.card.right) })})`
            );
        }

        if (g.desc.bottom > g.buy.top - 4) {
            scenarioFailures.push(
                `19_boss_fight: описание наезжает на кнопки (${JSON.stringify({ descBottom: Math.round(g.desc.bottom), buyTop: Math.round(g.buy.top) })})`
            );
        }

        if (g.buy.right > g.use.left - 2 || g.use.right > g.card.right - 8 || g.buy.left < g.card.left + 8) {
            scenarioFailures.push(
                `19_boss_fight: кнопки снаряжения наезжают/вылезают (${JSON.stringify({ buyRight: Math.round(g.buy.right), useLeft: Math.round(g.use.left), cardRight: Math.round(g.card.right) })})`
            );
        }

        if (g.icon.right > g.name.left - 6 || g.icon.left < g.card.left + 4) {
            scenarioFailures.push(
                `19_boss_fight: иконка вне ниши карточки (${JSON.stringify({ icon: g.icon, cardLeft: Math.round(g.card.left) })})`
            );
        }

        if (!/^Купить · /.test(g.buy.lbl)) {
            scenarioFailures.push(`19_boss_fight: подпись кнопки покупки без цены (${g.buy.lbl})`);
        }
    }

    await shoot(page, '19_boss_fight');
    await page.mouse.click(400, 400); // спрайт босса в центре блока
    await page.waitForTimeout(200);
    const hp2 = await page.evaluate(() => window.__GAME.scene.getScene('GameScene').boss.hp);
    if (!(hp2 < f.maxHp)) {
        scenarioFailures.push(`19_boss_fight: клик по спрайту не снял HP (${hp2}/${f.maxHp})`);
    }

    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').retreatBoss());
    await page.waitForTimeout(300);
    const off = await page.evaluate(() => ({
        active: window.__GAME.registry.get('bossActive'),
        locked: window.__GAME.registry.get('blockLocked'),
        block: window.__GAME.scene.getScene('GameScene').block.visible
    }));
    if (off.active || off.locked || !off.block) {
        scenarioFailures.push(`19_boss_fight: ретрит не вернул бой/блок/лок (${JSON.stringify(off)})`);
    }

    await ctx.close();
}

// 20 (П6). Награда за босса: модалка с баунти, компонентом и артефактом;
// «Забрать» закрывает окно и снимает лок, артефакт в коллекции
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': SAVE_SEED }, name: '20_boss_reward' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForTimeout(200);
    await page.keyboard.press('Backquote');
    await page.click('#dev-admin-panel button:has-text("Босс: Медный страж")');
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__GAME.scene.getScene('GameScene').killBoss());
    await page.waitForTimeout(1000); // твин гибели 600 мс + grantBossKill + ивент
    const r = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');

        return {
            open: ui._bossRewardOpen,
            visible: ui.bossRewardModal.visible,
            bounty: ui.bossRewardBounty.text,
            texts: ui.bossRewardComps.list.filter((o) => o.text).map((o) => o.text),
            locked: window.__GAME.registry.get('blockLocked')
        };
    });
    if (!r.open || !r.visible || !r.locked) {
        scenarioFailures.push(`20_boss_reward: модалка не показана (${JSON.stringify(r)})`);
    }

    if (!/^Баунти: \+/.test(r.bounty)) {
        scenarioFailures.push(`20_boss_reward: строка баунти «${r.bounty}»`);
    }

    if (!r.texts.some((t) => /^Ржавый лом ×\d+$/.test(t))) {
        scenarioFailures.push(`20_boss_reward: дроп компонента не найден (${r.texts.join('; ')})`);
    }

    if (!r.texts.includes('Тотем шахтёра')) {
        scenarioFailures.push(`20_boss_reward: артефакт в награде не найден (${r.texts.join('; ')})`);
    }

    await shoot(page, '20_boss_reward');
    await page.mouse.click(640, 510); // «Забрать»
    await page.waitForTimeout(300);
    const done = await withState(
        page,
        `m => ({
        has: m.gameState.artifacts.includes('art_miner_totem'),
        open: window.__GAME.scene.getScene('UIScene')._bossRewardOpen,
        locked: window.__GAME.registry.get('blockLocked')
    })`
    );
    if (!done.has) {
        scenarioFailures.push('20_boss_reward: артефакт не попал в коллекцию');
    }

    if (done.open || done.locked) {
        scenarioFailures.push(`20_boss_reward: «Забрать» не закрыло окно/лок (${JSON.stringify(done)})`);
    }

    await ctx.close();
}

// 21 (П6). Мастерская (DOM-слой): шапка компонентов (+100 через dev-кнопку),
// три секции, сетка артефактов (все приглушены с подписью источника).
// Вёрстку меряет ui:check:dom; здесь — сценарий + golden-снимок страницы.
{
    const { ctx, page } = await newPage({ seed: { 'ore-rush-save': SAVE_SEED }, name: '21_craft_open' });
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').hideDailyModal());
    await page.waitForFunction(() => !!window.__DOM_CRAFT, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Backquote');
    await page.click('#dev-admin-panel button:has-text("Все компоненты +100")');
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(300);
    await page.mouse.click(1007, 62); // «Крафт» (центр кнопки L.hud.craftBtn)
    await page.waitForFunction(() => window.__DOM_CRAFT.isOpen(), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    const c = await page.evaluate(() => {
        const ui = window.__GAME.scene.getScene('UIScene');
        const text = (el) => (el ? el.textContent.trim() : '');

        return {
            open: window.__DOM_CRAFT.isOpen(),
            locked: window.__GAME.registry.get('blockLocked'),
            header: [...document.querySelectorAll('[data-dom-chips] .dom-chip')].map((chip) =>
                text(chip.lastElementChild)
            ),
            sections: [...document.querySelectorAll('[data-dom-scroll] .dom-section')]
                .map((h) => text(h))
                .filter((t) => ['Активируемые', 'Рецепты', 'Артефакты'].some((s) => t.startsWith(s))),
            items: document.querySelectorAll('[data-dom-list="items"] [data-row]').length,
            recipes: document.querySelectorAll('[data-dom-list="recipes"] [data-row]').length,
            arts: document.querySelectorAll('[data-dom-list="artifacts"] [data-art]').length,
            dim: document.querySelectorAll('[data-dom-list="artifacts"] .dom-art.is-owned').length,
            srcs: [...document.querySelectorAll('[data-dom-list="artifacts"] .dom-line')].map(text)
        };
    });
    if (!c.open || !c.locked) {
        scenarioFailures.push(`21_craft_open: мастерская не открылась/лок не встал (${JSON.stringify(c)})`);
    }

    if (c.header.join(',') !== '100,100,100,100,100') {
        scenarioFailures.push(`21_craft_open: шапка не показала +100 (${c.header.join(',')})`);
    }

    if (c.sections.length !== 3) {
        scenarioFailures.push(`21_craft_open: секции (${c.sections.join(', ')})`);
    }

    if (c.items !== 7 || c.recipes !== 10 || c.arts !== 9) {
        scenarioFailures.push(
            `21_craft_open: ряды ${c.items}/рецепты ${c.recipes}/артефакты ${c.arts}, ожидалось 7/10/9`
        );
    }

    if (c.dim !== 0) {
        scenarioFailures.push(`21_craft_open: приглушено ${c.dim} ячеек, ожидалось 0 (артефактов нет)`);
    }

    if (!c.srcs.every((s) => s === 'Скрафти: рецепт' || /^Босс: /.test(s))) {
        scenarioFailures.push(`21_craft_open: подписи источников некорректны (${c.srcs.join('; ')})`);
    }

    fs.writeFileSync(
        path.join(OUT, 'layout_audit_craft_open.txt'),
        'мастерская — DOM-слой: вёрстка проверяется npm run ui:check:dom'
    );
    await shoot(page, '21_craft_open');
    await page.evaluate(() => window.__GAME.scene.getScene('UIScene').closeCraft());
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
