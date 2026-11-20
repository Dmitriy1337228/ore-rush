import Phaser from 'phaser';
import {
    gameState,
    TIERS,
    UPGRADES,
    getUpgradeDef,
    getUpgradeLevel,
    getUpgradeCost,
    isMaxed,
    isUpgradeAvailable,
    canBuy,
    buyBulk,
    getAffordableBulk,
    getBulkCost,
    isUpgradeVisible,
    canUnlockTier,
    getNextTier,
    unlockTier,
    getNextUnlockPrice,
    saveGame,
    fmt
} from '../../state.js';
import {
    addNine,
    addImg,
    addImgC,
    makeLabel,
    fitFontSize,
    fitOneLine,
    setHitRect,
    setHitWorld,
    setHitWorldRect,
    tapSlopPx
} from './uiKit.js';
import { addButton } from './button.js';
import { VIEWPORT, ROW_H, ROW_GAP, TABS, BUY_AMOUNTS, ROW } from '../shared/listGeometry.js';
import { TEXT, DEPTH, TEX, EVENTS, REG, FONT_SIZE, SPACE } from '../shared/theme.js';
import { upgradesOnDom } from '../shared/formsFlag.js';
import { playSfx } from '../../sfx.js';

export const panelMethods = {
    buildPanel() {
        // Единственный источник значений — раскладка (this.L.panel/viewport/unlock);
        // applyPanelLayout ниже переставляет те же объекты по актуальной сетке.
        const p = this.L.panel;
        const v = this.L.viewport;
        // D8 фазы 3: на DOM-пути (и после обучения) Phaser-список не строится —
        // вкладки/ряды/пакет живут в DOM-панели. До tutorialDone — Phaser (развилка D3).
        const domPath = upgradesOnDom() && gameState.tutorialDone;

        this.panelImg = addImg(this, p.px, p.py, 'upgrades_panel_wood', p.pw, p.ph, 10);
        // Планка с заклёпками (143..200): заголовок по её центру
        this.panelTitle = makeLabel(this, p.px + p.pw / 2, p.py + p.titleDy, 'Улучшения', p.titleSize, TEXT.cream)
            .setOrigin(0.5)
            .setDepth(DEPTH.ui);

        // Вкладки: одна ширина со списком, две по p.tabW + зазор SPACE.sm
        const tabCY = p.py + p.tabsCY;
        this.tabBtns = domPath
            ? []
            : TABS.map((tab, i) => this.buildTabButton(v.x + i * (p.tabW + SPACE.sm), tabCY - p.tabH / 2, tab));

        // Строка тира + переключатель мультипокупки (в границах списка)
        this.tierLabel = makeLabel(this, v.x + p.tierInset, p.py + p.tierCY, '', p.tierLabelSize, '#c8b78e');
        this.tierLabel.setOrigin(0, 0.5).setDepth(DEPTH.ui);
        if (domPath) {
            // Объекты строятся для совместимости раскладки, но скрыты (syncDomUpgradesChrome):
            // реальные вкладки/пакет — в DOM-панели.
            const amount = this.buildAmountButton(v.x + v.w - p.amountPadRight - p.amountW / 2, p.py + p.tierCY);
            this.amountC = amount.c;
            this.amountBg = amount.bg;
            this.amountC.setVisible(false);
        } else {
            const amount = this.buildAmountButton(v.x + v.w - p.amountPadRight - p.amountW / 2, p.py + p.tierCY);
            this.amountC = amount.c;
            this.amountBg = amount.bg;
        }

        // Фон вьюпорта (для драга). Клиппинг списка — через отдельную камеру с viewport
        // (GeometryMask в Phaser 4 работает только в Canvas; в WebGL игнорируется).
        this.viewportBg = this.add
            .rectangle(
                VIEWPORT.x + VIEWPORT.w / 2,
                VIEWPORT.y + VIEWPORT.h / 2,
                VIEWPORT.w,
                VIEWPORT.h,
                0x000000,
                0.001
            )
            .setDepth(DEPTH.ui);

        // Контейнер в мировых координатах (0,0): ряды локальны относительно вьюпорта,
        // а экранный сдвиг делает сама камера (viewport + scroll), см. setupListCamera
        this.listContent = this.add.container(0, 0).setDepth(DEPTH.uiAbove);

        // Ряды всех улучшений строятся один раз; видимость и позиции
        // пересчитываются каждый кадр в refreshUi (фильтр вкладки + «доступные + 1»)
        this.rows = domPath ? [] : UPGRADES.map((def) => this.buildRow(def));
        this._rowsBuiltW = VIEWPORT.w;
        this._rowsBuiltS = this._adaptiveScale;
    },

    buildTabButton(x, y, tab) {
        const p = this.L.panel;
        const w = p.tabW;
        const h = p.tabH;
        const c = this.add.container(x + w / 2, y + h / 2).setDepth(DEPTH.ui);
        const bg = addImgC(this, 0, 0, TEX.buttonDisabled, w, h);
        const lbl = makeLabel(this, 0, 0, tab.label, p.tabLabelSize, TEXT.muted).setOrigin(0.5);
        c.add([bg, lbl]);
        setHitRect(c, w, h, true);
        c.on('pointerdown', () => this.switchTab(tab.id));

        return { tab, c, bg, lbl };
    },

    buildAmountButton(cx, cy) {
        const p = this.L.panel;
        const w = p.amountW;
        const h = p.amountH;
        const c = this.add.container(cx, cy).setDepth(DEPTH.ui);
        const bg = addImgC(this, 0, 0, TEX.button, w, h);
        this.amountLbl = makeLabel(this, 0, 0, 'x1', p.amountSize, TEXT.white).setOrigin(0.5);
        c.add([bg, this.amountLbl]);
        setHitRect(c, w, h, true);
        c.on('pointerdown', () => {
            const idx = BUY_AMOUNTS.indexOf(this.buyAmount);
            this.buyAmount = BUY_AMOUNTS[(idx + 1) % BUY_AMOUNTS.length];
            this.amountLbl.setText(this.buyAmount === 'max' ? 'МАКС' : 'x' + this.buyAmount);
            this.refreshUi();
        });

        return { c, bg };
    },

    // Драг списка пальцем по всей площади вьюпорта (мобилки: wheel недоступен,
    // стрелки не нужны). Покупка ряда висит на pointerup и гасится флагом
    // _listDragging — жест, начатый на кнопке, скроллит, а не покупает.
    setupListDrag() {
        const inViewport = (p) =>
            p.x >= VIEWPORT.x - 6 &&
            p.x <= VIEWPORT.x + VIEWPORT.w + 6 &&
            p.y >= VIEWPORT.y - 6 &&
            p.y <= VIEWPORT.y + VIEWPORT.h + 6;
        this.input.on('pointerdown', (p) => {
            if (this.registry.get(REG.blockLocked) || !inViewport(p)) {
                return;
            }

            this._dragId = p.id;
            this._dragStartY = p.y;
            this._dragStartScroll = this.scrollPos;
            this._listDragging = false;
            this._listTapSlop = tapSlopPx(this, this.L.W);
        });
        this.input.on('pointermove', (p) => {
            if (p.id !== this._dragId || !p.isDown) {
                return;
            }

            const delta = this._dragStartY - p.y;
            if (!this._listDragging && Math.abs(delta) > this._listTapSlop) {
                this._listDragging = true;
            }

            if (this._listDragging) {
                this.scrollPos = Phaser.Math.Clamp(this._dragStartScroll + delta, 0, this.maxScroll);
                this.updateScroll();
            }
        });
        const endDrag = (p) => {
            if (p && p.id !== this._dragId) {
                return;
            }

            this._dragId = null;
            // флаг сбрасываем в следующем кадре: pointerup на кнопке срабатывает
            // раньше scene pointerup — покупка после лёгкого сдвига (<6px) валидна
            this.time.delayedCall(0, () => {
                this._listDragging = false;
            });
        };
        this.input.on('pointerup', endDrag);
        this.input.on('pointerupoutside', endDrag);
    },

    // Ряды строятся шириной с вьюпорт; при смене ориентации (296 <-> ~596) — пересборка
    rebuildRows() {
        for (const row of this.rows) {
            row.rc.destroy();
        }

        this.rows = UPGRADES.map((def) => this.buildRow(def));
        this._rowsBuiltW = VIEWPORT.w;
        this._rowsBuiltS = this._adaptiveScale;
        this.refreshUi();
    },

    switchTab(tab) {
        // Фасад (D6): на DOM-пути вкладка — DOM-кнопка, Phaser-ряды не трогаем
        if (this.domUpgrades) {
            this.activeTab = tab;
            this.domUpgrades.switchTab(tab);

            return;
        }

        if (this.activeTab === tab) {
            return;
        }

        this.activeTab = tab;
        this.scrollPos = 0;
        this.refreshUi();
    },

    // Геометрия ряда по ориентации: в портрете карточки шире (624) — кегли и
    // кнопка крупнее (FIT-даунскейл ~0.52 на телефонах), ряд выше под 2 строки.
    // Ландшафтные значения = исторические константы ROW (296x96) 1:1.
    rowGeom() {
        const key = `${this.L.portrait ? 'p' : 'l'}|${this._adaptiveScale}`;
        if (this._rowGeomKey === key) {
            return this._rowGeomCache;
        }

        this._rowGeomKey = key;
        if (this.L.portrait) {
            const s = this._adaptiveScale;
            // Спека редизайна мобильной панели: ряд 132 (тач-таргет «Купить»
            // 148x88), «ур. N» переезжает в строку имени наверх, цена под
            // описанием. Кегли по _adaptiveScale с клампами, без переносов
            const nameSize = Math.round(18 * Math.min(s, 1.5));
            // Минимум 18: «Квантовая лаборатория» при 20px (13*1.5) давала 280px
            // против nameMaxW 277 — Monocraft advance ~0.667em (аудит NAME-TOO-LONG)
            const nameMin = Math.round(12 * Math.min(s, 1.5));
            const nameSizes = [];
            for (let v = nameSize; v >= nameMin; v--) {
                nameSizes.push(v);
            }

            const descSize = Math.round(14 * Math.min(s, 1.5));
            const descY = Math.max(34, Math.round(10 + nameSize * 1.2 + 3));
            const geom = {
                h: 132,
                iconCY: 66,
                iconSize: Phaser.Math.Clamp(Math.round(48 * s), 56, 64),
                nameY: 12,
                nameSizes,
                descY,
                descSize,
                priceY: 102,
                priceSize: Math.round(15 * Math.min(s, 1.3)),
                priceIconSize: Math.round(18 * Math.min(s, 1.3)),
                levelY: 14,
                levelSize: Math.round(14 * Math.min(s, 1.3)),
                rightInset: 18,
                btnY: 26,
                btnW: 148,
                btnH: 88,
                btnSize: Math.round(15 * Math.min(s, 1.33)),
                lockSize: Math.round(13 * Math.min(s, 1.3))
            };
            this._rowGeomCache = geom;

            return geom;
        }

        const geom = {
            h: ROW_H,
            iconCY: ROW.iconY,
            iconSize: 40,
            nameY: ROW.nameY,
            nameSizes: [15, 14, 13, 12, 11, 10],
            descY: ROW.descY,
            descSize: ROW.descSize,
            priceY: ROW.priceY,
            priceSize: 13,
            priceIconSize: 16,
            levelSize: 12,
            levelY: ROW.priceY,
            rightInset: 12,
            btnY: ROW.btnY,
            btnW: ROW.btnW,
            btnH: ROW.btnH,
            btnSize: 14,
            lockSize: 11
        };
        this._rowGeomCache = geom;

        return geom;
    },

    buildRow(def) {
        const g = this.rowGeom();
        const w = VIEWPORT.w;
        const h = g.h;
        // Внутренние x-позиции масштабируются от ширины карточки (портрет — широкие
        // ряды): ниша иконки и текст привязаны к пропорциям текстуры (source 835x218,
        // ниша x36..193 центр 118, y44..181). Ландшафт (296) даёт ровно прежние
        // iconX=42 / textX=100 / nameMaxW=182.
        const f = w / 835;
        const iconCX = Math.round(118 * f);
        const textX = Math.round(186 * f) + 34;
        // Кнопка у правого края; описание ограничено зоной кнопки и не пересекает её.
        const btnW = g.btnW;
        const btnH = g.btnH;
        const btnX = w - g.rightInset - btnW;
        // В портрете имя до 27px: его низ (~42) ниже верха кнопки (btnY 28), и
        // длинное имя («Квантовая лаборатория») печаталось поверх кнопки
        // (скриншот тира 6). Ограничение — левая кромка кнопки. В ландшафте
        // имя выше кнопки (низ ~26 < 28) — ширина не связана с ней.
        const nameMaxW = this.L.portrait ? btnX - textX - 8 : w - textX - 14;
        const descWrap = btnX - textX - 4;

        // Контейнер ряда: позиция по Y пересчитывается в refreshUi (фильтр вкладки
        // и «доступные + 1 следующее» скрывают/сдвигают ряды динамически)
        const rc = this.add.container(0, 0);
        this.listContent.add(rc);

        const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, h, 11);
        // Слот уже ВСТРОЕН в текстуру карточки (тёмная ниша слева) — отдельная рамка
        // не нужна: раньше она дублировала нишу и давала «сдвиг»/двойную рамку слева.
        const iconKey = def.id === 'pickaxe' ? 'pickaxe_wooden' : def.icon || 'gear_icon';
        const iconCY = g.iconCY;
        const icon = this.add.image(0, 0, iconKey).setDepth(DEPTH.uiIcon);
        this.placeIcon(icon, iconKey, iconCX, iconCY, g.iconSize);
        const iconScale = this.iconMetrics(iconKey).scale;

        const nameText = makeLabel(this, textX, g.nameY, def.name, g.nameSizes[0], TEXT.white);
        nameText.setOrigin(0, 0);
        // Длинные имена («Квантовая лаборатория», «Гравитационный резак») ужимаются
        // кеглем под всю ширину карточки — раньше они наезжали на «ур. N» и край.
        for (const size of g.nameSizes) {
            nameText.setFontSize(size);
            if (nameText.width <= nameMaxW) {
                break;
            }
        }

        const descText = makeLabel(this, textX, g.descY, def.effect, g.descSize, '#cfcfcf', {
            wordWrap: { width: descWrap }
        });
        descText.setOrigin(0, 0);
        if (this.L.portrait) {
            fitOneLine(descText, g.descSize, 11);
        }

        const priceIcon = this.add.image(0, 0, 'coal_nugget');
        this.placeIcon(priceIcon, 'coal_nugget', textX + 6, g.priceY, g.priceIconSize);
        const priceCX = textX + 6;
        const priceCY = g.priceY;
        const priceText = makeLabel(this, textX + 16, g.priceY, '', g.priceSize, TEXT.gold);
        priceText.setOrigin(0, 0.5);
        // «ур. N» — верхний правый угол ряда (в строке имени); под кнопкой места
        // больше нет (ряд 132, кнопка 88)
        const levelText = makeLabel(this, w - g.rightInset, g.levelY, 'ур. 0', g.levelSize, TEXT.bright);
        levelText.setOrigin(1, 0.5);

        const { bg: btn, label: btnText } = addButton(this, btnX + btnW / 2, g.btnY + btnH / 2, {
            kind: 'image',
            w: btnW,
            h: btnH,
            key: TEX.button,
            text: 'Купить',
            fontSize: g.btnSize,
            color: TEXT.white,
            depth: DEPTH.ui,
            fitMaxW: btnW - SPACE.md,
            fitMin: 8
        });
        // Хит-колонка кнопки на всю высоту ряда (>= 40 CSS px на телефоне;
        // рамка касания не выходит за карточку ряда — соседние ряды дальше)
        setHitWorldRect(btn, btnX - 6, 0, btnW + 12, h);

        const lockText = makeLabel(this, textX, g.priceY, '', g.lockSize, TEXT.bad);
        lockText.setOrigin(0, 0.5);

        rc.add([card, icon, nameText, descText, priceIcon, priceText, levelText, btn, btnText, lockText]);

        const row = {
            def,
            rc,
            icon,
            iconScale,
            iconCX,
            iconCY,
            nameText,
            descText,
            priceText,
            priceIcon,
            priceCX,
            priceCY,
            levelText,
            btn,
            btnText,
            lockText,
            nameMaxW,
            textX
        };

        // Покупка на pointerup (а не pointerdown): драг списка, начатый на кнопке,
        // не должен покупать; тап = down+up на кнопке.
        btn.on('pointerup', () => {
            if (this._listDragging) {
                return;
            }

            if (buyBulk(def.id, this.buyAmount)) {
                playSfx(this, 'purchase');
                this.tweens.add({
                    targets: icon,
                    scale: { from: iconScale, to: iconScale * 1.25 },
                    duration: 90,
                    yoyo: true
                });
                saveGame();
                this.refreshUi();
            }
        });
        btn.on('pointerover', () => {
            if (canBuy(def.id)) {
                btn.setTexture(TEX.buttonHover);
            }
        });
        btn.on('pointerout', () => {
            if (canBuy(def.id)) {
                btn.setTexture(TEX.button);
            }
        });

        return row;
    },

    updateScroll() {
        // Прокрутка через скролл камеры — камера клипает рендер по viewport
        this.listCam.scrollY = this.scrollPos;
    },

    setupListCamera() {
        // Отдельная камера рендерит ТОЛЬКО список и клипает его по своей области.
        // Главная камера список игнорирует, камера списка — весь остальной UI.
        // Viewport камеры — экранный прямоугольник; мир она показывает от scrollX/scrollY,
        // поэтому контейнер списка стоит в (0,0), а прокрутка = scrollY камеры.
        this.listCam = this.cameras.add(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h, false, 'listCam');
        this.listCam.setRoundPixels(true);
        this.cameras.main.ignore(this.listContent);
        const others = this.children.list.filter((o) => o !== this.listContent);
        this.listCam.ignore(others);
        this.updateScroll();
    },

    // Всплывающие подписи создаются динамически — исключаем их из скролл-камер
    // (иначе списки и карта рисуют сдвинутые копии внутри своих вьюпортов)
    spawnFloat(x, y, text, size, color, extra = {}) {
        const float = makeLabel(this, x, y, text, size, color, extra);
        if (this.listCam) {
            float.cameraFilter |= this.listCam.id;
        }

        if (this.mapCam) {
            float.cameraFilter |= this.mapCam.id;
        }

        if (this.craftCam) {
            float.cameraFilter |= this.craftCam.id;
        }

        if (this.tutCam) {
            float.cameraFilter |= this.tutCam.id;
        }

        return float;
    },

    buildUnlockButton() {
        // Размер/позиция/кегли — из раскладки (this.L.unlock); applyUnlockLayout
        // переставляет те же значения при смене ориентации
        const u = this.L.unlock;
        const w = u.w;
        const h = u.h;
        const x = u.cx - w / 2;
        const y = u.y;
        this.unlockBtn = addNine(this, x, y, TEX.button, w, h, 15);
        // Хит 80 по высоте (ландшафт 52 видимых — 26-28 CSS px на телефоне);
        // по ширине полная кнопка, соседние интерактивные далеко
        setHitWorld(this.unlockBtn, w, Math.max(h, 80));
        this.unlockText = makeLabel(this, u.cx, y + h / 2, '', u.textSize, TEXT.white, { align: 'center' });
        this.unlockText.setOrigin(0.5).setDepth(DEPTH.unlockText);
        this.unlockBtn.on('pointerdown', () => {
            if (!canUnlockTier()) {
                return;
            }

            if (this.registry.get(REG.bossActive)) {
                return;
            }

            const next = getNextTier();
            unlockTier();
            playSfx(this, 'tier');
            const u = this.L.unlock;
            const float = this.spawnFloat(u.cx, u.y - 44, `Уровень шахты: ${next.name}!`, 28, next.floatColor);
            float.setOrigin(0.5).setDepth(DEPTH.floatText);
            this.tweens.add({
                targets: float,
                y: float.y - 60,
                alpha: 0,
                duration: 1400,
                ease: 'Cubic.easeOut',
                onComplete: () => float.destroy()
            });
            saveGame();
            this.game.events.emit(EVENTS.tierChanged);
            this.refreshUi();
            this.openMap({ animate: true });
        });

        this.hint = makeLabel(this, this.L.unlock.cx, this.L.unlock.hintY, '', this.L.unlock.hintSize, TEXT.soft, {
            align: 'center'
        });
        this.hint.setOrigin(0.5, 0.5);
        this.tweens.add({ targets: this.hint, alpha: { from: 1, to: 0.6 }, duration: 900, yoyo: true, repeat: -1 });
    },

    // Панель улучшений: заголовок, вкладки, строка тира, мультипокупка, список
    applyPanelLayout(L, s) {
        const h = L.hud;
        // Панель улучшений + шапка (вкладки/тир/мультипокупка)
        const p = L.panel;
        this.panelImg.setPosition(p.px + p.pw / 2, p.py + p.ph / 2);
        this.panelImg.setDisplaySize(p.pw, p.ph);
        this.panelTitle.setPosition(p.px + p.pw / 2, p.py + p.titleDy);
        this.panelTitle.setFontSize(p.titleSize);
        // В портрете звёзды на планке заголовка панели у правого края;
        // в ландшафте — под HUD-баром слева от панели
        if (L.portrait) {
            this.starsText.setPosition(h.starsRight, h.starsY);
        }
        // Ландшафт: звёзды ПОД HUD-баром, строкой бафов, СЛЕВА от панели —
        // прежний якорь «правый край бара» (x≈1256) ложился на верхнюю фаску
        // деревянной панели (900..1264, верх 124): звёзды резались о заклёпки
        else {
            this.starsText.setPosition(p.px - SPACE.md, h.barY + h.barH + 10);
        }

        // Вкладки: ширина из раскладки (ландшафт 145, портрет — половина списка)
        const tabGap = SPACE.sm;
        const tabW = p.tabW;
        const tabCY = p.py + p.tabsCY;
        this.tabBtns.forEach((t, i) => {
            t.c.setPosition(L.viewport.x + tabW / 2 + i * (tabW + tabGap), tabCY);
            t.bg.setDisplaySize(tabW, p.tabH);
            t.lbl.setFontSize(p.tabLabelSize);
            // Хит-зона должна следовать за визуальным размером вкладки
            setHitRect(t.c, tabW, p.tabH, true);
        });
        // В бою панель показывает «Снаряжение» — хром улучшений (вкладки, строка
        // тира, мультипокупка) скрывается целиком; в портрете заголовок панели
        // сам становится «Снаряжение» (отдельный gearTitle врезку не тратит)
        const chromeHidden = !!this.registry.get(REG.bossActive);
        if (L.portrait && chromeHidden) {
            if (this.panelTitle.text !== 'Снаряжение') {
                this.panelTitle.setText('Снаряжение');
            }

            this.panelTitle.setVisible(true);
            if (this.gearTitle) {
                this.gearTitle.setVisible(false);
            }
        } else {
            if (this.panelTitle.text === 'Снаряжение') {
                this.panelTitle.setText('Улучшения');
            }

            this.panelTitle.setVisible(!chromeHidden);
            if (this.gearTitle) {
                this.gearTitle.setVisible(true);
            }
        }

        for (const t of this.tabBtns) {
            t.c.setVisible(!chromeHidden);
        }

        this.tierLabel.setVisible(!chromeHidden);
        if (this.amountC) {
            this.amountC.setVisible(!chromeHidden);
        }

        this.tierLabel.setPosition(L.viewport.x + p.tierInset, p.py + p.tierCY);
        this.tierLabel.setFontSize(p.tierLabelSize);
        this._tierText = null; // кегль ужинается в refreshUi под новую ширину
        this.amountC.setPosition(L.viewport.x + L.viewport.w - p.amountPadRight - p.amountW / 2, p.py + p.tierCY);
        this.amountBg.setDisplaySize(p.amountW, p.amountH);
        this.amountLbl.setFontSize(p.amountSize);
        setHitRect(this.amountC, p.amountW, p.amountH, true);
        this.viewportBg.setPosition(L.viewport.x + L.viewport.w / 2, L.viewport.y + L.viewport.h / 2);
        this.viewportBg.setSize(L.viewport.w, L.viewport.h);

        // Список: камера клиппинга следует за вьюпортом; смена ширины или
        // портретного масштаба — пересборка рядов (rowGeom зависит от s)
        if (this.listCam) {
            this.listCam.setViewport(L.viewport.x, L.viewport.y, L.viewport.w, L.viewport.h);
        }

        if (this.rows && this.rows.length && (this._rowsBuiltW !== VIEWPORT.w || this._rowsBuiltS !== s)) {
            this.rebuildRows();
        }

        this._rowsBuiltW = VIEWPORT.w;
        this._rowsBuiltS = s;
    },

    // Кнопка спуска и подсказка
    applyUnlockLayout(L, s, dockWide) {
        // Кнопка спуска (в портрете живёт в доке, 300x92) + подсказка
        const u = L.unlock;
        // Размер и хит-зона ВСЕГДА от раскладки: портретный 300x92 не должен
        // «приезжать» в ландшафт при смене ориентации (текст уезжал за кнопку)
        this.unlockBtn.setSize(u.w, u.h);
        setHitWorld(this.unlockBtn, u.w, Math.max(u.h, 80));
        this.unlockBtn.setPosition(u.cx - u.w / 2, u.y);
        this.unlockText.setPosition(u.cx, u.y + u.h / 2);
        if (L.portrait) {
            // Две строки («Спуск: Медь» / «2500 угля»): однострочный текст
            // занимал всю ширину кнопки с зазором 2-3px (ревью); отступ
            // внутри кнопки — по 24 с краёв
            const ut = Phaser.Math.Clamp(Math.round(FONT_SIZE.cardTitle * Math.min(s, 1.25)), 20, 28);
            fitFontSize(this.unlockText, ut, u.w - 48, 16);
        } else {
            this.unlockText.setFontSize(u.textSize);
        }

        this.hint.setPosition(u.cx, u.hintY);
        this.hint.setFontSize(u.hintSize);
        // В бою спуск скрыт целиком (заблокирован; серая кнопка рядом с боссом
        // читалась как «вернуться в шахту» и наезжала на подсказку слотов);
        // в портрете — и когда нового тира нет (док: Карта/Крафт на всю ширину)
        const hideUnlock = dockWide;
        this.unlockBtn.setVisible(!hideUnlock);
        this.unlockText.setVisible(!hideUnlock);
        // Портрет: подсказка «оплата рудой…» скрыта всегда — цена уже на кнопке
        this.hint.setVisible(!hideUnlock && !L.portrait);
    },

    // Кнопка спуска, ETA-подсказка
    refreshUnlockButton() {
        const tier = TIERS[gameState.tier];
        // Кнопка спуска
        const next = getNextTier();
        // В бою спуск скрыт целиком (заблокирован; серая кнопка в бою вводила
        // в заблуждение и наезжала на подсказку слотов босса)
        const hideUnlock = !!this.registry.get(REG.bossActive);
        if (next) {
            this.unlockBtn.setVisible(!hideUnlock && !this._panelHidden);
            this.unlockText.setVisible(!hideUnlock && !this._panelHidden);
            this.unlockText.setText(
                this.L.portrait
                    ? `Спуск: ${next.name}\n${fmt(getNextUnlockPrice())} ${tier.gen || tier.name.toLowerCase()}`
                    : `Спуск: ${next.name} — ${fmt(getNextUnlockPrice())} ${tier.gen || tier.name.toLowerCase()}`
            );
            const bossLocked = !!this.registry.get(REG.bossActive);
            if (canUnlockTier() && !bossLocked) {
                this.unlockBtn.setTexture(TEX.button);
                this.unlockText.setColor(TEXT.white);
                if (!this.unlockPulse) {
                    this.unlockPulse = this.tweens.add({
                        targets: this.unlockBtn,
                        alpha: { from: 1, to: 0.75 },
                        duration: 500,
                        yoyo: true,
                        repeat: -1
                    });
                }
            } else {
                this.unlockBtn.setTexture(TEX.buttonDisabled);
                this.unlockText.setColor(TEXT.soft);
                if (this.unlockPulse) {
                    this.unlockPulse.stop();
                    this.unlockPulse = null;
                    this.unlockBtn.setAlpha(1);
                }
            }

            // Пока спуск не доступен — показываем ETA: цена-снапшот постоянна,
            // каждая покупка сокращает время на глазах.
            let hintTxt;
            if (canUnlockTier()) {
                hintTxt = `оплата рудой текущего уровня — блок станет ${next.adj}`;
            } else {
                hintTxt = `оплата рудой текущего уровня`;
            }

            if (hintTxt !== this._hintText) {
                this.hint.setText(hintTxt);
                this._hintText = hintTxt;
            }

            this.hint.setVisible(!this.L.portrait && !hideUnlock && !this._panelHidden);
        } else {
            this.unlockBtn.setVisible(false);
            this.unlockText.setVisible(false);
            const idleTxt = `Кликай по блоку, чтобы добывать ${tier.name.toLowerCase()}!`;
            if (idleTxt !== this._hintText) {
                this.hint.setText(idleTxt);
                this._hintText = idleTxt;
            }

            this.hint.setVisible(!this.L.portrait && !this._panelHidden && !this.registry.get(REG.blockLocked));
        }
    },

    // Вкладки: активная подсветка
    refreshTabs() {
        // D8 фазы 3: на DOM-пути вкладки — DOM-кнопки, Phaser-обвязка не обновляется
        if (this.domUpgrades) {
            return;
        }

        // Вкладки: активная подсветка
        for (const t of this.tabBtns) {
            const active = t.tab.id === this.activeTab;
            t.bg.setTexture(active ? TEX.button : TEX.buttonDisabled);
            t.lbl.setColor(active ? TEXT.white : TEXT.muted);
        }
    },

    // Ряды улучшений: фильтр по вкладке, цены, доступность
    refreshRows() {
        // D8 фазы 3: на DOM-пути Phaser-ряды не строятся/не обновляются —
        // иначе W3 мерил бы двойную работу; DOM-панель читает снимок моста.
        if (this.domUpgrades) {
            return;
        }

        const tier = TIERS[gameState.tier];
        // Ряды: фильтр по вкладке + «доступные + 1 следующее», перепозиционирование
        const rowH = this.rowGeom().h;
        let y = 0;
        for (const row of this.rows) {
            const def = row.def;
            const show = def.tab === this.activeTab && isUpgradeVisible(def.id);
            row.rc.setVisible(show);
            if (!show) {
                continue;
            }

            row.rc.setY(y);
            y += rowH + ROW_GAP;

            const level = getUpgradeLevel(def.id);
            const maxed = isMaxed(def.id);
            const available = isUpgradeAvailable(def.id);
            const amount = this.buyAmount;

            row.levelText.setText(`ур. ${level}`);
            row.levelText.setVisible(true); // гейт-ряды ниже прячут её (коллизия с «нужно: …»)

            // Иконка кирки меняется по уровню + нормируем контент под слот
            if (def.id === 'pickaxe') {
                const icons = ['pickaxe_wooden', 'pickaxe_stone', 'pickaxe_iron', 'pickaxe_diamond'];
                const key = icons[Math.min(Math.floor(level / 3), icons.length - 1)];
                this.placeIcon(row.icon, key, row.iconCX, row.iconCY, this.rowGeom().iconSize);
            }

            if (!available) {
                row.btn.setTexture(TEX.buttonDisabled);
                row.btnText.setText('—').setColor(TEXT.muted);
                // Гейт глубины приоритетнее: пока шахта мелкая, цепочку всё равно не докрутить.
                // Нумерация как в ярлыке «уровень шахты: N — Руда» (с единицы: уголь = 1).
                const lockTxt =
                    def.tier !== undefined && gameState.tier < def.tier
                        ? `нужно: шахта ${def.tier + 1}`
                        : `нужно: ${getUpgradeDef(def.requires.id).name} ${def.requires.level}`;
                row.lockText.setText(lockTxt);
                // «ур. 0» справа наезжала на длинное «нужно: …» (скриншот игрока) —
                // у заблокированного улучшения уровень неинформативен, прячем бейдж
                row.levelText.setVisible(false);
                // и ужинаем кегль, если требование шире карточки до правого края
                const lockMaxW = VIEWPORT.w - row.textX - 6;
                let lockSize = this.rowGeom().lockSize;
                row.lockText.setFontSize(lockSize);
                while (lockSize > 9 && row.lockText.width > lockMaxW) {
                    lockSize -= 1;
                    row.lockText.setFontSize(lockSize);
                }

                row.priceIcon.setVisible(false);
                row.priceText.setVisible(false);
            } else if (maxed) {
                row.btn.setTexture(TEX.buttonDisabled);
                row.btnText.setText('макс').setColor(TEXT.soft);
                row.lockText.setText('');
                row.priceIcon.setVisible(false);
                row.priceText.setVisible(true);
                row.priceText.setText('макс').setColor(TEXT.dim);
            } else if (amount === 'max') {
                // МАКС: покупаем максимум уровней, на которые хватает руды
                const r = getAffordableBulk(def.id, Infinity);
                const afford = r.n > 0;
                row.btn.setTexture(afford ? TEX.button : TEX.buttonDisabled);
                row.btnText.setText('Купить').setColor(afford ? TEXT.white : TEXT.muted);
                row.lockText.setText('');
                this.placeIcon(row.priceIcon, tier.iconKey, row.priceCX, row.priceCY, this.rowGeom().priceIconSize);
                row.priceIcon.setVisible(true);
                row.priceText.setVisible(true);
                const priceStr =
                    r.n > 0 ? (r.n > 1 ? `${fmt(r.total)} x${r.n}` : fmt(r.total)) : fmt(getUpgradeCost(def.id));
                row.priceText.setText(priceStr).setColor(TEXT.gold);
            } else {
                // Строгий пакет x{amount}: либо весь пакет целиком, либо ничего
                // (ужимается только лимитом уровней самого улучшения)
                const b = getBulkCost(def.id, amount);
                const r = getAffordableBulk(def.id, amount);
                const afford = b.n > 0 && r.n === b.n;
                row.btn.setTexture(afford ? TEX.button : TEX.buttonDisabled);
                row.btnText.setText('Купить').setColor(afford ? TEXT.white : TEXT.muted);
                row.lockText.setText('');
                this.placeIcon(row.priceIcon, tier.iconKey, row.priceCX, row.priceCY, this.rowGeom().priceIconSize);
                row.priceIcon.setVisible(true);
                row.priceText.setVisible(true);
                const priceStr = b.n < amount ? `${fmt(b.total)} x${b.n}` : fmt(b.total);
                row.priceText.setText(priceStr).setColor(TEXT.gold);
            }
        }

        this.maxScroll = Math.max(0, y - VIEWPORT.h + ROW_GAP);
        this.scrollPos = Phaser.Math.Clamp(this.scrollPos, 0, this.maxScroll);
        this.updateScroll();
    }
};
