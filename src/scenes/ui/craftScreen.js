import Phaser from 'phaser';
import {
    gameState, fmt, BOSSES, COMPONENTS, ARTIFACTS, ITEMS, CRAFT_RECIPES, useItem, canCraft, startCraft, canClaimCraft, claimCraft, getItemPrice, buyItem
} from '../../state.js';
import { FONT, addImg, addImgC, makeLabel, fitFontSize, setHitRect, addScreenDim, DIM_ALPHA, addModalContainer } from '../../ui/uiKit.js';
import { TEXT, DEPTH, TEX, HIT, REG, FONT_SIZE, SPACE } from '../../ui/theme.js';
import { playSfx } from '../../sfx.js';

export const craftScreenMethods = {
    buildCraftScreen() {
        this.craftDim = addScreenDim(this, DIM_ALPHA.screen)
            .setDepth(DEPTH.screenDim).setVisible(false).setInteractive();
        // stopPropagation dim'а гасит scene-level pointerdown — старт драга здесь
        this.craftDim.on('pointerdown', (pointer, lx, ly, event) => {
            this.startCraftDrag(pointer);
            event.stopPropagation();
        });

        this.craftRoot = addModalContainer(this).setDepth(DEPTH.screen).setVisible(false);
        this.craftPanel = addImgC(this, 0, 0, TEX.modalPanel, 560, 600);
        this.craftTitle = makeLabel(this, 0, -232, 'Мастерская', FONT_SIZE.display, TEXT.cream).setOrigin(0.5);
        this.craftClose = addImgC(this, 220, -228, TEX.closeButton, 44, 44);
        setHitRect(this.craftClose, ...HIT.closeSquare);
        this.craftClose.on('pointerdown', () => this.closeCraft());
        this.craftRoot.add([this.craftPanel, this.craftTitle, this.craftClose]);

        // Шапка (фиксированная, не скроллится): 5 компонентов — иконка + счётчик.
        // Дети craftRoot рендерит только main (craftCam/mapCam проигнорировали
        // корень при создании) — отдельные ignore не нужны.
        this.buildCraftHeader();

        this.craftContent = this.add.container(0, 0).setDepth(DEPTH.screenContent).setVisible(false);
        this.cameras.main.ignore(this.craftContent);

        this.craftCam = this.cameras.add(400, 156, 480, 408, false, 'craftCam');
        this.craftCam.setRoundPixels(true);
        const others = this.children.list.filter((o) => o !== this.craftContent);
        this.craftCam.ignore(others);
        this.craftCam.setVisible(false);
        this._craftView = { x: 400, y: 156, w: 480, h: 408 };
        this._craftContentH = 0;
        this._craftMaxScroll = 0;

        this.input.on('wheel', (pointer, over, dx, dy) => {
            if (!this._craftOpen) return;
            const v = this._craftView;
            if (pointer.x >= v.x - 10 && pointer.x <= v.x + v.w + 10
                && pointer.y >= v.y - 10 && pointer.y <= v.y + v.h + 10) {
                this.craftCam.scrollY = Phaser.Math.Clamp(this.craftCam.scrollY + dy * 0.5, 0, this._craftMaxScroll);
            }
        });
        this.setupCraftDrag();
        this._craftRowsW = this._craftView.w;
        this.buildCraftContent();
    },

    // Шапка мастерской: 5 компонентов, кегли/иконки/шаг колонок по масштабу;
    // пересобирается при смене s (applyLayout)
    buildCraftHeader() {
        const s = this._adaptiveScale || 1;
        const k = Math.min(s, 1.6);
        if (!this.craftHeader) {
            this.craftHeader = this.add.container(0, 0);
            this.craftRoot.add(this.craftHeader);
        } else {
            this.craftHeader.removeAll(true);
        }
        this.craftCompRow = [];
        const slotW = Math.round(64 * k);
        const iconSize = Math.round(22 * k);
        const fSize = Math.max(11, Math.round(FONT_SIZE.captionLg * Math.min(s, 1.35)));
        const compRowStartX = -(COMPONENTS.length * slotW) / 2;
        COMPONENTS.forEach((def, i) => {
            const sx = compRowStartX + i * slotW;
            const icon = this.add.image(0, 0, def.icon);
            this.placeIcon(icon, def.icon, sx + Math.round(11 * k), 0, iconSize);
            const t = makeLabel(this, sx + Math.round(26 * k), 0, '0', fSize, TEXT.bright).setOrigin(0, 0.5);
            this.craftHeader.add([icon, t]);
            this.craftCompRow.push({ id: def.id, text: t });
        });
        // UX: подсказка, откуда берутся компоненты — «список штуков» сам по себе
        // ничего не объяснял (вопрос игрока). Портрет: 24px и две строки —
        // однострочная 16px читалась как серая полоска (ревью читаемости)
        const hintText = this.L.portrait
            ? 'компоненты падают с боссов:\nКарта → «Сразиться!»'
            : 'компоненты падают с боссов: Карта → «Сразиться!»';
        const hintSize = this.L.portrait ? FONT_SIZE.section : Math.max(10, Math.round(FONT_SIZE.caption * Math.min(s, 1.35)));
        const hint = makeLabel(this, 0, Math.round(26 * k), hintText, hintSize, '#d0d0d0', { align: 'center' }).setOrigin(0.5);
        this.craftHeader.add(hint);
    },

    // Наполнение мастерской: три секции рядами h84 на upgrade_row_card_1 (шаг 90).
    // Пересобирается только при смене ширины вьюпорта (портрет/ландшафт);
    // текущие значения обновляет refreshCraftUi по диффу (паттерн _buffLineText).
    buildCraftContent() {
        if (this.L.portrait) return this.buildCraftContentPortrait();
        this._craftFlow = null; // портретная flow-раскладка не активна
        const w = this._craftView.w;
        const s = this._adaptiveScale || 1;
        const f = w / 835;
        const iconCX = Math.round(118 * f);
        const textX = Math.round(186 * f) + 34;
        const iconSize = Math.round(40 * Math.min(s, 1.6));
        const rowH = Math.round(96 * s);
        const step = rowH + 6;
        // Ландшафтные размеры кнопок (портрет — buildCraftContentPortrait)
        const btnW = Phaser.Math.Clamp(Math.round(84 * s), 64, 120);
        const btnH = Phaser.Math.Clamp(Math.round(32 * Math.min(s, 1.5)), 32, 48);
        const btnCX = w - 12 - btnW / 2;
        const btnCY = Math.round(48 * s);
        const buyCY = Math.round(rowH * 0.26);
        const actCY = Math.round(rowH * 0.72);
        const textMaxW = btnCX - btnW / 2 - 8 - textX;
        const nameSize = Math.max(9, Math.round(FONT_SIZE.label * s));
        const subSize = Math.max(9, Math.round(FONT_SIZE.caption * s));
        const cellW = Math.floor((w - 10) / 2);

        this.craftContent.removeAll(true);
        this.craftItemRows = {};
        this.craftRecipeRows = {};
        this.craftArtCells = {};
        let y = Math.round(8 * s);

        const header = (title) => {
            const t = makeLabel(this, 2, y, title, Math.max(11, Math.round(FONT_SIZE.stat * s)), TEXT.cream).setOrigin(0, 0);
            this.craftContent.add(t);
        };

        header('Активируемые');
        y += Math.round(36 * s);
        for (const def of ITEMS) {
            const rc = this.add.container(0, y);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, rowH);
            const icon = this.add.image(0, 0, def.id);
            this.placeIcon(icon, def.id, iconCX, btnCY, iconSize);
            const name = makeLabel(this, textX, Math.round(10 * s), def.name, nameSize, TEXT.white).setOrigin(0, 0);
            fitFontSize(name, nameSize, textMaxW, 9);
            const sub = makeLabel(this, textX, Math.round(34 * s), `эффект: ${def.desc}`, subSize, TEXT.soft).setOrigin(0, 0);
            fitFontSize(sub, subSize, textMaxW, 9);
            const hint = makeLabel(this, textX, Math.round(62 * s), '', subSize, TEXT.gold).setOrigin(0, 0);
            const btn = this.add.image(btnCX, actCY, TEX.button).setDisplaySize(btnW, btnH);
            setHitRect(btn, ...HIT.button);
            const btnText = makeLabel(this, btnCX, actCY, 'Активировать', subSize, TEXT.white).setOrigin(0.5);
            fitFontSize(btnText, subSize, btnW - SPACE.md, 8);
            const buyBtn = this.add.image(btnCX, buyCY, TEX.button).setDisplaySize(btnW, btnH);
            setHitRect(buyBtn, ...HIT.button);
            const buyBtnText = makeLabel(this, btnCX, buyCY, '', subSize, TEXT.white).setOrigin(0.5);
            rc.add([card, icon, name, sub, hint, btn, btnText, buyBtn, buyBtnText]);
            this.craftContent.add(rc);
            btn.on('pointerdown', (p) => this.startCraftDrag(p));
            btn.on('pointerup', () => {
                if (this._craftDragging) return;
                this.activateItemRow(def);
            });
            buyBtn.on('pointerdown', (p) => this.startCraftDrag(p));
            buyBtn.on('pointerup', () => {
                if (this._craftDragging) return;
                if (buyItem(def.id)) {
                    playSfx(this, 'purchase');
                } else {
                    this.setItemRowError(def, (gameState.items[def.id] || 0) >= def.stackMax ? 'стак полон' : 'не хватает руды');
                }
                this.refreshUi();
            });
            this.craftItemRows[def.id] = { def, rc, icon, name, sub, hint, btn, btnText, buyBtn, buyBtnText, _key: null, _hintKey: null, _err: null, _errUntil: 0, _hintSize: subSize, _hintMaxW: textMaxW, _buySize: subSize, _buyMaxW: btnW - SPACE.md };
            y += step;
        }

        y += Math.round(14 * s);
        header('Рецепты');
        const warn = makeLabel(this, w - 2, y + 3, 'крафт нельзя отменить', Math.max(9, Math.round(FONT_SIZE.captionSm * s)), TEXT.bad).setOrigin(1, 0);
        this.craftContent.add(warn);
        y += Math.round(36 * s);
        for (const recipe of CRAFT_RECIPES) {
            const rc = this.add.container(0, y);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, rowH);
            const resultKey = recipe.result.id;
            const icon = this.add.image(0, 0, resultKey);
            this.placeIcon(icon, resultKey, iconCX, btnCY, iconSize);
            const resultDef = recipe.result.kind === 'item'
                ? ITEMS.find((i) => i.id === recipe.result.id)
                : ARTIFACTS.find((a) => a.id === recipe.result.id);
            const name = makeLabel(this, textX, Math.round(10 * s), resultDef.name, Math.max(9, Math.round(FONT_SIZE.captionLg * s)), TEXT.white).setOrigin(0, 0);
            fitFontSize(name, Math.round(FONT_SIZE.captionLg * s), textMaxW, 9);
            const costY = Math.round(54 * s);
            const desc = makeLabel(this, textX, Math.round(32 * s), `Получишь: ${resultDef.desc}`, subSize, TEXT.good).setOrigin(0, 0);
            fitFontSize(desc, subSize, textMaxW, 9);
            const needLbl = makeLabel(this, textX, costY, 'Нужно:', Math.max(9, Math.round(FONT_SIZE.captionSm * s)), TEXT.soft).setOrigin(0, 0.5);
            const costPairs = [];
            const pairNodes = [];
            const pairIcon = Math.round(16 * Math.min(s, 1.5));
            const pairFont = Math.max(9, Math.round(FONT_SIZE.caption * s));
            let cx = textX + needLbl.width + Math.round(12 * s);
            for (const compId of Object.keys(recipe.cost)) {
                const compDef = COMPONENTS.find((c) => c.id === compId);
                const cIcon = this.add.image(0, 0, compDef.icon);
                this.placeIcon(cIcon, compDef.icon, cx + Math.round(8 * s), costY, pairIcon);
                const cText = makeLabel(this, cx + Math.round(20 * s), costY, String(recipe.cost[compId]), pairFont, TEXT.gold).setOrigin(0, 0.5);
                pairNodes.push(cIcon, cText);
                costPairs.push({ id: compId, text: cText });
                cx += Math.round(20 * s) + cText.width + Math.round(12 * s);
            }
            const footMaxW = btnCX - btnW / 2 - 8 - textX;
            const footSize = Math.max(9, Math.round(FONT_SIZE.captionSm * s));
            const srcTxt = recipe.result.kind === 'artifact'
                ? 'крафт'
                : `дроп: ${[...new Set(Object.keys(recipe.cost).map((compId) => (BOSSES.find((b) => b.drops[compId]) || {}).name).filter(Boolean))].join(', ')}`;
            const status = makeLabel(this, textX, Math.round(78 * s), '', footSize, TEXT.bad).setOrigin(0, 0);
            const src = makeLabel(this, textX, Math.round(78 * s), srcTxt, footSize, TEXT.dim).setOrigin(0, 0);
            fitFontSize(src, footSize, footMaxW, 9);
            const btn = this.add.image(btnCX, btnCY, TEX.button).setDisplaySize(btnW, btnH);
            setHitRect(btn, ...HIT.button);
            const label = recipe.craftMs === 0 ? 'Создать' : `Крафт ${Math.round(recipe.craftMs / 60000)} мин`;
            const btnText = makeLabel(this, btnCX, btnCY, label, subSize, TEXT.white).setOrigin(0.5);
            fitFontSize(btnText, subSize, btnW - SPACE.md, 8);
            rc.add([card, icon, name, desc, needLbl, status, src, btn, btnText]);
            // Пары стоимости ПОСЛЕ карточки: раньше они добавлялись до неё и
            // перекрывались карточкой целиком («Нужно:» с пустотой — скриншот
            // игрока); порядок в контейнере = порядок отрисовки
            for (const n of pairNodes) rc.add(n);
            this.craftContent.add(rc);
            btn.on('pointerdown', (p) => this.startCraftDrag(p));
            btn.on('pointerup', () => {
                if (this._craftDragging) return;
                const c = gameState.crafting;
                if (c && c.recipeId === recipe.id) {
                    if (canClaimCraft()) {
                        if (claimCraft()) playSfx(this, 'purchase');
                    }
                } else if (!c && !(recipe.result.kind === 'artifact' && gameState.artifacts.includes(recipe.result.id))) {
                    if (startCraft(recipe.id)) {
                        playSfx(this, 'purchase');
                        if (recipe.craftMs === 0) claimCraft();
                    }
                }
                this.refreshUi();
            });
            this.craftRecipeRows[recipe.id] = { recipe, rc, icon, name, desc, needLbl, costPairs, status, src, btn, btnText, label, resultDef, _key: null, _footTxt: null, _btnSize: subSize, _btnMaxW: btnW - SPACE.md, _footSize: footSize, _footMaxW: footMaxW };
            y += step;
        }

        y += Math.round(14 * s);
        header('Артефакты');
        y += Math.round(36 * s);
        ARTIFACTS.forEach((def, i) => {
            const col = i % 2;
            const rowIdx = Math.floor(i / 2);
            const rc = this.add.container(col * (cellW + 10), y + rowIdx * step);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', cellW, rowH);
            // Иконка по ЦЕНТРУ ряда: прежние позиции были закапплены на 1.4,
            // а rowH растёт с полным s (1.8) — иконки «уезжали» вверх (ревью)
            const iconSize = Math.round(40 * Math.min(s, 1.6));
            const iconX = Math.round(34 * Math.min(s, 1.6));
            const icon = this.add.image(0, 0, def.id);
            this.placeIcon(icon, def.id, iconX, Math.round(rowH / 2), iconSize);
            const nameX = iconX + Math.round(iconSize / 2) + 12;
            const name = makeLabel(this, nameX, Math.round(8 * s), def.name, Math.max(9, Math.round(FONT_SIZE.caption * s)), TEXT.gold).setOrigin(0, 0);
            fitFontSize(name, Math.round(FONT_SIZE.caption * s), cellW - nameX - 8, 9);
            const line = makeLabel(this, nameX, Math.round(30 * s), '', Math.max(9, Math.round(FONT_SIZE.caption * s)), TEXT.good, { wordWrap: { width: cellW - nameX - 14 } }).setOrigin(0, 0);
            rc.add([card, icon, name, line]);
            this.craftContent.add(rc);
            setHitRect(card, ...HIT.rowCard);
            card.on('pointerdown', (p) => this.startCraftDrag(p));
            card.on('pointerup', () => {
                if (this._craftDragging) return;
                if (gameState.artifacts.includes(def.id)) return;
                const cellObj = this.craftArtCells[def.id];
                if (!cellObj) return;
                const boss = BOSSES.find((b) => b.id === def.source);
                cellObj._hintText = boss ? `Получишь у босса: ${boss.name}` : 'Скрафти: рецепт';
                cellObj._hintUntil = Date.now() + 2000;
                this.refreshUi();
            });
            this.craftArtCells[def.id] = { def, rc, icon, name, line, _owned: null, _hintText: '', _hintUntil: 0 };
        });
        y += Math.ceil(ARTIFACTS.length / 2) * step;

        this._craftContentH = y + Math.round(52 * s);
        this._craftMaxScroll = Math.max(0, this._craftContentH - this._craftView.h);
        this.craftCam.scrollY = Phaser.Math.Clamp(this.craftCam.scrollY, 0, this._craftMaxScroll);
    },

    _mmss(msLeft) {
        const sec = Math.max(0, Math.ceil(msLeft / 1000));
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    },

    // Измерение высоты строки шрифта (для flow-раскладки портретной мастерской)
    // Высота одной строки шрифта (кеш по размеру; сбрасывается при загрузке webfont)
    craftMeasureLH(size) {
        this._craftLHCache = this._craftLHCache || {};
        if (this._craftLHCache[size]) return this._craftLHCache[size];
        if (!this._craftMeasureText) {
            this._craftMeasureText = this.add.text(0, -2000, 'Ag', {
                fontFamily: FONT, fontSize: `${FONT_SIZE.cardTitle}px`, color: TEXT.white, resolution: 2
            }).setVisible(false);
        }
        this._craftMeasureText.setFontSize(size);
        this._craftLHCache[size] = Math.ceil(this._craftMeasureText.height);
        return this._craftLHCache[size];
    },

    // Надёжная высота текста: max(Text.height, строки × высота строки + lineSpacing).
    // Text.height может отставать (текст отрисован fallback-шрифтом/до смены wrap),
    // а число строк всегда берётся из getWrappedText по актуальному wrap-стилю.
    craftTextH(t) {
        const px = parseInt(t.style.fontSize, 10) || FONT_SIZE.caption;
        const lh = this.craftMeasureLH(px);
        const lines = t.text ? Math.max(1, t.getWrappedText(t.text).length) : 1;
        const byLines = lines * lh + (lines - 1) * (t.lineSpacing || 0);
        return Math.ceil(Math.max(t.height, byLines));
    },

    // Стекинг flow-записей мастерской с индекса i; якорь скролла — верхняя
    // видимая запись (рост ряда над экраном не сдвигает видимое содержимое)
    restackCraftFrom(i) {
        const flow = this._craftFlow || [];
        if (!flow.length) return;
        const anchor = flow.find((e) => e.y + e.h > this.craftCam.scrollY);
        const anchorOld = anchor ? anchor.y : 0;
        let y = Math.round(8 * (this._adaptiveScale || 1));
        for (let k = 0; k < flow.length; k++) {
            const e = flow[k];
            if (k >= i) e.node.setY(y);
            e.y = y;
            y += e.h + e.gap;
        }
        this._craftContentH = y + Math.round(52 * (this._adaptiveScale || 1));
        this._craftMaxScroll = Math.max(0, this._craftContentH - this._craftView.h);
        this.craftCam.scrollY = Phaser.Math.Clamp(this.craftCam.scrollY + (anchor ? anchor.y - anchorOld : 0), 0, this._craftMaxScroll);
    },

    relayoutAllCraft() {
        const flow = this._craftFlow;
        if (!flow) return;
        for (const e of flow) if (e.relayout) e.h = e.relayout();
        this.restackCraftFrom(0);
    },

    // Ряд предмета (портрет): зона A — текст (name+sub) слева и столбик кнопок
    // справа, зона B — подсказка на всю ширину. Высоты — по ФАКТУ (craftTextH).
    layoutCraftItemRow(row) {
        const padT = SPACE.md, padB = SPACE.md, g = SPACE.sm, bandG = SPACE.sm;
        const TH = (t) => this.craftTextH(t);
        let y = padT;
        const nameH = TH(row.name);
        row.name.y = y;
        row.sub.y = y + nameH + g;
        const textA = nameH + g + TH(row.sub);
        const bandA = Math.max(textA, 2 * row.btnH + SPACE.sm);
        row.buyBtn.y = y + row.btnH / 2;
        row.buyBtnText.y = row.buyBtn.y;
        row.btn.y = y + bandA - row.btnH / 2;
        row.btnText.y = row.btn.y;
        y += bandA + bandG;
        row.hint.y = y;
        const hintH = TH(row.hint);
        if (hintH > row.hintSlot) row.hintSlot = hintH;
        y += row.hintSlot + padB;
        const H = Math.max(Math.ceil(y), row.iconSize + 2 * padT);
        row.card.setDisplaySize(row.w, H).setPosition(row.w / 2, H / 2);
        this.placeIcon(row.icon, row.def.id, row.iconCX, H / 2, row.iconSize);
        return H;
    },

    // Ряд рецепта (портрет): шапка (имя + кнопка), «Получишь: …» на всю ширину,
    // строка «Нужно:» с парами, фут со статусом/источником (взаимно исключены).
    // Все высоты — по факту (craftTextH), блоки укладываются строго друг под другом.
    layoutCraftRecipeRow(row) {
        const padT = SPACE.md, padB = SPACE.md, g = SPACE.sm;
        const TH = (t) => this.craftTextH(t);
        let y = padT;
        // Шапка: кнопка справа, имя (без переноса) по центру высоты шапки
        const nameH = TH(row.name);
        const headH = Math.max(row.btnH, nameH);
        row.btn.y = y + headH / 2;
        row.btnText.y = row.btn.y;
        row.name.y = y + Math.round((headH - nameH) / 2);
        y += headH + g;
        // «Получишь: …» — 1–2 строки по факту
        row.desc.y = y;
        y += TH(row.desc) + g;
        // «Нужно:» + пары (иконка + число), центр строки needCY
        const needH = Math.max(28, row.pairIcon + 6, TH(row.needLbl));
        const needCY = Math.round(y + needH / 2);
        row.needLbl.y = needCY;
        let cx = row.textX + row.needLbl.width + SPACE.md;
        for (const pair of row.costPairs) {
            pair.icon.setPosition(cx + row.pairIcon / 2, needCY);
            pair.text.setPosition(cx + row.pairIcon + 6, needCY);
            cx += row.pairIcon + 6 + pair.text.width + SPACE.lg;
        }
        y += needH + g;
        // Фут: статус ИЛИ источник (взаимно исключены), grow-only слот
        row.status.y = y;
        row.src.y = y;
        const footH = TH(row.status.visible ? row.status : row.src);
        if (footH > row.footSlot) row.footSlot = footH;
        y += row.footSlot + padB;
        const H = Math.max(Math.ceil(y), row.iconSize + 2 * padT);
        row.card.setDisplaySize(row.w, H).setPosition(row.w / 2, H / 2);
        this.placeIcon(row.icon, row.recipe.result.id, row.iconCX, H / 2, row.iconSize);
        return H;
    },

    // Артефактная ячейка (портрет): одна колонка, grow-only слот под строку line
    layoutCraftArtCell(cell) {
        const padT = SPACE.md, padB = SPACE.md, g = SPACE.sm;
        let y = padT;
        cell.name.y = y;
        y += this.craftTextH(cell.name) + g;
        cell.line.y = y;
        const lineH = this.craftTextH(cell.line);
        if (lineH > cell.lineSlot) cell.lineSlot = lineH;
        y += cell.lineSlot + padB;
        const H = Math.max(Math.ceil(y), cell.iconSize + 2 * padT);
        cell.card.setDisplaySize(cell.w, H).setPosition(cell.w / 2, H / 2);
        this.placeIcon(cell.icon, cell.def.id, cell.iconCX, H / 2, cell.iconSize);
        return H;
    },

    // Портретная мастерская (спека Claude): FLOW-раскладка — блоки кладутся
    // сверху вниз по ИЗМЕРЕННЫМ высотам текстов, высота карточки вычисляется,
    // стекинг и высота контента пересчитываются (restackCraftFrom). Фиксированные
    // офсеты при переносящемся тексте давали наезды и «вываливание» (скриншоты).
    buildCraftContentPortrait() {
        const w = this._craftView.w;
        const s = this._adaptiveScale || 1;
        const f = w / 835;
        const iconCX = Math.round(118 * f);
        const textX = Math.round(186 * f) + 34;
        const iconSize = Math.round(40 * Math.min(s, 1.6));
        const btnW = Phaser.Math.Clamp(Math.round(90 * s), 150, 170);
        const btnH = Phaser.Math.Clamp(Math.round(36 * Math.min(s, 1.5)), 48, 64);
        const btnCX = w - 12 - btnW / 2;
        const textMaxW = btnCX - btnW / 2 - 8 - textX;
        const W2 = w - 14 - textX;
        const nameSize = Math.max(9, Math.round(FONT_SIZE.label * s));
        const subSize = Math.max(9, Math.round(FONT_SIZE.caption * s));
        const wrap = (width) => ({ wordWrap: { width, useAdvancedWrap: true } });

        this.craftContent.removeAll(true);
        this.craftItemRows = {};
        this.craftRecipeRows = {};
        this.craftArtCells = {};
        this._craftFlow = [];
        const flow = this._craftFlow;
        const gapRow = 6;
        const addFlow = (node, h, gap, relayout, row) => flow.push({ node, h, gap, y: 0, relayout, row });
        const addHeader = (title, warnText) => {
            const c = this.add.container(0, 0);
            c.add(makeLabel(this, 2, 0, title, Math.max(11, Math.round(FONT_SIZE.stat * s)), TEXT.cream).setOrigin(0, 0));
            if (warnText) c.add(makeLabel(this, w - 2, 3, warnText, Math.max(9, Math.round(FONT_SIZE.captionSm * s)), TEXT.bad).setOrigin(1, 0));
            this.craftContent.add(c);
            addFlow(c, Math.round(36 * s), 0, null);
        };

        addHeader('Активируемые');
        for (const def of ITEMS) {
            const rc = this.add.container(0, 0);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, 173);
            const icon = this.add.image(0, 0, def.id);
            this.placeIcon(icon, def.id, iconCX, 86, iconSize);
            // Имя — БЕЗ wordWrap (перенос рвал «Ядро-аккумулятор» по дефису); ужин min 22
            const name = makeLabel(this, textX, 12, def.name, nameSize, TEXT.white).setOrigin(0, 0);
            fitFontSize(name, nameSize, textMaxW, 22);
            const sub = makeLabel(this, textX, 0, `эффект: ${def.desc}`, subSize, TEXT.soft, wrap(textMaxW)).setOrigin(0, 0);
            const hint = makeLabel(this, textX, 0, '', subSize, TEXT.gold, wrap(W2)).setOrigin(0, 0);
            const btn = this.add.image(btnCX, 0, TEX.button).setDisplaySize(btnW, btnH);
            setHitRect(btn, ...HIT.button);
            const btnText = makeLabel(this, btnCX, 0, 'Активировать', subSize, TEXT.white, { align: 'center' }).setOrigin(0.5);
            fitFontSize(btnText, subSize, btnW - SPACE.md, 16);
            const buyBtn = this.add.image(btnCX, 0, TEX.button).setDisplaySize(btnW, btnH);
            setHitRect(buyBtn, ...HIT.button);
            const buyBtnText = makeLabel(this, btnCX, 0, '', subSize, TEXT.white, { align: 'center' }).setOrigin(0.5);
            rc.add([card, icon, name, sub, hint, btn, btnText, buyBtn, buyBtnText]);
            this.craftContent.add(rc);
            btn.on('pointerdown', (p) => this.startCraftDrag(p));
            btn.on('pointerup', () => {
                if (this._craftDragging) return;
                this.activateItemRow(def);
            });
            buyBtn.on('pointerdown', (p) => this.startCraftDrag(p));
            buyBtn.on('pointerup', () => {
                if (this._craftDragging) return;
                if (buyItem(def.id)) {
                    playSfx(this, 'purchase');
                } else {
                    this.setItemRowError(def, (gameState.items[def.id] || 0) >= def.stackMax ? 'стак полон' : 'не хватает руды');
                }
                this.refreshUi();
            });
            const row = { def, rc, card, icon, name, sub, hint, btn, btnText, buyBtn, buyBtnText, textX, btnW, btnH, iconCX, iconSize, w, _key: null, _hintKey: null, _err: null, _errUntil: 0, _buySize: subSize, _buyMaxW: btnW - SPACE.md, hintSlot: this.craftMeasureLH(subSize), _nameTarget: nameSize, _nameMaxW: textMaxW, _dirty: false };
            row.relayout = () => this.layoutCraftItemRow(row);
            this.craftItemRows[def.id] = row;
            addFlow(rc, 0, gapRow, row.relayout, row);
        }

        addHeader('Рецепты', 'крафт нельзя отменить');
        for (const recipe of CRAFT_RECIPES) {
            const rc = this.add.container(0, 0);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, 173);
            const icon = this.add.image(0, 0, recipe.result.id);
            this.placeIcon(icon, recipe.result.id, iconCX, 86, iconSize);
            const resultDef = recipe.result.kind === 'item'
                ? ITEMS.find((i) => i.id === recipe.result.id)
                : ARTIFACTS.find((a) => a.id === recipe.result.id);
            const name = makeLabel(this, textX, 0, resultDef.name, nameSize, TEXT.white).setOrigin(0, 0);
            fitFontSize(name, nameSize, textMaxW, 22);
            const desc = makeLabel(this, textX, 0, `Получишь: ${resultDef.desc}`, subSize, TEXT.good, wrap(W2)).setOrigin(0, 0);
            const needLbl = makeLabel(this, textX, 0, 'Нужно:', subSize, TEXT.soft).setOrigin(0, 0.5);
            const costPairs = [];
            const pairNodes = [];
            const pairIcon = Math.round(16 * Math.min(s, 1.5));
            for (const compId of Object.keys(recipe.cost)) {
                const compDef = COMPONENTS.find((c) => c.id === compId);
                const cIcon = this.add.image(0, 0, compDef.icon);
                this.placeIcon(cIcon, compDef.icon, 0, 0, pairIcon);
                const cText = makeLabel(this, 0, 0, String(recipe.cost[compId]), subSize, TEXT.gold).setOrigin(0, 0.5);
                pairNodes.push(cIcon, cText);
                costPairs.push({ id: compId, text: cText, icon: cIcon });
            }
            const status = makeLabel(this, textX, 0, '', subSize, TEXT.bad, wrap(W2)).setOrigin(0, 0).setVisible(false);
            const srcTxt = recipe.result.kind === 'artifact'
                ? 'крафт'
                : `дроп: ${[...new Set(Object.keys(recipe.cost).map((compId) => (BOSSES.find((b) => b.drops[compId]) || {}).name).filter(Boolean))].join(', ')}`;
            const src = makeLabel(this, textX, 0, srcTxt, subSize, TEXT.dim, wrap(W2)).setOrigin(0, 0);
            const btn = this.add.image(btnCX, 0, TEX.button).setDisplaySize(btnW, btnH);
            setHitRect(btn, ...HIT.button);
            const label = recipe.craftMs === 0 ? 'Создать' : `Крафт ${Math.round(recipe.craftMs / 60000)} мин`;
            const btnText = makeLabel(this, btnCX, 0, label, subSize, TEXT.white, { align: 'center' }).setOrigin(0.5);
            fitFontSize(btnText, subSize, btnW - SPACE.md, 16);
            rc.add([card, icon, name, desc, needLbl, status, src, btn, btnText]);
            for (const n of pairNodes) rc.add(n);
            this.craftContent.add(rc);
            btn.on('pointerdown', (p) => this.startCraftDrag(p));
            btn.on('pointerup', () => {
                if (this._craftDragging) return;
                const c = gameState.crafting;
                if (c && c.recipeId === recipe.id) {
                    if (canClaimCraft()) {
                        if (claimCraft()) playSfx(this, 'purchase');
                    }
                } else if (!c && !(recipe.result.kind === 'artifact' && gameState.artifacts.includes(recipe.result.id))) {
                    if (startCraft(recipe.id)) {
                        playSfx(this, 'purchase');
                        if (recipe.craftMs === 0) claimCraft();
                    }
                }
                this.refreshUi();
            });
            const row = { recipe, resultDef, rc, card, icon, name, desc, needLbl, costPairs, status, src, btn, btnText, label, pairIcon, textX, btnW, btnH, iconCX, iconSize, w, _key: null, _footTxt: null, _btnSize: subSize, _btnMaxW: btnW - SPACE.md, footSlot: this.craftMeasureLH(subSize), _nameTarget: nameSize, _nameMaxW: textMaxW, _dirty: false };
            row.relayout = () => this.layoutCraftRecipeRow(row);
            this.craftRecipeRows[recipe.id] = row;
            addFlow(rc, 0, gapRow, row.relayout, row);
        }

        addHeader('Артефакты');
        for (const def of ARTIFACTS) {
            const rc = this.add.container(0, 0);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, 117);
            const icon = this.add.image(0, 0, def.id);
            this.placeIcon(icon, def.id, iconCX, 58, iconSize);
            const name = makeLabel(this, textX, 12, def.name, nameSize, TEXT.gold).setOrigin(0, 0);
            fitFontSize(name, nameSize, textMaxW, 22);
            const line = makeLabel(this, textX, 0, '', subSize, TEXT.good, wrap(W2)).setOrigin(0, 0);
            rc.add([card, icon, name, line]);
            this.craftContent.add(rc);
            setHitRect(card, ...HIT.rowCard);
            card.on('pointerdown', (p) => this.startCraftDrag(p));
            card.on('pointerup', () => {
                if (this._craftDragging) return;
                if (gameState.artifacts.includes(def.id)) return;
                const cellObj = this.craftArtCells[def.id];
                if (!cellObj) return;
                const boss = BOSSES.find((b) => b.id === def.source);
                cellObj._hintText = boss ? `Получишь у босса: ${boss.name}` : 'Скрафти: рецепт';
                cellObj._hintUntil = Date.now() + 2000;
                this.refreshUi();
            });
            const cell = { def, rc, card, icon, name, line, iconCX, iconSize, w, textX, _owned: null, _hintText: '', _hintUntil: 0, lineSlot: 2 * this.craftMeasureLH(subSize), _nameTarget: nameSize, _nameMaxW: textMaxW, _dirty: false };
            cell.relayout = () => this.layoutCraftArtCell(cell);
            this.craftArtCells[def.id] = cell;
            addFlow(rc, 0, gapRow, cell.relayout, cell);
        }

        // Стартовая раскладка всех рядов и стекинг
        for (const e of flow) if (e.relayout) e.h = e.relayout();
        this.restackCraftFrom(0);
        // Webfont Monocraft грузится асинхронно: первая раскладка могла
        // посчитаться по fallback-шрифту — переложить после загрузки
        if (!this._craftFontsHooked) {
            this._craftFontsHooked = true;
            // Принудительно грузим Monocraft (кириллица) и ждём готовности шрифтов
            const loadFont = (document.fonts.load ? document.fonts.load(`22px ${FONT}`, 'Аа Ag 123') : Promise.resolve()).catch(() => {});
            loadFont.then(() => document.fonts.ready).then(() => {
                if (!this.sys || !this._craftFlow) return;
                this._craftLHCache = {};
                if (this._craftMeasureText && this._craftMeasureText.style) this._craftMeasureText.style.update(true);
                // Перерисовать все Text рядов с пересчётом метрик (иначе height/width — от fallback)
                const rerender = (n) => {
                    if (n.list) n.list.forEach(rerender);
                    else if (n.style && typeof n.style.update === 'function') n.style.update(true);
                };
                rerender(this.craftContent);
                // Перефит имён (без переноса) по новой ширине шрифта
                const fitNames = (map) => {
                    for (const k of Object.keys(map)) {
                        const r = map[k];
                        if (r && r.name && r._nameTarget) fitFontSize(r.name, r._nameTarget, r._nameMaxW, 22);
                    }
                };
                fitNames(this.craftItemRows);
                fitNames(this.craftRecipeRows);
                fitNames(this.craftArtCells);
                this.relayoutAllCraft();
            });
        }
    },

    // Активация предмета из мастерской: useItem(id,false); при отказе — красная
    // строка-подсказка в ряду на 2с (R5: флоаты под модалкой нечитаемы).
    activateItemRow(def) {
        if (!useItem(def.id, false)) {
            const stock = (gameState.items[def.id] || 0) <= 0;
            this.setItemRowError(def, stock ? 'нет предмета' : (def.bossUse ? 'только в бою' : 'баф ещё активен'));
        }
        this.refreshUi();
    },

    setItemRowError(def, msg) {
        const row = this.craftItemRows[def.id];
        if (!row) return;
        row._err = msg;
        row._errUntil = Date.now() + 2000;
    },

    // Дифф-обновление мастерской (каждый кадр при открытом экране): счётчики
    // шапки, тексты/кнопки/цвета рядов. Перерисовка только при смене состояния.
    refreshCraftUi() {
        for (const c of this.craftCompRow) {
            const s = fmt(gameState.components[c.id] || 0);
            if (c.text.text !== s) c.text.setText(s);
        }
        const bossActive = !!this.registry.get(REG.bossActive);
        const now = Date.now();

        for (const id of Object.keys(this.craftItemRows)) {
            const row = this.craftItemRows[id];
            const def = row.def;
            const stock = gameState.items[id] || 0;
            const eff = def.effect;
            let slotUntil = 0;
            let slotMult = 1;
            if (eff.bossMult) { slotUntil = gameState.bossBuffUntil; slotMult = gameState.bossBuffMult; }
            else if (eff.miningMult) { slotUntil = gameState.miningBuffUntil; slotMult = gameState.miningBuffMult; }
            else if (eff.veinForce) { slotUntil = gameState.itemVeinUntil; }
            const buffLeft = slotUntil - now;
            const active = buffLeft > 0;
            const blocked = stock <= 0
                || (def.bossUse && !bossActive)
                || (active && buffLeft > 30e3);
            const errActive = (row._errUntil || 0) > now;
            let hintTxt = `в запасе: ${stock}`;
            let hintColor = TEXT.gold;
            if (errActive) {
                hintTxt = row._err;
                hintColor = TEXT.warn;
            } else if (active) {
                hintTxt = `в запасе: ${stock} · ${eff.bossMult ? `бомба ${this._mmss(buffLeft)}` : eff.veinForce ? `жила ${this._mmss(buffLeft)}` : `x${slotMult} ${this._mmss(buffLeft)}`}`;
            } else if (stock <= 0) {
                hintTxt = 'нет предмета';
                hintColor = TEXT.warn;
            } else if (def.bossUse) {
                hintTxt = `в запасе: ${stock} · только в бою`;
                hintColor = TEXT.warn;
            }
            const hintKey = `${hintTxt}|${hintColor}`;
            if (hintKey !== row._hintKey) {
                row._hintKey = hintKey;
                row.hint.setText(hintTxt).setColor(hintColor);
                if (this.L.portrait) {
                    // Grow-only слот: высота ряда растёт только если подсказка выше слота
                    const hh = this.craftTextH(row.hint);
                    if (hh > row.hintSlot) { row.hintSlot = hh; row._dirty = true; }
                } else {
                    fitFontSize(row.hint, row._hintSize, row._hintMaxW, 9);
                }
            }
            const price = getItemPrice(id);
            const buyBlocked = gameState.ore < price || stock >= def.stackMax;
            const buyLbl = `Купить ${fmt(price)}`;
            const key = `${stock}|${blocked}|${buyLbl}|${buyBlocked}`;
            if (key !== row._key) {
                row._key = key;
                row.btn.setTexture(blocked ? TEX.buttonDisabled : TEX.button);
                row.btnText.setColor(blocked ? '#d0d0d0' : TEXT.white);
                row.buyBtn.setTexture(buyBlocked ? TEX.buttonDisabled : TEX.button);
                row.buyBtnText.setText(buyLbl).setColor(buyBlocked ? TEXT.muted : TEXT.white);
                fitFontSize(row.buyBtnText, row._buySize, row._buyMaxW, this.L.portrait ? 16 : 8);
            }
        }

        for (const id of Object.keys(this.craftRecipeRows)) {
            const row = this.craftRecipeRows[id];
            const busy = !!gameState.crafting;
            const mine = busy && gameState.crafting.recipeId === id;
            const ready = mine && canClaimCraft();
            const owned = row.recipe.result.kind === 'artifact' && gameState.artifacts.includes(row.recipe.result.id);
            let btnText = row.label || (row.recipe.craftMs === 0 ? 'Создать' : `Крафт ${Math.round(row.recipe.craftMs / 60000)} мин`);
            let texture = TEX.button;
            let color = TEXT.white;
            let statusTxt = '';
            if (mine) {
                if (ready) {
                    btnText = 'Забрать';
                } else {
                    btnText = this._mmss(gameState.crafting.endsAt - now);
                    texture = TEX.buttonDisabled;
                    color = TEXT.muted;
                }
            } else if (owned || busy || !canCraft(id)) {
                texture = TEX.buttonDisabled;
                color = TEXT.muted;
                if (owned) statusTxt = 'уже в коллекции';
                else if (busy) statusTxt = 'верстак занят';
                else if (row.recipe.result.kind === 'item') {
                    const space = row.resultDef.stackMax - (gameState.items[row.resultDef.id] || 0);
                    const compsOk = Object.keys(row.recipe.cost).every((c) => (gameState.components[c] || 0) >= row.recipe.cost[c]);
                    if (space < row.recipe.result.n && compsOk) statusTxt = 'стак полон';
                }
            }
            let costPart = '';
            for (const pair of row.costPairs) {
                const enough = (gameState.components[pair.id] || 0) >= row.recipe.cost[pair.id];
                costPart += `|${enough ? 1 : 0}`;
            }
            const key = `${btnText}|${texture}|${statusTxt}${costPart}`;
            if (key !== row._key) {
                row._key = key;
                row.btnText.setText(btnText).setColor(color);
                fitFontSize(row.btnText, row._btnSize, row._btnMaxW, this.L.portrait ? 16 : 8);
                row.btn.setTexture(texture);
                if (statusTxt !== row._footTxt) {
                    row._footTxt = statusTxt;
                    row.status.setText(statusTxt).setVisible(statusTxt !== '');
                    row.src.setVisible(statusTxt === '');
                    if (this.L.portrait) {
                        // Grow-only слот фута; статус/дроп взаимно исключены.
                        // Слот растёт и при показе src (мог сменить высоту)
                        const fh = this.craftTextH(statusTxt ? row.status : row.src);
                        if (fh > row.footSlot) { row.footSlot = fh; row._dirty = true; }
                        else if (statusTxt) row._dirty = true; // статус виден -> фут пересчитать
                    } else if (statusTxt) {
                        fitFontSize(row.status, row._footSize, row._footMaxW, 9);
                    }
                }
                for (const pair of row.costPairs) {
                    pair.text.setColor((gameState.components[pair.id] || 0) >= row.recipe.cost[pair.id] ? TEXT.gold : '#f0638c');
                }
            }
        }

        for (const id of Object.keys(this.craftArtCells)) {
            const cell = this.craftArtCells[id];
            const owned = gameState.artifacts.includes(id);
            const hintActive = !owned && cell._hintUntil > now;
            let lineTxt;
            let lineColor;
            if (owned) {
                lineTxt = cell.def.desc;
                lineColor = TEXT.good;
            } else if (hintActive) {
                lineTxt = cell._hintText;
                lineColor = TEXT.gold;
            } else {
                const boss = BOSSES.find((b) => b.id === cell.def.source);
                lineTxt = boss ? `Босс: ${boss.name}` : 'Крафт';
                lineColor = TEXT.dim;
            }
            if (owned !== cell._owned || lineTxt !== cell._lineTxt || lineColor !== cell._lineColor) {
                cell._owned = owned;
                cell._lineTxt = lineTxt;
                cell._lineColor = lineColor;
                cell.rc.setAlpha(owned ? 1 : 0.5);
                cell.line.setText(lineTxt).setColor(lineColor);
                if (this.L.portrait) {
                    const lh = this.craftTextH(cell.line);
                    if (lh > cell.lineSlot) { cell.lineSlot = lh; cell._dirty = true; }
                }
            }
        }

        // Портрет: переложить «подросшие» ряды и перестековать один раз за кадр
        if (this.L.portrait && this._craftFlow) {
            let from = Infinity;
            for (let k = 0; k < this._craftFlow.length; k++) {
                const e = this._craftFlow[k];
                if (e.row && e.row._dirty) {
                    e.row._dirty = false;
                    const old = e.h;
                    e.h = e.relayout();
                    if (e.h !== old) from = Math.min(from, k);
                }
            }
            if (from < Infinity) this.restackCraftFrom(from);
        }
    },

    setupCraftDrag() {
        const inCraftZone = (p) => {
            const v = this._craftView;
            return p.x >= v.x - 6 && p.x <= v.x + v.w + 6
                && p.y >= v.y - 6 && p.y <= v.y + v.h + 6;
        };
        // Вызывается из хендлера dim (dim гасит scene-level down)
        this.startCraftDrag = (p) => {
            if (!this._craftOpen || !inCraftZone(p)) return;
            this._craftDragId = p.id;
            this._craftDragStartY = p.y;
            this._craftDragStartScroll = this.craftCam.scrollY;
            this._craftDragging = false;
        };
        this.input.on('pointermove', (p) => {
            if (p.id !== this._craftDragId || !p.isDown) return;
            const delta = this._craftDragStartY - p.y;
            if (!this._craftDragging && Math.abs(delta) > 6) this._craftDragging = true;
            if (this._craftDragging) {
                this.craftCam.scrollY = Phaser.Math.Clamp(this._craftDragStartScroll + delta, 0, this._craftMaxScroll);
            }
        });
        const endDrag = (p) => {
            if (p && p.id !== this._craftDragId) return;
            this._craftDragId = null;
            this.time.delayedCall(0, () => { this._craftDragging = false; });
        };
        this.input.on('pointerup', endDrag);
        this.input.on('pointerupoutside', endDrag);
    },

    openCraft() {
        if (this._craftOpen) return;
        if (this.registry.get(REG.blockLocked)) return;
        this._craftOpen = true;
        this.craftDim.setVisible(true);
        this.craftRoot.setVisible(true);
        this.craftCam.setVisible(true);
        this.refreshUi();
    },

    closeCraft() {
        this.craftDim.setVisible(false);
        this.craftRoot.setVisible(false);
        this.craftCam.setVisible(false);
        this._craftOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под мастерской
    },

    // Экран мастерской
    applyCraftLayout(L, s) {
        // Экран мастерской (каркас): ландшафт 560x600 в L.modal; портрет — на
        // всю свободную зону (та же сетка, что у карты)
        let cpw, cph, ccy;
        if (L.portrait) {
            cpw = L.W - 24;
            cph = Math.min(L.H - 184, 1500);
            ccy = L.modal.zoneTop + Math.round(cph / 2);
        } else {
            cpw = 560;
            cph = 600;
            ccy = L.modal.cy;
        }
        this.craftRoot.setPosition(L.modal.cx, ccy);
        this.craftPanel.setDisplaySize(cpw, cph);
        if (L.portrait) {
            // Портрет: шапка разрежена по вертикали — на высокой панели титул,
            // прижатый к рамке (68), выглядел «улетевшим вверх» (ревью игрока)
            this.craftTitle.setPosition(0, -cph / 2 + 96);
            this.craftTitle.setFontSize(FONT_SIZE.title);
            this.craftClose.setPosition(cpw / 2 - 48, -cph / 2 + 72);
            this.craftClose.setDisplaySize(64, 64);
            if (this.craftHeader && this._headerS !== s) {
                this._headerS = s;
                this.buildCraftHeader();
            }
            if (this.craftHeader) this.craftHeader.setPosition(0, -cph / 2 + 152);
        } else {
            this.craftTitle.setPosition(0, -cph / 2 + 68);
            this.craftTitle.setFontSize(FONT_SIZE.display);
            this.craftClose.setPosition(cpw / 2 - 60, -cph / 2 + 72);
            this.craftClose.setDisplaySize(44, 44);
            if (this.craftHeader && this._headerS !== s) {
                this._headerS = s;
                this.buildCraftHeader();
            }
            if (this.craftHeader) this.craftHeader.setPosition(0, -cph / 2 + 108);
        }
        const cvx = L.modal.cx - cpw / 2 + 40;
        const cvw = cpw - 80;
        // Зазор под подсказку шапки («компоненты падают с боссов…»): подсказка
        // опускается на 26*k ниже заголовка, и при s>1 «Активируемые» печатались
        // поверх неё (скриншот портрета). В портрете подсказка ДВУХСТРОЧНАЯ
        // (24px) — вторая строка добавляет свою высоту к зазору
        const headerExtra = L.portrait ? 118 : Math.max(0, Math.round(26 * Math.min(s, 1.6)) + Math.ceil(Math.max(10, Math.round(12 * Math.min(s, 1.35))) / 2) - 10);
        const cvy = ccy - cph / 2 + 128 + headerExtra;
        const cvh = cph - 188 - headerExtra;
        this.craftCam.setViewport(cvx, cvy, cvw, cvh);
        this._craftView = { x: cvx, y: cvy, w: cvw, h: cvh };
        if (this.craftContent && (this._craftRowsW !== cvw || this._craftRowsS !== s)) {
            this._craftRowsW = cvw;
            this._craftRowsS = s;
            this.buildCraftContent();
        }
        this._craftMaxScroll = Math.max(0, (this._craftContentH || 0) - cvh);
        this.craftCam.scrollY = Phaser.Math.Clamp(this.craftCam.scrollY, 0, this._craftMaxScroll);
    }
};
