import Phaser from 'phaser';
import { gameState, fmt, ITEMS, useItem, getItemPrice, buyItem, canBuyItem } from '../../state.js';
import { makeLabel, fitFontSize, setHitWorldRect } from './uiKit.js';
import { addButton } from './button.js';
import { VIEWPORT } from '../shared/listGeometry.js';
import { TEXT, DEPTH, TEX, HIT, FONT_SIZE, SPACE } from '../shared/theme.js';
import { playSfx } from '../../sfx.js';

export const gearMethods = {
    // Во время боя правая панель показывает предметы для файта вместо списка
    // улучшений (замечание игрока: снаряжение не видно). Геометрия — как у рядов
    // улучшений: addImg-карточка (пропорциональный скейл; НЕ nine-slice — борды
    // 10px-заготовки при setDisplaySize растягиваются в ~30x, поймано скриншотом
    // игрока) и кнопки add.image. Компоновка: иконка+имя+запас сверху, описание
    // во всю ширину, две кнопки в нижнем ряду карточки.
    buildGearSection() {
        this.gearContent = this.add.container(0, 0).setDepth(DEPTH.uiAbove).setVisible(false);
        this.gearTitle = makeLabel(this, 0, 0, 'Снаряжение', FONT_SIZE.buttonLg, TEXT.cream).setOrigin(0.5);
        this.gearContent.add(this.gearTitle);
        this.gearRows = ITEMS.filter((it) => it.bossUse).map((def) => {
            // Карточка — Graphics (скруглённый прямоугольник), НЕ текстура:
            // addImg при непропорциональном setDisplaySize растягивал фон-«поле»
            // (скриншот игрока), nine-slice 10px-заготовка рвала борды
            const card = this.add.graphics().setDepth(DEPTH.ui);
            const icon = this.add.image(0, 0, def.id);
            const name = makeLabel(this, 0, 0, def.name, FONT_SIZE.body, TEXT.cream);
            name.setOrigin(0, 0.5);
            const stock = makeLabel(this, 0, 0, '', FONT_SIZE.captionLg, TEXT.cream);
            stock.setOrigin(1, 0.5);
            const desc = makeLabel(this, 0, 0, def.desc, FONT_SIZE.caption, TEXT.soft, { wordWrap: { width: 200 } });
            desc.setOrigin(0, 0);
            // Кнопки рядов (Button, kind image): нативный размер текстуры = кадр
            // hit-area (267x133); раскладка двигает/ресайзит ссылки из layoutGearSection
            const { bg: buyBtn, label: buyLbl } = addButton(this, 0, 0, {
                kind: 'image',
                w: HIT.button[0],
                h: HIT.button[1],
                key: TEX.button,
                depth: DEPTH.uiAbove,
                fontSize: FONT_SIZE.caption,
                color: TEXT.white
            });
            buyBtn.on('pointerup', () => {
                if (this._listDragging) {
                    return;
                }

                if (buyItem(def.id)) {
                    playSfx(this, 'purchase');
                    this.refreshGearPanel(true);
                }
            });
            const { bg: useBtn, label: useLbl } = addButton(this, 0, 0, {
                kind: 'image',
                w: HIT.button[0],
                h: HIT.button[1],
                key: TEX.button,
                text: 'Использовать',
                fontSize: FONT_SIZE.caption,
                color: TEXT.white,
                depth: DEPTH.uiAbove
            });
            useBtn.on('pointerup', () => {
                if (this._listDragging) {
                    return;
                }

                if ((gameState.items[def.id] || 0) > 0 && useItem(def.id, true)) {
                    playSfx(this, 'purchase');
                    this.refreshGearPanel(true);
                }
            });
            this.gearContent.add([card, icon, name, stock, desc, buyBtn, buyLbl, useBtn, useLbl]);

            return { def, card, icon, name, stock, desc, buyBtn, buyLbl, useBtn, useLbl, _key: null, _cardGeom: null };
        });
    },

    // Позиция секции от вьюпорта панели (пересчёт в applyLayout, включая боевой
    // вариант портретной сетки). Компактная высота рядов: 3 боевых предмета
    // должны ВЛЕЗАТЬ во вьюпорт без скролла (иначе «проваливались» — gearContent
    // рендерится main-камерой; обрезка — geometry-маска).
    layoutGearSection() {
        if (!this.gearContent) {
            return;
        }

        const vw = VIEWPORT;
        const g = this.L.gear;
        if (this.L.portrait) {
            // Портрет (спека редизайна): три карточки заполняют врезку целиком
            // — «серого пятна» под рядами нет; крупные кегли (FIT ~0.54),
            // у кнопок гарантированный отступ от описания (gapTop/padBottom).
            if (this.gearTitle) {
                this.gearTitle.setVisible(false);
            }

            // Высота ряда от ЖИВОГО вьюпорта (босс-режим его поджимает) —
            // формула здесь: computeLayout не знает о поджатии.
            // 24 = врезка сверху/снизу (SPACE.xs * 2) + зазоры между рядами (SPACE.sm * 2)
            const rh = Math.floor((vw.h - SPACE.xs * 2 - SPACE.sm * 2) / 3);
            let ry = vw.y + SPACE.xs;
            for (const row of this.gearRows) {
                const w = vw.w - g.cardInset * 2;
                const geom = `${w}|${rh}`;
                if (row._cardGeom !== geom) {
                    row._cardGeom = geom;
                    row.card.clear();
                    row.card.fillStyle(0x2a2d31, 1);
                    row.card.fillRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10); // 10 — радиус скругления карточки // 10 — радиус скругления карточки
                    row.card.lineStyle(2, 0x555860, 1);
                    row.card.strokeRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10); // 10 — радиус скругления карточки // 10 — радиус скругления карточки
                }

                row._geom = { x: vw.x + SPACE.xs, y: ry, w, h: rh };
                const iconCX = vw.x + SPACE.xs + g.iconInset;
                row.icon.setPosition(iconCX, ry + g.iconDy);
                row.icon.setDisplaySize(g.iconSize, g.iconSize);
                const textX = iconCX + g.iconSize / 2 + g.textGap;
                const textRight = vw.x + SPACE.xs + w - g.sideInset;
                row.name.setPosition(textX, ry + g.nameDy);
                row.name.setFontSize(FONT_SIZE.cardTitle);
                row.stock.setPosition(textRight, ry + g.nameDy);
                row.stock.setFontSize(FONT_SIZE.accent);
                row.desc.setPosition(textX, ry + g.descDy);
                row.desc.setFontSize(FONT_SIZE.accent);
                // setStyle, а не присваивание .wordWrap: это не API Phaser
                // 80 — минимальная ширина переноса на узких вьюпортах
                row.desc.setStyle({ wordWrap: { width: Math.max(80, textRight - textX) } });
                const gapTop = rh >= 160 ? SPACE.md : SPACE.sm;
                const padBottom = gapTop;
                // 92 = descDy (66) + высота двух строк описания — зона текста
                const btnH = Phaser.Math.Clamp(rh - 92 - gapTop - padBottom, g.btnHMin, g.btnHMax);
                const btnTop = rh - padBottom - btnH;
                const btnW = Math.round((w - g.sideInset * 2 - SPACE.md) / 2);
                row.buyBtn.setPosition(vw.x + SPACE.xs + g.sideInset + btnW / 2, ry + btnTop + btnH / 2);
                row.buyBtn.setDisplaySize(btnW, btnH);
                row.buyLbl.setPosition(row.buyBtn.x, row.buyBtn.y);
                row.buyLbl.setFontSize(FONT_SIZE.accent);
                row.useBtn.setPosition(
                    vw.x + SPACE.xs + g.sideInset + btnW + SPACE.md + btnW / 2,
                    ry + btnTop + btnH / 2
                );
                row.useBtn.setDisplaySize(btnW, btnH);
                row.useLbl.setPosition(row.useBtn.x, row.useBtn.y);
                row.useLbl.setFontSize(FONT_SIZE.accent);
                // Хит-колонки кнопок на всю высоту карточки (>= 40 CSS px);
                // колонки не пересекаются (зазор SPACE.md между кнопками)
                setHitWorldRect(row.buyBtn, vw.x + SPACE.xs + g.sideInset - g.hitPad, ry, btnW + g.hitPad * 2, rh);
                setHitWorldRect(
                    row.useBtn,
                    vw.x + SPACE.xs + g.sideInset + btnW + SPACE.md - g.hitPad,
                    ry,
                    btnW + g.hitPad * 2,
                    rh
                );
                ry += rh + SPACE.sm;
            }

            this.refreshGearPanel(true);

            return;
        }

        this.gearTitle.setPosition(vw.x + vw.w / 2, vw.y + g.titleDy);
        this.gearTitle.setFontSize(FONT_SIZE.buttonLg);
        const rh = g.rowH;
        let ry = vw.y + g.startDy;
        for (const row of this.gearRows) {
            const w = vw.w - g.cardInset * 2;
            // Карточка-графика: перерисовка при смене геометрии
            const geom = `${w}|${rh}`;
            if (row._cardGeom !== geom) {
                row._cardGeom = geom;
                row.card.clear();
                row.card.fillStyle(0x2a2d31, 1);
                row.card.fillRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10); // 10 — радиус скругления карточки
                row.card.lineStyle(2, 0x555860, 1);
                row.card.strokeRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10); // 10 — радиус скругления карточки
            }

            row._geom = { x: vw.x + SPACE.xs, y: ry, w, h: rh };
            const iconCX = vw.x + SPACE.xs + g.iconInset;
            // Компактная строка (аудит боя): иконка поднята выше кнопок (низ 60
            // при кнопках с 76) и описание поднято — двухстрочное описание и
            // иконка наезжали на кнопки (oy=5..10)
            const iconSize = g.iconSize;
            row.icon.setPosition(iconCX, ry + g.iconDy);
            row.icon.setDisplaySize(iconSize, iconSize);
            const textX = iconCX + iconSize / 2 + g.textGap;
            const textRight = vw.x + SPACE.xs + w - g.sideInset;
            row.name.setPosition(textX, ry + g.nameDy);
            row.name.setFontSize(FONT_SIZE.body);
            row.stock.setPosition(textRight, ry + g.nameDy);
            row.stock.setFontSize(FONT_SIZE.captionLg);
            row.desc.setPosition(textX, ry + g.descDy);
            row.desc.setFontSize(FONT_SIZE.caption);
            // setStyle, а не присваивание .wordWrap: это не API Phaser — перенос
            // оставался на зашитых 200px из конструктора и в портрете вторая
            // строка описания уезжала под кнопки (скриншот боя, мобилка)
            // 80 — минимальная ширина переноса на узких вьюпортах
            row.desc.setStyle({ wordWrap: { width: Math.max(80, textRight - textX) } });
            // Кнопки в нижнем ряду карточки: две по половине ширины с зазором
            // SPACE.md; нижний отступ g.btnInset (обводка не прилипает к кнопкам)
            const btnW = Math.round((w - g.sideInset * 2 - SPACE.md) / 2);
            const btnH = g.btnH;
            const btnY = ry + rh - btnH - g.btnInset;
            row.buyBtn.setPosition(vw.x + SPACE.xs + g.sideInset + btnW / 2, btnY + btnH / 2);
            row.buyBtn.setDisplaySize(btnW, btnH);
            row.buyLbl.setPosition(row.buyBtn.x, row.buyBtn.y);
            row.buyLbl.setFontSize(FONT_SIZE.caption);
            row.useBtn.setPosition(vw.x + SPACE.xs + g.sideInset + btnW + SPACE.md + btnW / 2, btnY + btnH / 2);
            row.useBtn.setDisplaySize(btnW, btnH);
            row.useLbl.setPosition(row.useBtn.x, row.useBtn.y);
            row.useLbl.setFontSize(FONT_SIZE.caption);
            // Хит-колонки кнопок на всю высоту карточки (>= 40 CSS px)
            setHitWorldRect(row.buyBtn, vw.x + SPACE.xs + g.sideInset - g.hitPad, ry, btnW + g.hitPad * 2, rh);
            setHitWorldRect(
                row.useBtn,
                vw.x + SPACE.xs + g.sideInset + btnW + SPACE.md - g.hitPad,
                ry,
                btnW + g.hitPad * 2,
                rh
            );
            ry += rh + g.rowGap;
        }

        this.refreshGearPanel(true);
    },

    // Дифф-обновление рядов снаряжения: запас, цена (динамическая), доступность
    refreshGearPanel(force = false) {
        if (!this.gearContent) {
            return;
        }

        for (const row of this.gearRows) {
            const stock = gameState.items[row.def.id] || 0;
            const price = getItemPrice(row.def.id);
            const canBuy = canBuyItem(row.def.id);
            const key = `${stock}|${price}|${canBuy ? 'n' : 'g'}`;
            if (!force && row._key === key) {
                continue;
            }

            row._key = key;
            // Короткий бейдж «x N» (как в слотах боя): длинное «в запасе: N» при
            // широком имени печаталось прямо ПОВЕРХ него глифами (скриншот боя)
            row.stock.setText(`x ${stock}`);
            row.buyBtn.setTexture(canBuy ? TEX.button : TEX.buttonDisabled);
            row.buyLbl.setText(`Купить · ${fmt(price)}`);
            row.useBtn.setTexture(stock > 0 ? TEX.button : TEX.buttonDisabled);
            // Имя ужинается до зазора перед бейджем запаса — гарантия от наезда
            // (портретный кегль снаряжения 22 — крупнее рядов списка)
            const nameBase = this.L.portrait ? FONT_SIZE.cardTitle : FONT_SIZE.body;
            // 48 — минимальная ширина ужина: совсем узкое имя нечитаемо
            fitFontSize(row.name, nameBase, Math.max(48, row.stock.x - row.stock.width - 12 - row.name.x));
        }
    },

    // Секция «Снаряжение»: позиция и маска
    applyGearLayout() {
        // Секция «Снаряжение» панели — позиция от вьюпорта (в бою панель выше)
        this.layoutGearSection();
        // Маска снаряжения: перерисовка под текущий вьюпорт панели
        if (this.gearMaskG) {
            this.gearMaskG.clear();
            this.gearMaskG.fillStyle(0xffffff, 1);
            this.gearMaskG.fillRect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h);
        }
    }
};
