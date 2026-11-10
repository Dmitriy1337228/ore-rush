import Phaser from 'phaser';
import {
    gameState, TIERS, UPGRADES, getUpgradeDef, getUpgradeLevel, getUpgradeCost,
    isMaxed, isUpgradeAvailable, canBuy, buyUpgrade, buyBulk, getAffordableBulk,
    isUpgradeVisible,
    getClickDamage, getOrePerSecond, getCritChance,
    getOfflineRate, getOfflineCapSeconds, OFFLINE_CAP_HOURS,
    canUnlockTier, getNextTier, unlockTier, getNextUnlockPrice,
    canPrestige, getStarsGain, doPrestige, PRESTIGE_REQUIREMENT, getPrestigeMult, DIAMOND_INDEX,
    resetGame, saveGame, fmt, fmtDuration
} from '../state.js';

const FONT = '"Monocraft", "Inter", "Consolas", monospace';

// 9-slice: исходные размеры и отступы из манифеста spritecook-assets.json
const NS_SRC = {
    hud_bar_background: { l: 55, t: 55, r: 55, b: 55, w: 1892, h: 225 },
    upgrades_panel_wood: { l: 65, t: 65, r: 65, b: 65, w: 1029, h: 1119 },
    modal_panel_metal: { l: 60, t: 60, r: 60, b: 60, w: 849, h: 656 },
    upgrade_row_card_1: { l: 30, t: 30, r: 30, b: 30, w: 835, h: 218 },
    icon_slot_frame: { l: 40, t: 40, r: 40, b: 40, w: 229, h: 236 },
    buy_button_normal: { l: 40, t: 40, r: 40, b: 40, w: 267, h: 133 },
    buy_button_hover: { l: 40, t: 40, r: 40, b: 40, w: 261, h: 133 },
    buy_button_pressed: { l: 40, t: 40, r: 40, b: 40, w: 262, h: 133 },
    buy_button_disabled_gray: { l: 40, t: 40, r: 40, b: 40, w: 260, h: 133 },
    settings_button_wide: { l: 45, t: 50, r: 45, b: 50, w: 410, h: 161 },
    close_button_square: { l: 45, t: 45, r: 45, b: 45, w: 196, h: 191 }
};

function nsBorders(key, w, h) {
    const s = NS_SRC[key];
    if (!s) return { left: 0, top: 0, right: 0, bottom: 0 };
    const f = Math.min(w / s.w, h / s.h, 1);
    const b = (v) => Math.max(3, Math.round(v * Math.max(f, 0.25)));
    return { left: b(s.l), top: b(s.t), right: b(s.r), bottom: b(s.b) };
}

function addNine(scene, x, y, key, w, h, depth = 0) {
    const b = nsBorders(key, w, h);
    const ns = scene.add.nineslice(x, y, key, null, w, h, b.left, b.right, b.top, b.bottom);
    ns.setOrigin(0, 0).setDepth(depth);
    return ns;
}

function addNineC(scene, x, y, key, w, h) {
    const b = nsBorders(key, w, h);
    return scene.add.nineslice(x, y, key, null, w, h, b.left, b.right, b.top, b.bottom);
}

// Фиксированные элементы: обычный Image с setDisplaySize вместо NineSlice.
// NineSlice со «масштированными» бордами сплющивает центр текстуры (борды в Phaser
// берутся из текстуры 1:1, не масштабируются) — врезки ложатся непредсказуемо.
// Image сохраняет пропорции текстуры, врезки считаются линейным масштабом.
function addImg(scene, x, y, key, w, h, depth = 0) { // x,y = левый верхний угол
    const img = scene.add.image(x + w / 2, y + h / 2, key).setDisplaySize(w, h);
    img.setOrigin(0.5).setDepth(depth);
    return img;
}

function addImgC(scene, x, y, key, w, h) { // origin (0.5), координаты центра (контейнеры модалок)
    return scene.add.image(x, y, key).setDisplaySize(w, h);
}

function makeLabel(scene, x, y, text, size, color, style = {}) {
    // Monocraft — пиксельный шрифт без жирных начертаний: синтетический bold его «замыливает»
    const { fontStyle, ...rest } = style;
    return scene.add.text(x, y, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        color,
        resolution: 2,
        ...rest
    });
}

// Вьюпорт списка: по внутренней зоне деревянной панели.
// Панель 364x582 (image): face source x73..964, y208..1058 -> drawn x 926..1241, y 232..674
// Заголовок на планке (143..200), вкладки на раме (200..232), строка тира+мультипокупки
// на верхней кромке фаски (232..258), список — 262..666.
const VIEWPORT = { x: 934, y: 262, w: 296, h: 402 };
const ROW_H = 96;
const ROW_GAP = 6;

const TABS = [
    { id: 'equipment', label: 'Оборудование' },
    { id: 'enhance',   label: 'Усиления' }
];
const BUY_AMOUNTS = [1, 10, 100];

// Отступы ряда (карточка 296x96: face source x44..817, y16..202 -> drawn x16..290, y7..89)
const ROW = {
    slotSize: 68,       // (устарело: слот встроен в текстуру карточки)
    iconX: 42,          // центр встроенной ниши карточки (source x50..186 -> drawn 17.7..65.9)
    iconY: 50,          // (source y44..181 -> drawn 19.4..79.7)
    textX: 100,         // колонка текста
    descSize: 11,       // 11px: вместимость ~12+ символов на строку при вариативности метрик шрифта
    btnW: 84,
    btnH: 40,
    // Вертикальный стек ряда (y от верха карточки, зазоры заданы явно):
    // имя 8..25 -> описание 30..58 -> цена 62.5..77.5; «ур.» 8..22 -> кнопка 28..68.
    // face карточки 7..89: всё содержимое внутри с запасом >= 4px.
    nameY: 8,
    descY: 30,
    priceY: 72,
    btnY: 28
};

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this.scrollPos = 0;
        this.maxScroll = 0;
        this.activeTab = 'equipment'; // вкладка панели улучшений
        this.buyAmount = 1;           // мультипокупка: 1 / 10 / 100
    }

    create() {
        if (import.meta.env.DEV) window.__fmt = fmt; // хук для автопроверок
        this.buildHud();
        this.buildPanel();
        this.buildUnlockButton();
        this.buildModal();
        this.buildOfflineModal();
        this.setupListCamera();

        this.input.on('wheel', (pointer, over, dx, dy) => {
            if (pointer.x >= VIEWPORT.x - 10 && pointer.x <= VIEWPORT.x + VIEWPORT.w + 10
                && pointer.y >= VIEWPORT.y - 10 && pointer.y <= VIEWPORT.y + VIEWPORT.h + 10) {
                this.scrollPos = Phaser.Math.Clamp(this.scrollPos + dy * 0.5, 0, this.maxScroll);
                this.updateScroll();
            }
        });

        // Драг по списку
        this.viewportBg.setInteractive();
        this.viewportBg.on('pointermove', (pointer) => {
            if (!pointer.isDown || !this.dragStartY) return;
            this.scrollPos = Phaser.Math.Clamp(this.dragStartScroll - (pointer.y - this.dragStartY), 0, this.maxScroll);
            this.updateScroll();
        });
        this.viewportBg.on('pointerdown', (pointer) => {
            this.dragStartY = pointer.y;
            this.dragStartScroll = this.scrollPos;
        });
        this.input.on('pointerup', () => { this.dragStartY = null; });

        this.game.events.on('ui-refresh', () => this.refreshUi());

        // Офлайн-модалка по событию: симуляция из DevPanel и реальный возврат
        // во вкладку идут по одному пути (registry.offlineInfo + offline-applied)
        this.game.events.on('offline-applied', (info) => {
            if (this.offlineModal.visible) return;
            this.showOfflineModal(info);
        });

        if (this.registry.get('offlineInfo')) {
            this.time.delayedCall(400, () => this.showOfflineModal(this.registry.get('offlineInfo')));
        }

        this.refreshUi();
    }

    // ---------- HUD ----------

    buildHud() {
        // Бар 1250x112 изображением (пропорции текстуры сохранены).
        // Врезка source 41..171 (темная зона) -> при масштабе 112/225=0.4978 рисуется
        // в y 30..95 (центр 62.5). Пары текстов выровнены по нижней кромке (origin 0,1):
        // так совпадают базовые линии шрифтов разных размеров.
        addImg(this, 16, 10, 'hud_bar_background', 1250, 112, 10);

        this.oreIcon = this.add.image(78, 62, TIERS[gameState.tier].iconKey).setDepth(11);
        this.placeIcon(this.oreIcon, TIERS[gameState.tier].iconKey, 78, 62, 48);
        this.coalText = makeLabel(this, 112, 76, '0', 30, '#ffffff');
        this.coalText.setOrigin(0, 1).setDepth(11);
        this.oreName = makeLabel(this, 0, 76, TIERS[gameState.tier].name, 13, '#c8c8c8');
        this.oreName.setOrigin(0, 1).setDepth(11); // x обновляется от ширины счётчика

        this.gpsIcon = this.add.image(420, 62, TIERS[gameState.tier].iconKey).setDepth(11);
        this.placeIcon(this.gpsIcon, TIERS[gameState.tier].iconKey, 420, 62, 26);
        this.gpsText = makeLabel(this, 450, 74, '', 20, '#8fd18f');
        this.gpsText.setOrigin(0, 1).setDepth(11);
        this.statsLine = makeLabel(this, 0, 74, '', 14, '#c8c8c8');
        this.statsLine.setOrigin(0, 1).setDepth(11); // x обновляется от ширины gps
        // Звёзды престижа: фиксированная зона ПЕРЕД кнопкой «Настройки» (правый край,
        // origin 1,0.5 — растут влево, не наезжают на кнопку). Зазор до кнопки 12px.
        this.starsText = makeLabel(this, 1050, 62, '', 16, '#ffd75e');
        this.starsText.setOrigin(1, 0.5).setDepth(11);

        // Кнопка «Настройки»: изображение 160x48, центр по врезке (62), внутри
        // горизонтальной врезки бара (source face 47..1844 -> drawn 47..1234)
        const btnW = 160;
        const btnH = 48;
        const btnX = 1234 - 8 - btnW;
        const btnY = 62 - btnH / 2;
        this.settingsBtn = addImg(this, btnX, btnY, 'buy_button_disabled_gray', btnW, btnH, 11);
        // Hit-area в координатах кадра текстуры (origin 0.5 + setDisplaySize:
        // локальные координаты ввода — кадр 260x133, не отображаемый размер)
        this.settingsBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 260, 133), Phaser.Geom.Rectangle.Contains);
        this.add.image(btnX + 34, 62, 'gear_icon').setScale(0.22).setDepth(12);
        makeLabel(this, btnX + 98, 62, 'Настройки', 16, '#ffffff').setOrigin(0.5).setDepth(12);
        this.settingsBtn.on('pointerdown', () => this.openModal());
        this.settingsBtn.on('pointerover', () => this.settingsBtn.setAlpha(0.9));
        this.settingsBtn.on('pointerout', () => this.settingsBtn.setAlpha(1));
    }

    // ---------- Панель улучшений ----------

    buildPanel() {
        const px = 900;
        const py = 124;
        const pw = 364;
        const ph = 582;

        addImg(this, px, py, 'upgrades_panel_wood', pw, ph, 10);
        // Планка с заклёпками (143..200): заголовок по её центру
        makeLabel(this, px + pw / 2, 171, 'Улучшения', 24, '#ffe9b0').setOrigin(0.5).setDepth(11);

        // Вкладки на раме (200..232): Оборудование | Усиления
        this.tabBtns = TABS.map((tab, i) => this.buildTabButton(px + 11 + i * 174, 200, tab));

        // Строка тира + переключатель мультипокупки (верхняя кромка фаски 232..258)
        this.tierLabel = makeLabel(this, 930, 247, '', 13, '#c8b78e');
        this.tierLabel.setOrigin(0, 0.5).setDepth(11);
        this.buildAmountButton(1197, 247);

        // Фон вьюпорта (для драга). Клиппинг списка — через отдельную камеру с viewport
        // (GeometryMask в Phaser 4 работает только в Canvas; в WebGL игнорируется).
        this.viewportBg = this.add.rectangle(VIEWPORT.x + VIEWPORT.w / 2, VIEWPORT.y + VIEWPORT.h / 2, VIEWPORT.w, VIEWPORT.h, 0x000000, 0.001).setDepth(11);

        // Контейнер в мировых координатах (0,0): ряды локальны относительно вьюпорта,
        // а экранный сдвиг делает сама камера (viewport + scroll), см. setupListCamera
        this.listContent = this.add.container(0, 0).setDepth(12);

        // Ряды всех улучшений строятся один раз; видимость и позиции
        // пересчитываются каждый кадр в refreshUi (фильтр вкладки + «доступные + 1»)
        this.rows = UPGRADES.map((def) => this.buildRow(def));
    }

    buildTabButton(x, y, tab) {
        const w = 168;
        const h = 32;
        const c = this.add.container(x + w / 2, y + h / 2).setDepth(11);
        const bg = addImgC(this, 0, 0, 'buy_button_disabled_gray', w, h);
        const lbl = makeLabel(this, 0, 0, tab.label, 15, '#b0b0b0').setOrigin(0.5);
        c.add([bg, lbl]);
        c.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
        c.on('pointerdown', () => this.switchTab(tab.id));
        return { tab, c, bg, lbl };
    }

    buildAmountButton(cx, cy) {
        const w = 76;
        const h = 24;
        const c = this.add.container(cx, cy).setDepth(11);
        const bg = addImgC(this, 0, 0, 'buy_button_normal', w, h);
        this.amountLbl = makeLabel(this, 0, 0, 'x1', 14, '#ffffff').setOrigin(0.5);
        c.add([bg, this.amountLbl]);
        c.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
        c.on('pointerdown', () => {
            const idx = BUY_AMOUNTS.indexOf(this.buyAmount);
            this.buyAmount = BUY_AMOUNTS[(idx + 1) % BUY_AMOUNTS.length];
            this.amountLbl.setText('x' + this.buyAmount);
            this.refreshUi();
        });
    }

    switchTab(tab) {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.scrollPos = 0;
        this.refreshUi();
    }

    // Единый визуальный размер и ЦЕНТРИРОВКА иконок по КОНТЕНТУ.
    // Сканируем alpha-маску и берём КРУПНЕЙШУЮ СВЯЗНУЮ КОМПОНЕНТУ: отсечённый
    // мусор генерации (у pickaxe_diamond светлая полоса x0..6/y53..109) уходит
    // через setCrop, контент нормируется к 40px и центрируется в слоте.
    _iconMetrics = {};

    // Ручная обрезка генеративного мусора по краям текстур: у pickaxe_diamond
    // светлая полоса x0..6/y53..109 отсоединена визуально, но связана с телом
    // по альфе (тонкий мостик) — BFS её не отсекает, поэтому режем колонку явно.
    ICON_TRIMS = {
        pickaxe_diamond: { left: 17 },  // светлая стена x0..16 (яркая кромка x0..6 + тусклое продолжение)
        pickaxe_iron: { left: 8 }       // тусклая полустена x0..7 (lum <=36, невидима, но убрана)
    };

    iconMetrics(key) {
        if (this._iconMetrics[key]) return this._iconMetrics[key];
        const frame = this.textures.getFrame(key);
        const src = frame.source.image;
        const trim = this.ICON_TRIMS[key] || {};
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        const data = g.getImageData(0, 0, c.width, c.height).data;
        const W = c.width, H = c.height;
        const seen = new Uint8Array(W * H);
        let best = { count: 0, minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 };
        for (let sy = 0; sy < H; sy++) {
            for (let sx = 0; sx < W; sx++) {
                const idx = sy * W + sx;
                if (seen[idx] || data[idx * 4 + 3] <= 20) continue;
                if (trim.left !== undefined && sx < trim.left) { seen[idx] = 1; continue; }
                // BFS по прозрачности: собираем связную компоненту
                const queue = [idx];
                seen[idx] = 1;
                let count = 0, minX = sx, maxX = sx, minY = sy, maxY = sy;
                while (queue.length) {
                    const cur = queue.pop();
                    const cxx = cur % W, cyy = (cur - cxx) / W;
                    count++;
                    if (cxx < minX) minX = cxx;
                    if (cxx > maxX) maxX = cxx;
                    if (cyy < minY) minY = cyy;
                    if (cyy > maxY) maxY = cyy;
                    const nb = [cur - 1, cur + 1, cur - W, cur + W];
                    for (let n = 0; n < 4; n++) {
                        const nn = nb[n];
                        if (nn < 0 || nn >= W * H || seen[nn]) continue;
                        if (Math.abs((nn % W) - cxx) > 1) continue; // не через край строки
                        if (trim.left !== undefined && (nn % W) < trim.left) continue; // обрезка действует и при расширении
                        if (data[nn * 4 + 3] <= 20) continue;
                        seen[nn] = 1;
                        queue.push(nn);
                    }
                }
                if (count > best.count) best = { count, minX, minY, maxX, maxY };
            }
        }
        const cropW = best.maxX - best.minX + 1;
        const cropH = best.maxY - best.minY + 1;
        const m = {
            cropX: best.minX,
            cropY: best.minY,
            cropW,
            cropH,
            scale: 40 / Math.max(cropW, cropH)
        };
        this._iconMetrics[key] = m;
        return m;
    }

    placeIcon(icon, key, cx, cy, size = 40) {
        // Размер контента нормируется к `size` px: текстуры руд разного разрешения
        // (от 30 до 256px канваса) должны отображаться одинаково во всех местах UI.
        const m = this.iconMetrics(key);
        icon.setTexture(key);
        icon.setCrop(m.cropX, m.cropY, m.cropW, m.cropH);
        icon.setScale(size / Math.max(m.cropW, m.cropH));
        icon.setPosition(cx, cy);
    }

    buildRow(def) {
        const w = VIEWPORT.w;
        const h = ROW_H;
        const textX = ROW.textX;
        // Карточка 296x96 (image): face drawn x16..290, y7..89.
        // Кнопка 84x40 у правого края; цена — под уровнем;
        // описание ограничено зоной кнопки и не пересекает её.
        const btnW = ROW.btnW;
        const btnH = ROW.btnH;
        const btnX = w - 12 - btnW;
        const descWrap = btnX - textX - 4;

        // Контейнер ряда: позиция по Y пересчитывается в refreshUi (фильтр вкладки
        // и «доступные + 1 следующее» скрывают/сдвигают ряды динамически)
        const rc = this.add.container(0, 0);
        this.listContent.add(rc);

        const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, h, 11);
        // Слот уже ВСТРОЕН в текстуру карточки (тёмная ниша слева) — отдельная рамка
        // не нужна: раньше она дублировала нишу и давала «сдвиг»/двойную рамку слева.
        const iconKey = def.id === 'pickaxe' ? 'pickaxe_wooden' : (def.icon || 'gear_icon');
        const iconCX = ROW.iconX;
        const iconCY = ROW.iconY;
        const icon = this.add.image(0, 0, iconKey).setDepth(13);
        this.placeIcon(icon, iconKey, iconCX, iconCY);
        const iconScale = this.iconMetrics(iconKey).scale;

        const nameText = makeLabel(this, textX, ROW.nameY, def.name, 15, '#ffffff');
        nameText.setOrigin(0, 0);
        const descText = makeLabel(this, textX, ROW.descY, def.effect, ROW.descSize, '#cfcfcf', { wordWrap: { width: descWrap } });
        descText.setOrigin(0, 0);
        const priceIcon = this.add.image(0, 0, 'coal_nugget');
        this.placeIcon(priceIcon, 'coal_nugget', textX + 6, ROW.priceY, 16);
        const priceCX = textX + 6;
        const priceCY = ROW.priceY;
        const priceText = makeLabel(this, textX + 16, ROW.priceY, '', 13, '#ffd75e');
        priceText.setOrigin(0, 0.5);
        const levelText = makeLabel(this, w - 14, ROW.nameY, 'ур. 0', 12, '#e8e8e8');
        levelText.setOrigin(1, 0);

        const btn = this.add.image(btnX + btnW / 2, ROW.btnY + btnH / 2, 'buy_button_normal').setDisplaySize(btnW, btnH).setDepth(11);
        btn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
        const btnText = makeLabel(this, btnX + btnW / 2, ROW.btnY + btnH / 2, 'Купить', 14, '#ffffff');
        btnText.setOrigin(0.5);

        const lockText = makeLabel(this, textX, ROW.priceY, '', 11, '#e09090');
        lockText.setOrigin(0, 0.5);

        rc.add([card, icon, nameText, descText, priceIcon, priceText, levelText, btn, btnText, lockText]);

        const row = { def, rc, icon, iconScale, iconCX, iconCY, nameText, descText, priceText, priceIcon, priceCX, priceCY, levelText, btn, btnText, lockText };

        btn.on('pointerdown', () => {
            if (buyBulk(def.id, this.buyAmount)) {
                this.tweens.add({ targets: icon, scale: { from: iconScale, to: iconScale * 1.25 }, duration: 90, yoyo: true });
                saveGame();
                this.refreshUi();
            }
        });
        btn.on('pointerover', () => { if (canBuy(def.id)) btn.setTexture('buy_button_hover'); });
        btn.on('pointerout', () => { if (canBuy(def.id)) btn.setTexture('buy_button_normal'); });

        return row;
    }

    updateScroll() {
        // Прокрутка через скролл камеры — камера клипает рендер по viewport
        this.listCam.scrollY = this.scrollPos;
    }

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
    }

    // Всплывающие подписи создаются динамически — исключаем их из камеры списка
    spawnFloat(x, y, text, size, color, extra = {}) {
        const float = makeLabel(this, x, y, text, size, color, extra);
        float.cameraFilter |= this.listCam.id;
        return float;
    }

    // ---------- Кнопка спуска на новый уровень шахты ----------

    buildUnlockButton() {
        const w = 520;
        const h = 52;
        const x = 400 - w / 2;
        const y = 604;
        this.unlockBtn = addNine(this, x, y, 'buy_button_normal', w, h, 15);
        this.unlockBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
        this.unlockText = makeLabel(this, 400, y + h / 2, '', 18, '#ffffff');
        this.unlockText.setOrigin(0.5).setDepth(16);
        this.unlockBtn.on('pointerdown', () => {
            if (!canUnlockTier()) return;
            const next = getNextTier();
            unlockTier();
            const float = this.spawnFloat(400, 560, `Уровень шахты: ${next.name}!`, 28, next.floatColor);
            float.setOrigin(0.5).setDepth(30);
            this.tweens.add({ targets: float, y: float.y - 60, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => float.destroy() });
            saveGame();
            this.game.events.emit('tier-changed');
            this.refreshUi();
        });

        this.hint = makeLabel(this, 400, 676, '', 14, '#c8c8c8', { align: 'center' });
        this.hint.setOrigin(0.5, 0.5);
        this.tweens.add({ targets: this.hint, alpha: { from: 1, to: 0.35 }, duration: 900, yoyo: true, repeat: -1 });
    }

    // ---------- Модалка: настройки + престиж ----------

    buildModal() {
        const pw = 560;
        const ph = 460;
        this.modalDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6)
            .setDepth(40).setVisible(false).setInteractive();
        this.modalDim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());

        this.modal = this.add.container(640, 360).setDepth(41).setVisible(false);

        const panel = addImgC(this, 0, 0, 'modal_panel_metal', pw, ph);
        // Врезка панели (image): content y -200..191, x -216..216 (контейнерные координаты)
        const title = makeLabel(this, 0, -180, 'Настройки', 30, '#ffe9b0').setOrigin(0.5);

        const cbW = 44;
        const closeBtn = addImgC(this, pw / 2 - 56, -ph / 2 + 54, 'close_button_square', cbW, cbW);
        // Hit-area в координатах кадра текстуры (196x191)
        closeBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 196, 191), Phaser.Geom.Rectangle.Contains);
        closeBtn.on('pointerdown', () => this.closeModal());

        this.modalStats = makeLabel(this, -pw / 2 + 56, -ph / 2 + 92, '', 15, '#d8d8d8', { lineSpacing: 8 });
        this.modalStats.setOrigin(0, 0);

        // Престиж
        const presTitle = makeLabel(this, 0, 10, 'Сброс шахты (Rebirth)', 20, '#ffe9b0').setOrigin(0.5, 0);
        this.prestigeInfo = makeLabel(this, 0, 44, '', 14, '#d8d8d8', { align: 'center', wordWrap: { width: pw - 120 }, lineSpacing: 6 });
        this.prestigeInfo.setOrigin(0.5, 0);

        const pbW = 240;
        const pbH = 44;
        this.prestigeBtn = addNineC(this, 0, 116, 'buy_button_disabled_gray', pbW, pbH);
        this.prestigeBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, pbW, pbH), Phaser.Geom.Rectangle.Contains);
        // addNineC ставит origin (0.5): координата кнопки = её центр, подпись — в тот же центр
        this.prestigeText = makeLabel(this, 0, 116, 'Сбросить шахту', 16, '#ffffff').setOrigin(0.5);
        this.prestigeBtn.on('pointerdown', () => this.tryPrestige());

        const rbW = 240;
        const rbH = 40;
        this.resetBtn = addNineC(this, 0, 168, 'buy_button_disabled_gray', rbW, rbH);
        this.resetBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, rbW, rbH), Phaser.Geom.Rectangle.Contains);
        this.resetText = makeLabel(this, 0, 168, 'Сбросить весь прогресс', 14, '#ffffff').setOrigin(0.5);
        this.resetBtn.on('pointerdown', () => this.tryReset());

        this.modal.add([panel, title, closeBtn, this.modalStats, presTitle, this.prestigeInfo, this.prestigeBtn, this.prestigeText, this.resetBtn, this.resetText]);
        this.prestigeArmed = false;
        this.resetArmed = false;
    }

    openModal() {
        this.prestigeArmed = false;
        this.resetArmed = false;
        this.prestigeText.setText('Сбросить шахту');
        this.resetText.setText('Сбросить весь прогресс');
        this.modalDim.setVisible(true);
        this.modal.setVisible(true);
        this.registry.set('blockLocked', true);
        this.refreshUi();
    }

    closeModal() {
        this.modalDim.setVisible(false);
        this.modal.setVisible(false);
        this.registry.set('blockLocked', false);
    }

    tryPrestige() {
        if (!canPrestige()) return;
        if (!this.prestigeArmed) {
            this.prestigeArmed = true;
            const gain = getStarsGain();
            this.prestigeText.setText(`Точно? +${gain} ★`);
            return;
        }
        const gain = doPrestige();
        this.prestigeArmed = false;
        saveGame();
        this.closeModal();
        this.game.events.emit('tier-changed');
        const float = this.spawnFloat(640, 300, `+${gain} ★ Множитель: x${getPrestigeMult().toFixed(1)}`, 26, '#ffd75e');
        float.setOrigin(0.5).setDepth(45);
        this.tweens.add({ targets: float, y: 240, alpha: 0, duration: 1600, onComplete: () => float.destroy() });
    }

    tryReset() {
        if (!this.resetArmed) {
            this.resetArmed = true;
            this.resetText.setText('Точно сбросить?');
            return;
        }
        resetGame();
        this.resetArmed = false;
        this.closeModal();
        this.game.events.emit('tier-changed');
        this.refreshUi();
    }

    // ---------- Модалка офлайн-дохода ----------

    buildOfflineModal() {
        const pw = 480;
        const ph = 300;
        this.offlineDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.65)
            .setDepth(50).setVisible(false).setInteractive();
        this.offlineDim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());

        this.offlineModal = this.add.container(640, 360).setDepth(51).setVisible(false);
        const panel = addImgC(this, 0, 0, 'modal_panel_metal', pw, ph);
        // Врезка: content y -131..175 (контейнерные)
        const title = makeLabel(this, 0, -114, 'С возвращением!', 26, '#ffe9b0').setOrigin(0.5);
        this.offlineBody = makeLabel(this, 0, -15, '', 16, '#d8d8d8', { align: 'center', lineSpacing: 10, wordWrap: { width: pw - 110 } });
        this.offlineBody.setOrigin(0.5);
        const okBtn = addNineC(this, 0, 96, 'buy_button_normal', 190, 46);
        okBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 190, 46), Phaser.Geom.Rectangle.Contains);
        const okText = makeLabel(this, 0, 96, 'Забрать', 17, '#ffffff').setOrigin(0.5);
        okBtn.on('pointerdown', () => this.hideOfflineModal());

        this.offlineModal.add([panel, title, this.offlineBody, okBtn, okText]);
    }

    showOfflineModal(info) {
        const tier = TIERS[gameState.tier];
        const text = [
            `Пока вас не было (${fmtDuration(info.seconds)}),`,
            `шахтёры добыли ${fmt(info.reward)} ${tier.name.toLowerCase()}`,
            '',
            `фоновая добыча: ${Math.round(getOfflineRate() * 100)}% · ${fmt(getOrePerSecond())} руды/сек`,
            `лимит склада: ${OFFLINE_CAP_HOURS[Math.min(getUpgradeLevel('warehouse'), 3)]} ч · учтено ${fmtDuration(info.counted)}`
        ].join('\n');
        this.offlineBody.setText(text);
        this.offlineDim.setVisible(true);
        this.offlineModal.setVisible(true);
        this.registry.set('blockLocked', true);
        this.registry.set('offlineInfo', null);
    }

    hideOfflineModal() {
        this.offlineDim.setVisible(false);
        this.offlineModal.setVisible(false);
        this.registry.set('blockLocked', false);
    }

    // ---------- Обновление UI (дифф-опрос каждый кадр) ----------

    refreshUi() {
        const tier = TIERS[gameState.tier];

        this.coalText.setText(fmt(gameState.ore));
        if (this.oreIcon.texture.key !== tier.iconKey) this.placeIcon(this.oreIcon, tier.iconKey, 78, 62, 48);
        this.oreName.setText(tier.name.toLowerCase());
        this.oreName.x = 112 + this.coalText.width + 10;
        if (this.gpsIcon.texture.key !== tier.iconKey) this.placeIcon(this.gpsIcon, tier.iconKey, 420, 62, 26);
        this.gpsText.setText(`+${fmt(getOrePerSecond())} руды/сек`);
        this.statsLine.setText(`клик: ${fmt(getClickDamage())} · крит: ${Math.round(getCritChance() * 100)}%`);
        this.statsLine.x = 450 + this.gpsText.width + 26;
        this.starsText.setText(gameState.stars > 0 ? `★ ${gameState.stars} (x${getPrestigeMult().toFixed(1)})` : '');
        // x звёзд фиксирован (правый край перед кнопкой «Настройки»), не двигается от статов
        this.tierLabel.setText(`уровень шахты: ${gameState.tier + 1} — ${tier.name}`);

        // Кнопка спуска
        const next = getNextTier();
        if (next) {
            this.unlockBtn.setVisible(true);
            this.unlockText.setVisible(true);
            this.unlockText.setText(`Спуск: ${next.name} — ${fmt(getNextUnlockPrice())} ${tier.gen || tier.name.toLowerCase()}`);
            if (canUnlockTier()) {
                this.unlockBtn.setTexture('buy_button_normal');
                this.unlockText.setColor('#ffffff');
                if (!this.unlockPulse) {
                    this.unlockPulse = this.tweens.add({ targets: this.unlockBtn, alpha: { from: 1, to: 0.75 }, duration: 500, yoyo: true, repeat: -1 });
                }
            } else {
                this.unlockBtn.setTexture('buy_button_disabled_gray');
                this.unlockText.setColor('#c8c8c8');
                if (this.unlockPulse) { this.unlockPulse.stop(); this.unlockPulse = null; this.unlockBtn.setAlpha(1); }
            }
            this.hint.setText(`оплата рудой текущего уровня — блок станет ${next.adj}`);
            this.hint.setVisible(true);
        } else {
            this.unlockBtn.setVisible(false);
            this.unlockText.setVisible(false);
            this.hint.setText(`Кликай по блоку, чтобы добывать ${tier.name.toLowerCase()}!`);
            this.hint.setVisible(!this.registry.get('blockLocked'));
        }

        // Вкладки: активная подсветка
        for (const t of this.tabBtns) {
            const active = t.tab.id === this.activeTab;
            t.bg.setTexture(active ? 'buy_button_normal' : 'buy_button_disabled_gray');
            t.lbl.setColor(active ? '#ffffff' : '#b0b0b0');
        }

        // Ряды: фильтр по вкладке + «доступные + 1 следующее», перепозиционирование
        let y = 0;
        for (const row of this.rows) {
            const def = row.def;
            const show = def.tab === this.activeTab && isUpgradeVisible(def.id);
            row.rc.setVisible(show);
            if (!show) continue;
            row.rc.setY(y);
            y += ROW_H + ROW_GAP;

            const level = getUpgradeLevel(def.id);
            const maxed = isMaxed(def.id);
            const available = isUpgradeAvailable(def.id);
            const amount = this.buyAmount;

            row.levelText.setText(`ур. ${level}`);

            // Иконка кирки меняется по уровню + нормируем контент под слот
            if (def.id === 'pickaxe') {
                const icons = ['pickaxe_wooden', 'pickaxe_stone', 'pickaxe_iron', 'pickaxe_diamond'];
                const key = icons[Math.min(Math.floor(level / 3), icons.length - 1)];
                this.placeIcon(row.icon, key, row.iconCX, row.iconCY);
            }

            if (!available) {
                row.btn.setTexture('buy_button_disabled_gray');
                row.btnText.setText('—').setColor('#b0b0b0');
                row.lockText.setText(`нужно: ${getUpgradeDef(def.requires.id).name} ${def.requires.level}`);
                row.priceIcon.setVisible(false);
                row.priceText.setVisible(false);
            } else if (maxed) {
                row.btn.setTexture('buy_button_disabled_gray');
                row.btnText.setText('макс').setColor('#c8c8c8');
                row.lockText.setText('');
                row.priceIcon.setVisible(false);
                row.priceText.setVisible(true);
                row.priceText.setText('макс').setColor('#9a9a9a');
            } else {
                // Мультипокупка: покупаем сколько хватает (до x{amount})
                const r = getAffordableBulk(def.id, amount);
                const afford = r.n > 0;
                row.btn.setTexture(afford ? 'buy_button_normal' : 'buy_button_disabled_gray');
                row.btnText.setText('Купить').setColor(afford ? '#ffffff' : '#b0b0b0');
                row.lockText.setText('');
                this.placeIcon(row.priceIcon, tier.iconKey, row.priceCX, row.priceCY, 16);
                row.priceIcon.setVisible(true);
                row.priceText.setVisible(true);
                // Цена: сколько будет потрачено; при частичной покупке — количество
                const priceStr = r.n > 0
                    ? (r.n < amount ? `${fmt(r.total)} x${r.n}` : fmt(r.total))
                    : fmt(getUpgradeCost(def.id));
                row.priceText.setText(priceStr).setColor('#ffd75e');
            }
        }
        this.maxScroll = Math.max(0, y - VIEWPORT.h + ROW_GAP);
        this.scrollPos = Phaser.Math.Clamp(this.scrollPos, 0, this.maxScroll);
        this.updateScroll();

        // Модалка настроек (если открыта)
        if (this.modal.visible) {
            this.modalStats.setText([
                `Уровень шахты: ${gameState.tier + 1} (${tier.name})`,
                `Звёзды: ${gameState.stars} — множитель x${getPrestigeMult().toFixed(1)}`,
                `Кликов: ${fmt(gameState.clicks)}`,
                `Всего добыто: ${fmt(gameState.lifetimeMined)}`,
                `Фоновая добыча: ${Math.round(getOfflineRate() * 100)}% / ${getOfflineCapSeconds() / 3600} ч`
            ].join('\n'));

            const gain = getStarsGain();
            if (canPrestige()) {
                this.prestigeInfo.setText(`За текущий забег: +${gain} ★ (постоянно +${gain * 10}% к доходу)\nСброс: руда, уровень шахты и улучшения обнулятся.`);
                this.prestigeBtn.setTexture(this.prestigeArmed ? 'buy_button_normal' : 'buy_button_normal');
                this.prestigeText.setColor('#ffffff');
            } else {
                const have = gameState.tierEarned[DIAMOND_INDEX];
                this.prestigeInfo.setText(`Для rebirth нужно добыть ${fmt(PRESTIGE_REQUIREMENT)} алмазов за забег.\nУ вас: ${fmt(have)} (${Math.floor(have / PRESTIGE_REQUIREMENT * 100)}%).`);
                this.prestigeBtn.setTexture('buy_button_disabled_gray');
                this.prestigeText.setColor('#b0b0b0');
            }
        }
    }

    update() {
        this.refreshUi();
    }
}
