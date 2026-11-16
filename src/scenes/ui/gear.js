import Phaser from 'phaser';
import {
    gameState, fmt, ITEMS, useItem, getItemPrice, buyItem, canBuyItem
} from '../../state.js';
import { makeLabel, fitFontSize } from '../../ui/uiKit.js';
import { addButton } from '../../ui/button.js';
import { VIEWPORT } from '../../ui/listGeometry.js';
import { TEXT, DEPTH, TEX, HIT, FONT_SIZE, SPACE } from '../../ui/theme.js';
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
                kind: 'image', w: HIT.button[0], h: HIT.button[1], key: TEX.button,
                depth: DEPTH.uiAbove, fontSize: FONT_SIZE.caption, color: TEXT.white
            });
            buyBtn.on('pointerup', () => {
                if (this._listDragging) return;
                if (buyItem(def.id)) {
                    playSfx(this, 'purchase');
                    this.refreshGearPanel(true);
                }
            });
            const { bg: useBtn, label: useLbl } = addButton(this, 0, 0, {
                kind: 'image', w: HIT.button[0], h: HIT.button[1], key: TEX.button,
                text: 'Использовать', fontSize: FONT_SIZE.caption, color: TEXT.white,
                depth: DEPTH.uiAbove
            });
            useBtn.on('pointerup', () => {
                if (this._listDragging) return;
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
        if (!this.gearContent) return;
        const vw = VIEWPORT;
        const s = this._adaptiveScale || 1;
        const ts = this.L.portrait ? s : 1;
        if (this.L.portrait) {
            // Портрет (спека редизайна): три карточки заполняют врезку целиком
            // — «серого пятна» под рядами нет; крупные кегли (FIT ~0.54),
            // у кнопок гарантированный отступ от описания (gapTop/padBottom).
            // Иконка 48 внутри карточки (была 56 и вылезала за верхнюю рамку)
            if (this.gearTitle) this.gearTitle.setVisible(false);
            const rh = Math.floor((vw.h - 24) / 3);
            let ry = vw.y + SPACE.xs;
            for (const row of this.gearRows) {
                const w = vw.w - 8;
                const geom = `${w}|${rh}`;
                if (row._cardGeom !== geom) {
                    row._cardGeom = geom;
                    row.card.clear();
                    row.card.fillStyle(0x2a2d31, 1);
                    row.card.fillRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10);
                    row.card.lineStyle(2, 0x555860, 1);
                    row.card.strokeRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10);
                }
                row._geom = { x: vw.x + SPACE.xs, y: ry, w, h: rh };
                const iconCX = vw.x + SPACE.xs + 40;
                row.icon.setPosition(iconCX, ry + 34);
                row.icon.setDisplaySize(48, 48);
                const textX = iconCX + 24 + 14;
                const textRight = vw.x + SPACE.xs + w - 14;
                row.name.setPosition(textX, ry + 34);
                row.name.setFontSize(FONT_SIZE.cardTitle);
                row.stock.setPosition(textRight, ry + 34);
                row.stock.setFontSize(FONT_SIZE.accent);
                row.desc.setPosition(textX, ry + 66);
                row.desc.setFontSize(FONT_SIZE.accent);
                // setStyle, а не присваивание .wordWrap: это не API Phaser
                row.desc.setStyle({ wordWrap: { width: Math.max(80, textRight - textX) } });
                const gapTop = rh >= 160 ? SPACE.md : SPACE.sm;
                const padBottom = gapTop;
                const btnH = Phaser.Math.Clamp(rh - 92 - gapTop - padBottom, 44, 88);
                const btnTop = rh - padBottom - btnH;
                const btnW = Math.round((w - 28 - SPACE.md) / 2);
                row.buyBtn.setPosition(vw.x + SPACE.xs + 14 + btnW / 2, ry + btnTop + btnH / 2);
                row.buyBtn.setDisplaySize(btnW, btnH);
                row.buyLbl.setPosition(row.buyBtn.x, row.buyBtn.y);
                row.buyLbl.setFontSize(FONT_SIZE.accent);
                row.useBtn.setPosition(vw.x + SPACE.xs + 14 + btnW + SPACE.md + btnW / 2, ry + btnTop + btnH / 2);
                row.useBtn.setDisplaySize(btnW, btnH);
                row.useLbl.setPosition(row.useBtn.x, row.useBtn.y);
                row.useLbl.setFontSize(FONT_SIZE.accent);
                ry += rh + SPACE.sm;
            }
            this.refreshGearPanel(true);
            return;
        }
        this.gearTitle.setPosition(vw.x + vw.w / 2, vw.y + 16);
        this.gearTitle.setFontSize(Math.round(FONT_SIZE.buttonLg * ts));
        const rh = Math.round(100 * ts);
        let ry = vw.y + 30;
        for (const row of this.gearRows) {
            const w = vw.w - 8;
            // Карточка-графика: перерисовка при смене геометрии
            const geom = `${w}|${rh}`;
            if (row._cardGeom !== geom) {
                row._cardGeom = geom;
                row.card.clear();
                row.card.fillStyle(0x2a2d31, 1);
                row.card.fillRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10);
                row.card.lineStyle(2, 0x555860, 1);
                row.card.strokeRoundedRect(vw.x + SPACE.xs, ry, w, rh, 10);
            }
            row._geom = { x: vw.x + SPACE.xs, y: ry, w, h: rh };
            const iconCX = vw.x + SPACE.xs + Math.round(30 * ts);
            const iconSize = Math.round(44 * ts);
            row.icon.setPosition(iconCX, ry + rh / 2);
            row.icon.setDisplaySize(iconSize, iconSize);
            const textX = iconCX + iconSize / 2 + 12;
            const textRight = vw.x + SPACE.xs + w - 14;
            // Столбик: имя -> запас -> описание
            row.name.setPosition(textX, ry + Math.round(20 * ts));
            row.name.setFontSize(Math.round(FONT_SIZE.body * ts));
            row.stock.setPosition(textRight, ry + Math.round(20 * ts));
            row.stock.setFontSize(Math.round(FONT_SIZE.captionLg * ts));
            row.desc.setPosition(textX, ry + Math.round(42 * ts));
            row.desc.setFontSize(Math.round(FONT_SIZE.caption * ts));
            // setStyle, а не присваивание .wordWrap: это не API Phaser — перенос
            // оставался на зашитых 200px из конструктора и в портрете вторая
            // строка описания уезжала под кнопки (скриншот боя, мобилка)
            row.desc.setStyle({ wordWrap: { width: Math.max(80, textRight - textX) } });
            // Кнопки в нижнем ряду карточки: две по половине ширины с зазором 12
            const btnW = Math.round((w - 28 - SPACE.md) / 2);
            const btnH = Math.round(30 * ts);
            const btnY = ry + rh - btnH - 8;
            row.buyBtn.setPosition(vw.x + SPACE.xs + 14 + btnW / 2, btnY + btnH / 2);
            row.buyBtn.setDisplaySize(btnW, btnH);
            row.buyLbl.setPosition(row.buyBtn.x, row.buyBtn.y);
            row.buyLbl.setFontSize(Math.round(FONT_SIZE.caption * ts));
            row.useBtn.setPosition(vw.x + SPACE.xs + 14 + btnW + SPACE.md + btnW / 2, btnY + btnH / 2);
            row.useBtn.setDisplaySize(btnW, btnH);
            row.useLbl.setPosition(row.useBtn.x, row.useBtn.y);
            row.useLbl.setFontSize(Math.round(FONT_SIZE.caption * ts));
            ry += rh + 10;
        }
        this.refreshGearPanel(true);
    },

    // Дифф-обновление рядов снаряжения: запас, цена (динамическая), доступность
    refreshGearPanel(force = false) {
        if (!this.gearContent) return;
        for (const row of this.gearRows) {
            const stock = gameState.items[row.def.id] || 0;
            const price = getItemPrice(row.def.id);
            const canBuy = canBuyItem(row.def.id);
            const key = `${stock}|${price}|${canBuy ? 'n' : 'g'}`;
            if (!force && row._key === key) continue;
            row._key = key;
            // Короткий бейдж «x N» (как в слотах боя): длинное «в запасе: N» при
            // широком имени печаталось прямо ПОВЕРХ него глифами (скриншот боя)
            row.stock.setText(`x ${stock}`);
            row.buyBtn.setTexture(canBuy ? TEX.button : TEX.buttonDisabled);
            row.buyLbl.setText(`Купить · ${fmt(price)}`);
            row.useBtn.setTexture(stock > 0 ? TEX.button : TEX.buttonDisabled);
            // Имя ужинается до зазора перед бейджем запаса — гарантия от наезда
            // (портретный кегль снаряжения 22 — крупнее рядов списка)
            const nameBase = this.L && this.L.portrait ? FONT_SIZE.cardTitle : Math.round(FONT_SIZE.body * (this._adaptiveScale || 1));
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
