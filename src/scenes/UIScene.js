import Phaser from 'phaser';
import {
    gameState, TIERS, UPGRADES, getUpgradeDef, getUpgradeLevel, getUpgradeCost,
    isMaxed, isUpgradeAvailable, canBuy, buyUpgrade, buyBulk, getAffordableBulk, getBulkCost,
    isUpgradeVisible,
    getClickDamage, getOrePerSecond, getSynergyGain, getCritChance,
    getOfflineRate, getOfflineCapSeconds, OFFLINE_CAP_HOURS,
    canUnlockTier, getNextTier, unlockTier, getNextUnlockPrice,
    canPrestige, getStarsGain, doPrestige, PRESTIGE_REQUIREMENT, getPrestigeMult, DIAMOND_INDEX,
    resetGame, saveGame, fmt, fmtDuration,
    DAILY_REWARDS
} from '../state.js';
import { computeLayout } from '../layout.js';
import { playSfx } from '../sfx.js';
import manifest from '../../spritecook-assets.json';

const FONT = '"Monocraft", "Inter", "Consolas", monospace';

// Размеры исходников 9-slice текстур (в манифесте их нет — держим рядом;
// при регенерации ассета с новым размером обновить эту таблицу).
const NS_SOURCE_SIZE = {
    hud_bar_background: { w: 1892, h: 225 },
    upgrades_panel_wood: { w: 1029, h: 1119 },
    modal_panel_metal: { w: 849, h: 656 },
    upgrade_row_card_1: { w: 835, h: 218 },
    icon_slot_frame: { w: 229, h: 236 },
    buy_button_normal: { w: 267, h: 133 },
    buy_button_hover: { w: 261, h: 133 },
    buy_button_pressed: { w: 262, h: 133 },
    buy_button_disabled_gray: { w: 260, h: 133 },
    settings_button_wide: { w: 410, h: 161 },
    close_button_square: { w: 196, h: 191 }
};

// Фолбэк-борды на случай отсутствия ассета в манифесте (значения не должны
// расходиться с spritecook-assets.json).
const NS_FALLBACK = {
    hud_bar_background: { l: 55, t: 55, r: 55, b: 55 },
    upgrades_panel_wood: { l: 65, t: 65, r: 65, b: 65 },
    modal_panel_metal: { l: 60, t: 60, r: 60, b: 60 },
    upgrade_row_card_1: { l: 30, t: 30, r: 30, b: 30 },
    icon_slot_frame: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_normal: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_hover: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_pressed: { l: 40, t: 40, r: 40, b: 40 },
    buy_button_disabled_gray: { l: 40, t: 40, r: 40, b: 40 },
    settings_button_wide: { l: 45, t: 50, r: 45, b: 50 },
    close_button_square: { l: 45, t: 45, r: 45, b: 45 }
};

// 9-slice: борды — ЕДИНСТВЕННЫЙ источник = манифест spritecook-assets.json
// (ключ текстуры = имя файла без .png). Регенерация ассета с другими фасками
// подхватывается без правки кода.
const NS_SRC = { ...NS_FALLBACK };
for (const entry of manifest.assets || []) {
    if (!entry.nine_slice || !entry.file) continue;
    const key = entry.file.split('/').pop().replace(/\.png$/, '');
    const size = NS_SOURCE_SIZE[key];
    if (size) {
        NS_SRC[key] = {
            l: entry.nine_slice.left, t: entry.nine_slice.top,
            r: entry.nine_slice.right, b: entry.nine_slice.bottom,
            w: size.w, h: size.h
        };
    }
}

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
// Заголовок на планке (143..200), вкладки и строка тира в одной ширине со списком
// (934..1230), вертикаль: вкладки 192..224 -> тир 237..261 -> список 270..662.
// Значения — ландшафтные из computeLayout(); applyLayout перезаписывает объект
// при смене ориентации (ряды строятся шириной с вьюпорт — она одинакова в обеих сетках).
const VIEWPORT = { x: 934, y: 270, w: 296, h: 392 };
const ROW_H = 96;
const ROW_GAP = 6;

const TABS = [
    { id: 'equipment', label: 'Оборудование' },
    { id: 'enhance',   label: 'Усиления' }
];
const BUY_AMOUNTS = [1, 10, 100, 'max'];

// Отступы ряда (карточка 296x96: face source x44..817, y16..202 -> drawn x16..290, y7..89)
const ROW = {
    iconY: 50,          // центр встроенной ниши карточки по Y (source y44..181 -> drawn 19.4..79.7)
    descSize: 11,       // 11px: вместимость ~12+ символов на строку при вариативности метрик шрифта
    btnW: 84,
    btnH: 40,
    // Вертикальный стек ряда (y от верха карточки, зазоры заданы явно):
    // имя 8..25 (ужимается 15->10px под ширину) -> описание 30..58 ->
    // цена 68..84 (слева) + «ур. N» 68..84 (справа, под кнопкой). Кнопка 28..68.
    // face карточки 7..89: всё содержимое внутри с запасом >= 4px.
    nameY: 8,
    descY: 30,
    priceY: 76,
    btnY: 28
};

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this.scrollPos = 0;
        this.maxScroll = 0;
        this.activeTab = 'equipment'; // вкладка панели улучшений
        this.buyAmount = 1;           // мультипокупка: 1 / 10 / 100 / 'max'
        // Владельцы blockLocked: настройки, офлайн-окно и окно дневной награды
        // могут быть открыты одновременно — блокировку снимает только закрытие
        // ПОСЛЕДНЕЙ модалки
        this._settingsOpen = false;
        this._offlineOpen = false;
        this._dailyOpen = false;
        this._pendingDaily = null; // награда ждёт, пока не закроются другие модалки
        this._tutorialPending = false; // обучение ждёт закрытия окна дневной награды
    }

    create() {
        if (import.meta.env.DEV) {
            window.__fmt = fmt; // хук для автопроверок
            window.__ec = { getUpgradeCost, getBulkCost, getAffordableBulk }; // хук для verify-rebalance
        }
        this.L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        this.buildHud();
        this.buildPanel();
        this.buildUnlockButton();
        this.buildModal();
        this.buildOfflineModal();
        this.buildDailyModal();
        this.setupListCamera();
        this.setupListDrag();
        this.applyLayout();

        // Смена ориентации/размера окна (main.js) — переставляем весь UI
        this.game.events.on('layout-changed', () => this.applyLayout());

        this.input.on('wheel', (pointer, over, dx, dy) => {
            if (pointer.x >= VIEWPORT.x - 10 && pointer.x <= VIEWPORT.x + VIEWPORT.w + 10
                && pointer.y >= VIEWPORT.y - 10 && pointer.y <= VIEWPORT.y + VIEWPORT.h + 10) {
                this.scrollPos = Phaser.Math.Clamp(this.scrollPos + dy * 0.5, 0, this.maxScroll);
                this.updateScroll();
            }
        });

        // Драг списка — setupListDrag (scene-level, работает по всей площади вьюпорта,
        // включая карточки: покупка на кнопках висит на pointerup с гасителем драга)

        this.game.events.on('ui-refresh', () => this.refreshUi());

        // Офлайн-модалка по событию: симуляция из DevPanel и реальный возврат
        // во вкладку идут по одному пути (registry.offlineInfo + offline-applied)
        this.game.events.on('offline-applied', (info) => {
            if (this.offlineModal.visible) return;
            this.showOfflineModal(info);
        });

        // Ежедневная награда: и путь загрузки (registry 'dailyInfo'), и DevPanel
        // («след. день» / «сброс серии») идут в одну очередь через 'daily-claimed'
        this.game.events.on('daily-claimed', (info) => {
            this._pendingDaily = info;
            this.tryShowDailyModal();
        });
        if (this.registry.get('dailyInfo')) {
            // после офлайн-модалки, если та тоже пришла при загрузке (delayedCall офлайна 400)
            this.time.delayedCall(900, () => {
                if (!this.registry.get('dailyInfo')) return;
                this._pendingDaily = this.registry.get('dailyInfo');
                this.registry.set('dailyInfo', null);
                this.tryShowDailyModal();
            });
        }
        // Порядок первого запуска: окно дневной награды показывается ПЕРЕД
        // обучением — иначе учебные подсказки стартовали сразу, а награда
        // вылезала поверх и перекрывала всю игру (скриншот игрока). Если награда
        // придёт — обучение откладывается до её закрытия.
        if (this.registry.get('dailyInfo') || this._pendingDaily) {
            this._tutorialPending = true;
        } else {
            this.buildTutorial();
        }

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
        // Позиции — ландшафтные; applyLayout переставляет под ориентацию.
        this.hudBar = addImg(this, 16, 10, 'hud_bar_background', 1250, 112, 10);

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
        this.settingsGear = this.add.image(btnX + 34, 62, 'gear_icon').setScale(0.22).setDepth(12);
        this.settingsLbl = makeLabel(this, btnX + 98, 62, 'Настройки', 16, '#ffffff').setOrigin(0.5).setDepth(12);
        this.settingsBtn.on('pointerdown', () => this.openModal());
        this.settingsBtn.on('pointerover', () => this.settingsBtn.setAlpha(0.9));
        this.settingsBtn.on('pointerout', () => this.settingsBtn.setAlpha(1));

        // Активные дневные бафы с обратным отсчётом (под HUD-баром): «x2 9:59 · жила 1:59».
        // Пустая строка, когда бафов нет; setText только при смене строки.
        this.buffLine = makeLabel(this, 16, 128, '', 13, '#ffd75e');
        this.buffLine.setOrigin(0, 0).setDepth(11);
        this._buffLineText = '';
    }

    // ---------- Панель улучшений ----------

    buildPanel() {
        const px = 900;
        const py = 124;
        const pw = 364;
        const ph = 582;

        this.panelImg = addImg(this, px, py, 'upgrades_panel_wood', pw, ph, 10);
        // Планка с заклёпками (143..200): заголовок по её центру
        this.panelTitle = makeLabel(this, px + pw / 2, 171, 'Улучшения', 24, '#ffe9b0').setOrigin(0.5).setDepth(11);

        // Вкладки: одна ширина со списком (934..1230), две по 145 + зазор 6
        this.tabBtns = TABS.map((tab, i) => this.buildTabButton(VIEWPORT.x + i * 151, 192, tab));

        // Строка тира + переключатель мультипокупки (в границах списка)
        this.tierLabel = makeLabel(this, VIEWPORT.x + 2, 249, '', 13, '#c8b78e');
        this.tierLabel.setOrigin(0, 0.5).setDepth(11);
        const amount = this.buildAmountButton(VIEWPORT.x + VIEWPORT.w - 38, 249);
        this.amountC = amount.c;
        this.amountBg = amount.bg;

        // Фон вьюпорта (для драга). Клиппинг списка — через отдельную камеру с viewport
        // (GeometryMask в Phaser 4 работает только в Canvas; в WebGL игнорируется).
        this.viewportBg = this.add.rectangle(VIEWPORT.x + VIEWPORT.w / 2, VIEWPORT.y + VIEWPORT.h / 2, VIEWPORT.w, VIEWPORT.h, 0x000000, 0.001).setDepth(11);

        // Контейнер в мировых координатах (0,0): ряды локальны относительно вьюпорта,
        // а экранный сдвиг делает сама камера (viewport + scroll), см. setupListCamera
        this.listContent = this.add.container(0, 0).setDepth(12);

        // Ряды всех улучшений строятся один раз; видимость и позиции
        // пересчитываются каждый кадр в refreshUi (фильтр вкладки + «доступные + 1»)
        this.rows = UPGRADES.map((def) => this.buildRow(def));
        this._rowsBuiltW = VIEWPORT.w;
    }

    buildTabButton(x, y, tab) {
        const w = 145;
        const h = 32;
        const c = this.add.container(x + w / 2, y + h / 2).setDepth(11);
        const bg = addImgC(this, 0, 0, 'buy_button_disabled_gray', w, h);
        const lbl = makeLabel(this, 0, 0, tab.label, 14, '#b0b0b0').setOrigin(0.5);
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
            this.amountLbl.setText(this.buyAmount === 'max' ? 'МАКС' : 'x' + this.buyAmount);
            this.refreshUi();
        });
        return { c, bg };
    }

    // ---------- Адаптивная раскладка (см. src/layout.js) ----------

    applyLayout() {
        const L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        this.L = L;
        Object.assign(VIEWPORT, L.viewport);
        const tierIcon = TIERS[gameState.tier].iconKey;

        // HUD: бар на всю ширину сетки (в ландшафте — прежние 1250px по центру)
        const h = L.hud;
        this.hudBar.setPosition(h.barX + h.barW / 2, h.barY + h.barH / 2);
        this.hudBar.setDisplaySize(h.barW, h.barH);
        // Строка бафов — сразу под нижней кромкой HUD-бара
        this.buffLine.setPosition(h.barX + 10, h.barY + h.barH + 6);
        this.placeIcon(this.oreIcon, tierIcon, h.iconX, h.centerY, 48);
        this.coalText.setPosition(h.counterX, h.counterY);
        this.oreName.setPosition(h.counterX, h.counterY);
        // Доход (строка 1) и клик/крит (строка 2) — в ландшафте в одну строку
        this.placeIcon(this.gpsIcon, tierIcon, h.gpsIconX, h.gpsIconY, 26);
        this.gpsText.setPosition(h.gpsTextX, h.gpsTextY);
        this.gpsText.setFontSize(h.gpsSize);
        this.statsLine.setPosition(h.statsXBase, h.statsY);
        this.statsLine.setVisible(h.statsVisible);
        this.statsLine.setFontSize(h.statsSize);
        const btnX = h.btnX;
        this.settingsBtn.setPosition(btnX + h.btnW / 2, h.centerY);
        this.settingsGear.setPosition(btnX + h.gearDx, h.centerY);
        this.settingsLbl.setPosition(btnX + h.labelDx, h.centerY);

        // Панель улучшений + шапка (вкладки/тир/мультипокупка)
        const p = L.panel;
        this.panelImg.setPosition(p.px + p.pw / 2, p.py + p.ph / 2);
        this.panelImg.setDisplaySize(p.pw, p.ph);
        this.panelTitle.setPosition(p.px + p.pw / 2, p.py + p.titleDy);
        this.panelTitle.setFontSize(p.titleSize);
        // В портрете звёзды живут на планке заголовка панели (HUD плотный);
        // в ландшафте — в HUD перед кнопкой «Настройки»
        if (L.portrait) this.starsText.setPosition(p.px + p.pw - 24, p.py + p.titleDy);
        else this.starsText.setPosition(h.starsRight, h.starsY);
        // Вкладки: в ландшафте две по 145 (одна ширина со списком); в портрете
        // растягиваются на весь вьюпорт, иначе сбиваются влево у широкого листа
        const tabGap = 8;
        const tabW = L.portrait ? Math.floor((L.viewport.w - tabGap) / 2) : 145;
        const tabCY = p.py + p.tabsCY;
        this.tabBtns.forEach((t, i) => {
            t.c.setPosition(L.viewport.x + tabW / 2 + i * (tabW + tabGap), tabCY);
            t.bg.setDisplaySize(tabW, p.tabH);
            t.lbl.setFontSize(p.tabLabelSize);
            // Хит-зона должна следовать за визуальным размером вкладки
            t.c.setInteractive(new Phaser.Geom.Rectangle(-tabW / 2, -p.tabH / 2, tabW, p.tabH), Phaser.Geom.Rectangle.Contains);
        });
        this.tierLabel.setPosition(L.viewport.x + 2, p.py + p.tierCY);
        this.tierLabel.setFontSize(p.tierLabelSize);
        this._tierText = null; // кегль ужинается в refreshUi под новую ширину
        this.amountC.setPosition(L.viewport.x + L.viewport.w - p.amountPadRight - p.amountW / 2, p.py + p.tierCY);
        this.amountBg.setDisplaySize(p.amountW, p.amountH);
        this.amountLbl.setFontSize(p.amountSize);
        this.amountC.setInteractive(new Phaser.Geom.Rectangle(-p.amountW / 2, -p.amountH / 2, p.amountW, p.amountH), Phaser.Geom.Rectangle.Contains);
        this.viewportBg.setPosition(L.viewport.x + L.viewport.w / 2, L.viewport.y + L.viewport.h / 2);
        this.viewportBg.setSize(L.viewport.w, L.viewport.h);

        // Список: камера клиппинга следует за вьюпортом; смена ширины — пересборка рядов
        if (this.listCam) this.listCam.setViewport(L.viewport.x, L.viewport.y, L.viewport.w, L.viewport.h);
        if (this.rows && this.rows.length && this._rowsBuiltW !== VIEWPORT.w) {
            this.rebuildRows();
        }
        this._rowsBuiltW = VIEWPORT.w;

        // Кнопка спуска + подсказка
        const u = L.unlock;
        this.unlockBtn.setPosition(u.cx - u.w / 2, u.y);
        this.unlockText.setPosition(u.cx, u.y + u.h / 2);
        this.unlockText.setFontSize(u.textSize);
        this.hint.setPosition(u.cx, u.hintY);
        this.hint.setFontSize(u.hintSize);

        // Модалки: затемнение на всю сетку, панель по центру; текст в портрете
        // крупнее (FIT-даунскейл ~0.52 на телефонах съедает кегль)
        this.modalDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.offlineDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.dailyDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.modal.setPosition(L.modal.cx, L.modal.cy);
        this.offlineModal.setPosition(L.modal.cx, L.modal.cy);
        this.dailyModal.setPosition(L.modal.cx, L.modal.cy);
        if (this.modalStats) {
            if (L.portrait) {
                this.modalStats.setFontSize(17).setY(-196);
                this.prestigeInfo.setFontSize(15);
                this.soundText.setFontSize(16);
                this.musicText.setFontSize(16);
                this.volLabel.setFontSize(15);
                this.volPct.setFontSize(15);
            } else {
                this.modalStats.setFontSize(15).setY(-186);
                this.prestigeInfo.setFontSize(14);
                this.soundText.setFontSize(15);
                this.musicText.setFontSize(15);
                this.volLabel.setFontSize(14);
                this.volPct.setFontSize(14);
            }
        }

        if (this.tutDim) {
            this.tutDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
            this.layoutTutorial();
        }
        if (this.tutorialStep === 3 && this.tutFinal) this.showTutorialFinal();
    }

    // Драг списка пальцем по всей площади вьюпорта (мобилки: wheel недоступен,
    // стрелки не нужны). Покупка ряда висит на pointerup и гасится флагом
    // _listDragging — жест, начатый на кнопке, скроллит, а не покупает.
    setupListDrag() {
        const inViewport = (p) =>
            p.x >= VIEWPORT.x - 6 && p.x <= VIEWPORT.x + VIEWPORT.w + 6 &&
            p.y >= VIEWPORT.y - 6 && p.y <= VIEWPORT.y + VIEWPORT.h + 6;
        this.input.on('pointerdown', (p) => {
            if (this.registry.get('blockLocked') || !inViewport(p)) return;
            this._dragId = p.id;
            this._dragStartY = p.y;
            this._dragStartScroll = this.scrollPos;
            this._listDragging = false;
        });
        this.input.on('pointermove', (p) => {
            if (p.id !== this._dragId || !p.isDown) return;
            const delta = this._dragStartY - p.y;
            if (!this._listDragging && Math.abs(delta) > 6) this._listDragging = true;
            if (this._listDragging) {
                this.scrollPos = Phaser.Math.Clamp(this._dragStartScroll + delta, 0, this.maxScroll);
                this.updateScroll();
            }
        });
        const endDrag = (p) => {
            if (p && p.id !== this._dragId) return;
            this._dragId = null;
            // флаг сбрасываем в следующем кадре: pointerup на кнопке срабатывает
            // раньше scene pointerup — покупка после лёгкого сдвига (<6px) валидна
            this.time.delayedCall(0, () => { this._listDragging = false; });
        };
        this.input.on('pointerup', endDrag);
        this.input.on('pointerupoutside', endDrag);
    }

    // Ряды строятся шириной с вьюпорт; при смене ориентации (296 <-> ~596) — пересборка
    rebuildRows() {
        for (const row of this.rows) row.rc.destroy();
        this.rows = UPGRADES.map((def) => this.buildRow(def));
        this._rowsBuiltW = VIEWPORT.w;
        this.refreshUi();
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

    // Ручная обрезка генеративного мусора по краям текстур. У pickaxe_diamond/
    // pickaxe_iron мусор листа (куски соседних спрайтов, связанные с телом по
    // альфе) СТЁР ИЗ САМИХ PNG 2026-11-13 (art-src/*_before_edgefix.png — бэкапы),
    // тримы больше не нужны — записей нет. Механизм остаётся для будущих текстур.
    ICON_TRIMS = {
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

    // Геометрия ряда по ориентации: в портрете карточки шире (624) — кегли и
    // кнопка крупнее (FIT-даунскейл ~0.52 на телефонах), ряд выше под 2 строки.
    // Ландшафтные значения = исторические константы ROW (296x96) 1:1.
    rowGeom() {
        if (this.L.portrait) {
            return {
                h: 108, iconCY: 56, iconSize: 48,
                nameY: 10, nameSizes: [18, 17, 16, 15, 14, 13],
                descY: 34, descSize: 14,
                priceY: 88, priceSize: 15, priceIconSize: 18, levelSize: 14, rightInset: 20,
                btnY: 28, btnW: 104, btnH: 44, btnSize: 15, lockSize: 13
            };
        }
        return {
            h: ROW_H, iconCY: ROW.iconY, iconSize: 40,
            nameY: ROW.nameY, nameSizes: [15, 14, 13, 12, 11, 10],
            descY: ROW.descY, descSize: ROW.descSize,
            priceY: ROW.priceY, priceSize: 13, priceIconSize: 16, levelSize: 12, rightInset: 12,
            btnY: ROW.btnY, btnW: ROW.btnW, btnH: ROW.btnH, btnSize: 14, lockSize: 11
        };
    }

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
        const nameMaxW = w - textX - 14;
        // Кнопка у правого края; описание ограничено зоной кнопки и не пересекает её.
        const btnW = g.btnW;
        const btnH = g.btnH;
        const btnX = w - g.rightInset - btnW;
        const descWrap = btnX - textX - 4;

        // Контейнер ряда: позиция по Y пересчитывается в refreshUi (фильтр вкладки
        // и «доступные + 1 следующее» скрывают/сдвигают ряды динамически)
        const rc = this.add.container(0, 0);
        this.listContent.add(rc);

        const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, h, 11);
        // Слот уже ВСТРОЕН в текстуру карточки (тёмная ниша слева) — отдельная рамка
        // не нужна: раньше она дублировала нишу и давала «сдвиг»/двойную рамку слева.
        const iconKey = def.id === 'pickaxe' ? 'pickaxe_wooden' : (def.icon || 'gear_icon');
        const iconCY = g.iconCY;
        const icon = this.add.image(0, 0, iconKey).setDepth(13);
        this.placeIcon(icon, iconKey, iconCX, iconCY, g.iconSize);
        const iconScale = this.iconMetrics(iconKey).scale;

        const nameText = makeLabel(this, textX, g.nameY, def.name, g.nameSizes[0], '#ffffff');
        nameText.setOrigin(0, 0);
        // Длинные имена («Квантовая лаборатория», «Гравитационный резак») ужимаются
        // кеглем под всю ширину карточки — раньше они наезжали на «ур. N» и край.
        for (const size of g.nameSizes) {
            nameText.setFontSize(size);
            if (nameText.width <= nameMaxW) break;
        }
        const descText = makeLabel(this, textX, g.descY, def.effect, g.descSize, '#cfcfcf', { wordWrap: { width: descWrap } });
        descText.setOrigin(0, 0);
        const priceIcon = this.add.image(0, 0, 'coal_nugget');
        this.placeIcon(priceIcon, 'coal_nugget', textX + 6, g.priceY, g.priceIconSize);
        const priceCX = textX + 6;
        const priceCY = g.priceY;
        const priceText = makeLabel(this, textX + 16, g.priceY, '', g.priceSize, '#ffd75e');
        priceText.setOrigin(0, 0.5);
        // «ур. N» — нижняя правая полоса ряда (под кнопкой): название занимает всю ширину
        const levelText = makeLabel(this, w - g.rightInset, g.priceY, 'ур. 0', g.levelSize, '#e8e8e8');
        levelText.setOrigin(1, 0.5);

        const btn = this.add.image(btnX + btnW / 2, g.btnY + btnH / 2, 'buy_button_normal').setDisplaySize(btnW, btnH).setDepth(11);
        btn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
        const btnText = makeLabel(this, btnX + btnW / 2, g.btnY + btnH / 2, 'Купить', g.btnSize, '#ffffff');
        btnText.setOrigin(0.5);

        const lockText = makeLabel(this, textX, g.priceY, '', g.lockSize, '#e09090');
        lockText.setOrigin(0, 0.5);

        rc.add([card, icon, nameText, descText, priceIcon, priceText, levelText, btn, btnText, lockText]);

        const row = { def, rc, icon, iconScale, iconCX, iconCY, nameText, descText, priceText, priceIcon, priceCX, priceCY, levelText, btn, btnText, lockText, nameMaxW, textX };

        // Покупка на pointerup (а не pointerdown): драг списка, начатый на кнопке,
        // не должен покупать; тап = down+up на кнопке.
        btn.on('pointerup', () => {
            if (this._listDragging) return;
            if (buyBulk(def.id, this.buyAmount)) {
                playSfx(this, 'purchase');
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
            playSfx(this, 'tier');
            const u = this.L.unlock;
            const float = this.spawnFloat(u.cx, u.y - 44, `Уровень шахты: ${next.name}!`, 28, next.floatColor);
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
        const ph = 600;
        this.modalDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6)
            .setDepth(40).setVisible(false).setInteractive();
        this.modalDim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());

        this.modal = this.add.container(640, 360).setDepth(41).setVisible(false);

        const panel = addImgC(this, 0, 0, 'modal_panel_metal', pw, ph);
        // Врезка панели (image): content y -261..249, x -216..216 (контейнерные координаты)
        const title = makeLabel(this, 0, -232, 'Настройки', 30, '#ffe9b0').setOrigin(0.5);

        const cbW = 44;
        // Крестик в правом верхнем углу: заходит за врезку в зону рамки, не задевая заклёпку
        const closeBtn = addImgC(this, pw / 2 - 60, -228, 'close_button_square', cbW, cbW);
        // Hit-area в координатах кадра текстуры (196x191)
        closeBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 196, 191), Phaser.Geom.Rectangle.Contains);
        closeBtn.on('pointerdown', () => this.closeModal());

        this.modalStats = makeLabel(this, -pw / 2 + 56, -186, '', 15, '#d8d8d8', { lineSpacing: 5 });
        this.modalStats.setOrigin(0, 0);

        // Звук (эффекты) и Музыка (фон): два тумблера в ряд
        const tbW = 200;
        const tbH = 44;
        this.soundBtn = addNineC(this, -105, -34, 'buy_button_normal', tbW, tbH);
        this.soundBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, tbW, tbH), Phaser.Geom.Rectangle.Contains);
        this.soundText = makeLabel(this, -105, -34, 'Звук: вкл', 15, '#ffffff').setOrigin(0.5);
        this.soundBtn.on('pointerdown', () => {
            gameState.soundOn = !gameState.soundOn;
            this.refreshSoundToggle();
            if (gameState.soundOn) playSfx(this, 'purchase'); // подтверждение включения
            saveGame();
            this.refreshUi();
        });

        this.musicBtn = addNineC(this, 105, -34, 'buy_button_normal', tbW, tbH);
        this.musicBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, tbW, tbH), Phaser.Geom.Rectangle.Contains);
        this.musicText = makeLabel(this, 105, -34, 'Музыка: вкл', 15, '#ffffff').setOrigin(0.5);
        this.musicBtn.on('pointerdown', () => {
            gameState.musicOn = !gameState.musicOn;
            this.refreshMusicControls();
            this.game.events.emit('music-changed');
            saveGame();
            this.refreshUi();
        });

        // Громкость музыки: слайдер (musicVolume 0..1, применяется на каждый сдвиг)
        this.volLabel = makeLabel(this, -150, 14, 'Громкость:', 14, '#c8c8c8').setOrigin(0.5);
        this.volG = this.add.graphics(); // трек -60..120 (180), заливка и ручка перерисовываются
        this.volPct = makeLabel(this, 170, 14, '50%', 14, '#e8e8e8').setOrigin(0.5);
        const volZone = this.add.zone(-66, -8, 192, 44).setOrigin(0, 0).setInteractive();
        const seekVolume = (gameX) => {
            // Контейнер модалки ставит applyLayout: левый край трека = modal.x - 60
            gameState.musicVolume = Phaser.Math.Clamp((gameX - (this.modal.x - 60)) / 180, 0, 1);
            this.refreshMusicControls();
            this.game.events.emit('music-changed');
        };
        volZone.on('pointerdown', (p) => {
            this.volDragging = true;
            seekVolume(p.x);
        });
        this.input.on('pointermove', (p) => {
            if (this.volDragging) seekVolume(p.x); // драг продолжается за пределами трека
        });
        this.input.on('pointerup', () => {
            if (this.volDragging) {
                this.volDragging = false;
                saveGame();
            }
        });

        // Престиж
        const presTitle = makeLabel(this, 0, 48, 'Сброс шахты (Rebirth)', 20, '#ffe9b0').setOrigin(0.5, 0);
        this.prestigeInfo = makeLabel(this, 0, 82, '', 14, '#d8d8d8', { align: 'center', wordWrap: { width: pw - 120 }, lineSpacing: 6 });
        this.prestigeInfo.setOrigin(0.5, 0);

        const pbW = 300;
        const pbH = 50;
        this.prestigeBtn = addNineC(this, 0, 158, 'buy_button_disabled_gray', pbW, pbH);
        this.prestigeBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, pbW, pbH), Phaser.Geom.Rectangle.Contains);
        // addNineC ставит origin (0.5): координата кнопки = её центр, подпись — в тот же центр
        this.prestigeText = makeLabel(this, 0, 158, 'Сбросить шахту', 17, '#ffffff').setOrigin(0.5);
        this.prestigeBtn.on('pointerdown', () => this.tryPrestige());

        const rbW = 300;
        const rbH = 46;
        this.resetBtn = addNineC(this, 0, 216, 'buy_button_disabled_gray', rbW, rbH);
        this.resetBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, rbW, rbH), Phaser.Geom.Rectangle.Contains);
        this.resetText = makeLabel(this, 0, 216, 'Сбросить весь прогресс', 15, '#ffffff').setOrigin(0.5);
        this.resetBtn.on('pointerdown', () => this.tryReset());

        this.modal.add([panel, title, closeBtn, this.modalStats, this.soundBtn, this.soundText, this.musicBtn, this.musicText, this.volLabel, this.volG, this.volPct, volZone, presTitle, this.prestigeInfo, this.prestigeBtn, this.prestigeText, this.resetBtn, this.resetText]);
        this.prestigeArmed = false;
        this.resetArmed = false;
    }

    refreshSoundToggle() {
        if (!this.soundBtn) return;
        this.soundBtn.setTexture(gameState.soundOn ? 'buy_button_normal' : 'buy_button_disabled_gray');
        this.soundText.setText(gameState.soundOn ? 'Звук: вкл' : 'Звук: выкл');
        this.soundText.setColor(gameState.soundOn ? '#ffffff' : '#b0b0b0');
    }

    refreshMusicControls() {
        if (!this.musicBtn) return;
        this.musicBtn.setTexture(gameState.musicOn ? 'buy_button_normal' : 'buy_button_disabled_gray');
        this.musicText.setText(gameState.musicOn ? 'Музыка: вкл' : 'Музыка: выкл');
        this.musicText.setColor(gameState.musicOn ? '#ffffff' : '#b0b0b0');
        const v = gameState.musicVolume;
        const g = this.volG;
        g.clear();
        // Трек: тёмная канавка + золотая заливка, ручка — светлая с тёмной обводкой (центр y=14)
        g.fillStyle(0x1a1c1f, 1);
        g.fillRect(-60, 9, 180, 10);
        g.fillStyle(0xffd75e, 1);
        g.fillRect(-60, 9, Math.max(4, Math.round(180 * v)), 10);
        const kx = -60 + Math.round(180 * v);
        g.fillStyle(0xe8e8e8, 1);
        g.fillRect(kx - 6, 4, 12, 20);
        g.lineStyle(2, 0x0e1012, 1);
        g.strokeRect(kx - 6, 4, 12, 20);
        this.volPct.setText(`${Math.round(v * 100)}%`);
    }

    openModal() {
        this.prestigeArmed = false;
        this.resetArmed = false;
        this.prestigeText.setText('Сбросить шахту');
        this.resetText.setText('Сбросить весь прогресс');
        this.refreshSoundToggle();
        this.refreshMusicControls();
        this.modalDim.setVisible(true);
        this.modal.setVisible(true);
        this._settingsOpen = true;
        // Ряды рендерит listCam ПОВЕРХ всего, что рисует главная камера, —
        // иначе они пробивают затемнение модалки (в портрете модалка над списком)
        this.listContent.setVisible(false);
        this.registry.set('blockLocked', true);
        this.refreshUi();
    }

    closeModal() {
        this.modalDim.setVisible(false);
        this.modal.setVisible(false);
        this._settingsOpen = false;
        // Офлайн-модалка и окно дневной награды могут быть открыты поверх —
        // их закрытие снимает блокировку
        if (!this._offlineOpen && !this._dailyOpen) {
            this.listContent.setVisible(true);
            this.registry.set('blockLocked', false);
        }
        this.tryShowDailyModal(); // награда могла ждать очереди под настройками
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
        playSfx(this, 'prestige');
        this.prestigeArmed = false;
        saveGame();
        this.closeModal();
        this.game.events.emit('tier-changed');
        const float = this.spawnFloat(this.L.modal.cx, this.L.modal.cy - 60, `+${gain} ★ Множитель: x${getPrestigeMult().toFixed(1)}`, 26, '#ffd75e');
        float.setOrigin(0.5).setDepth(45);
        this.tweens.add({ targets: float, y: float.y - 60, alpha: 0, duration: 1600, onComplete: () => float.destroy() });
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
        this.maybeRebuildTutorial();
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
            `лимит склада: ${OFFLINE_CAP_HOURS[Math.min(getUpgradeLevel('warehouse'), OFFLINE_CAP_HOURS.length - 1)]} ч · учтено ${fmtDuration(info.counted)}`
        ].join('\n');
        this.offlineBody.setText(text);
        this.offlineDim.setVisible(true);
        this.offlineModal.setVisible(true);
        this._offlineOpen = true;
        // Ряды рендерит listCam поверх главной камеры — прячем под затемнение
        this.listContent.setVisible(false);
        this.registry.set('blockLocked', true);
        this.registry.set('offlineInfo', null);
    }

    hideOfflineModal() {
        this.offlineDim.setVisible(false);
        this.offlineModal.setVisible(false);
        this._offlineOpen = false;
        // Настройки и окно дневной награды могут быть открыты — их закрытие
        // снимает блокировку
        if (!this._settingsOpen && !this._dailyOpen) {
            this.listContent.setVisible(true);
            this.registry.set('blockLocked', false);
        }
        this.tryShowDailyModal(); // награда могла ждать очереди под офлайн-окном
    }

    // ---------- Ежедневная награда (Этап 6) ----------

    buildDailyModal() {
        const pw = 520;
        const ph = 420;
        this.dailyDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.65)
            .setDepth(50).setVisible(false).setInteractive();
        this.dailyDim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());

        this.dailyModal = this.add.container(640, 360).setDepth(51).setVisible(false);
        const panel = addImgC(this, 0, 0, 'modal_panel_metal', pw, ph);
        // Врезка контента: y -180..180 (контейнерные)
        const title = makeLabel(this, 0, -170, 'Ежедневная награда', 26, '#ffe9b0').setOrigin(0.5);
        this.dailyStreakText = makeLabel(this, 0, -132, '', 15, '#c8c8c8').setOrigin(0.5);
        this.dailyIcon = this.add.image(0, -78, 'pickaxe_iron');
        this.dailyName = makeLabel(this, 0, -18, '', 21, '#ffd75e').setOrigin(0.5);
        // Верхний якорь (0.5, 0): конкретика дня добавляет 3-ю строку — текст
        // растёт ВНИЗ и не наезжает на название (перекрытие «Накопителя» поймано
        // скриншотом игрока)
        this.dailyDesc = makeLabel(this, 0, 12, '', 15, '#d8d8d8', { align: 'center', lineSpacing: 8 }).setOrigin(0.5, 0);
        // Серия: 7 слотов цикла, текущий день подсвечен. Иконки нормируем
        // placeIcon'ом — текстуры ассетов разного разрешения (30..256px)
        this.dailySlots = [];
        for (let i = 0; i < 7; i++) {
            const x = -114 + i * 38;
            const slot = this.add.image(x, 82, 'icon_slot_frame').setDisplaySize(34, 34);
            const ic = this.add.image(x, 82, DAILY_REWARDS[i].icon);
            this.placeIcon(ic, DAILY_REWARDS[i].icon, x, 82, 22);
            this.dailySlots.push({ slot, ic });
        }
        const okBtn = addNineC(this, 0, 152, 'buy_button_normal', 190, 46);
        okBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 190, 46), Phaser.Geom.Rectangle.Contains);
        const okText = makeLabel(this, 0, 152, 'Отлично!', 17, '#ffffff').setOrigin(0.5);
        okBtn.on('pointerdown', () => this.hideDailyModal());

        this.dailyModal.add([panel, title, this.dailyStreakText, this.dailyIcon, this.dailyName, this.dailyDesc, okBtn, okText, ...this.dailySlots.map((s) => s.slot), ...this.dailySlots.map((s) => s.ic)]);
    }

    // Награда не показывается поверх других модалок — очередь до их закрытия
    tryShowDailyModal() {
        if (!this._pendingDaily) return;
        if (this.offlineModal.visible || this.modal.visible || this.dailyModal.visible) return;
        const info = this._pendingDaily;
        this._pendingDaily = null;
        const idx = (info.streak - 1) % DAILY_REWARDS.length;
        const reward = DAILY_REWARDS[idx];
        this.dailyStreakText.setText(`Серия: ${info.streak} ${info.streak === 1 ? 'день' : info.streak < 5 ? 'дня' : 'дней'}`);
        this.dailyIcon.setTexture(reward.icon);
        this.placeIcon(this.dailyIcon, reward.icon, 0, -78, 64);
        let desc = reward.desc;
        // конкретика дня: сколько руды дал «Накопитель» / какое улучшение выбралось
        if (info.extra && typeof info.extra === 'number') desc += `\n+${fmt(info.extra)} руды`;
        else if (info.extra && info.extra.name) desc += `\nулучшение: ${info.extra.name}`;
        this.dailyName.setText(reward.name);
        this.dailyDesc.setText(desc);
        for (let i = 0; i < this.dailySlots.length; i++) {
            const s = this.dailySlots[i];
            const active = i === idx;
            s.ic.setTint(active ? 0xffffff : 0x606060);
            s.slot.setTint(active ? 0xffffff : 0x909090);
        }
        this.dailyDim.setVisible(true);
        this.dailyModal.setVisible(true);
        this._dailyOpen = true;
        // Ряды рендерит listCam поверх главной камеры — прячем под затемнение
        this.listContent.setVisible(false);
        this.registry.set('blockLocked', true);
    }

    hideDailyModal() {
        this.dailyDim.setVisible(false);
        this.dailyModal.setVisible(false);
        this._dailyOpen = false;
        // Другие модалки могут быть открыты — их закрытие снимает блокировку
        if (!this._settingsOpen && !this._offlineOpen) {
            this.listContent.setVisible(true);
            this.registry.set('blockLocked', false);
        }
        // Обучение, отложенное ради окна награды, стартует после его закрытия
        if (this._tutorialPending && !gameState.tutorialDone) {
            this._tutorialPending = false;
            this.buildTutorial();
        }
    }

    // Активные дневные бафы: строка под HUD-баром «x2 9:59 · жила 1:59 · крит 4:31».
    // setText только при смене строки (каждый кадр иначе перерисовывал бы канвас-текст).
    updateBuffLine() {
        const parts = [];
        const left = (until) => {
            const sec = Math.max(0, Math.ceil((until - Date.now()) / 1000));
            return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        };
        if (Date.now() < gameState.dailyBuffUntil) parts.push(`x${gameState.dailyBuffMult} ${left(gameState.dailyBuffUntil)}`);
        if (Date.now() < gameState.dailyVeinUntil) parts.push(`жила ${left(gameState.dailyVeinUntil)}`);
        if (Date.now() < gameState.dailyCritUntil) parts.push(`крит ${left(gameState.dailyCritUntil)}`);
        const text = parts.join(' · ');
        if (text !== this._buffLineText) {
            this._buffLineText = text;
            this.buffLine.setText(text);
        }
    }

    // ---------- Обновление UI (дифф-опрос каждый кадр) ----------

    refreshUi() {
        const tier = TIERS[gameState.tier];
        const h = this.L.hud;

        this.coalText.setText(fmt(gameState.ore));
        if (this.oreIcon.texture.key !== tier.iconKey) this.placeIcon(this.oreIcon, tier.iconKey, h.iconX, h.centerY, 48);
        this.oreName.setText(tier.name.toLowerCase());
        this.oreName.x = h.counterX + this.coalText.width + 10;
        // GPS-иконка следует за именем руды (в портрете HUD плотнее — минимум из L)
        const gx = Math.max(h.gpsIconX, this.oreName.x + this.oreName.width + 14);
        if (this.gpsIcon.texture.key !== tier.iconKey) this.placeIcon(this.gpsIcon, tier.iconKey, gx, h.centerY, 26);
        else this.gpsIcon.x = gx;
        // Ставка = фактическая фоновая добыча: пассив с множителем заряженной мутации (registry.passiveMult).
        const rate = fmt(getOrePerSecond() * (this.registry.get('passiveMult') || 1));
        this.gpsText.setText(`+${rate} руды/сек`);
        this.gpsText.x = gx + 20;
        // «клик» = фактическая добыча обычного клика: базовый урон + синергия
        // (% от пассива) — совпадает с всплывающими цифрами без крита/жилы.
        this.statsLine.setText(`клик: ${fmt(getClickDamage() + getSynergyGain())} · крит: ${Math.round(getCritChance() * 100)}%`);
        // Ландшафт: в одну строку за ставкой; портрет: второй строкой под ставкой
        this.statsLine.x = this.L.portrait ? this.gpsText.x : this.gpsText.x + this.gpsText.width + 26;
        this.updateBuffLine();
        this.starsText.setText(gameState.stars > 0 ? `★ ${gameState.stars} (x${getPrestigeMult().toFixed(1)})` : '');
        // x звёзд фиксирован (правый край перед кнопкой «Настройки»), не двигается от статов
        // Имя руды бывает длинным («Серебро», «Уранит») — ужинаем кегль строки
        // тира, чтобы текст не заходил под кнопку мультипокупки (скриншот игрока).
        // Пересчёт только при смене текста (строка меняется раз в спуск).
        const tierText = `уровень шахты: ${gameState.tier + 1} — ${tier.name}`;
        if (this._tierText !== tierText) {
            this._tierText = tierText;
            this.tierLabel.setText(tierText);
            const p = this.L.panel;
            const btnLeft = this.L.viewport.x + this.L.viewport.w - p.amountPadRight - p.amountW;
            const maxW = btnLeft - this.tierLabel.x - 10;
            let size = p.tierLabelSize;
            this.tierLabel.setFontSize(size);
            while (size > 10 && this.tierLabel.width > maxW) {
                size -= 1;
                this.tierLabel.setFontSize(size);
            }
        }

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
            this.hint.setVisible(true);
        } else {
            this.unlockBtn.setVisible(false);
            this.unlockText.setVisible(false);
            const idleTxt = `Кликай по блоку, чтобы добывать ${tier.name.toLowerCase()}!`;
            if (idleTxt !== this._hintText) {
                this.hint.setText(idleTxt);
                this._hintText = idleTxt;
            }
            this.hint.setVisible(!this.registry.get('blockLocked'));
        }

        // Вкладки: активная подсветка
        for (const t of this.tabBtns) {
            const active = t.tab.id === this.activeTab;
            t.bg.setTexture(active ? 'buy_button_normal' : 'buy_button_disabled_gray');
            t.lbl.setColor(active ? '#ffffff' : '#b0b0b0');
        }

        // Ряды: фильтр по вкладке + «доступные + 1 следующее», перепозиционирование
        const rowH = this.rowGeom().h;
        let y = 0;
        for (const row of this.rows) {
            const def = row.def;
            const show = def.tab === this.activeTab && isUpgradeVisible(def.id);
            row.rc.setVisible(show);
            if (!show) continue;
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
                row.btn.setTexture('buy_button_disabled_gray');
                row.btnText.setText('—').setColor('#b0b0b0');
                // Гейт глубины приоритетнее: пока шахта мелкая, цепочку всё равно не докрутить.
                // Нумерация как в ярлыке «уровень шахты: N — Руда» (с единицы: уголь = 1).
                const lockTxt = def.tier !== undefined && gameState.tier < def.tier
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
                row.btn.setTexture('buy_button_disabled_gray');
                row.btnText.setText('макс').setColor('#c8c8c8');
                row.lockText.setText('');
                row.priceIcon.setVisible(false);
                row.priceText.setVisible(true);
                row.priceText.setText('макс').setColor('#9a9a9a');
            } else if (amount === 'max') {
                // МАКС: покупаем максимум уровней, на которые хватает руды
                const r = getAffordableBulk(def.id, Infinity);
                const afford = r.n > 0;
                row.btn.setTexture(afford ? 'buy_button_normal' : 'buy_button_disabled_gray');
                row.btnText.setText('Купить').setColor(afford ? '#ffffff' : '#b0b0b0');
                row.lockText.setText('');
                this.placeIcon(row.priceIcon, tier.iconKey, row.priceCX, row.priceCY, this.rowGeom().priceIconSize);
                row.priceIcon.setVisible(true);
                row.priceText.setVisible(true);
                const priceStr = r.n > 0
                    ? (r.n > 1 ? `${fmt(r.total)} x${r.n}` : fmt(r.total))
                    : fmt(getUpgradeCost(def.id));
                row.priceText.setText(priceStr).setColor('#ffd75e');
            } else {
                // Строгий пакет x{amount}: либо весь пакет целиком, либо ничего
                // (ужимается только лимитом уровней самого улучшения)
                const b = getBulkCost(def.id, amount);
                const r = getAffordableBulk(def.id, amount);
                const afford = b.n > 0 && r.n === b.n;
                row.btn.setTexture(afford ? 'buy_button_normal' : 'buy_button_disabled_gray');
                row.btnText.setText('Купить').setColor(afford ? '#ffffff' : '#b0b0b0');
                row.lockText.setText('');
                this.placeIcon(row.priceIcon, tier.iconKey, row.priceCX, row.priceCY, this.rowGeom().priceIconSize);
                row.priceIcon.setVisible(true);
                row.priceText.setVisible(true);
                const priceStr = b.n < amount ? `${fmt(b.total)} x${b.n}` : fmt(b.total);
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
            // Дневной баф сознательно НЕ строкой в статах: 6-я строка удлиняла блок
            // до наезда тумблеров (скриншот игрока с Pages) — таймер уже в HUD (buffLine)

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

    // ---------- Псевдо-обучение (только первый запуск) ----------

    buildTutorial() {
        if (gameState.tutorialDone) return;
        if (this.tutDim) return; // идемпотентность: не строим второй слой поверх
        this.tutorialStep = 0;
        this.tutClickStart = gameState.clicks;
        this.tutShownAt = 0;
        this.tutTabClicked = -1;
        // Учебные слои (38/39) — НАД игровым UI, но ПОД модалками (40/41/50/51):
        // иначе обучение перекрывало настройки/офлайн-окно у нового игрока
        this.tutDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.45).setDepth(38);
        this.tutRing = this.add.graphics().setDepth(39);
        this.tutArrow = this.add.graphics().setDepth(39);
        this.tutBubble = this.add.rectangle(0, 0, 1, 1, 0x1c1620, 0.92).setDepth(39).setStrokeStyle(2, 0xffd75e, 1);
        this.tutText = makeLabel(this, 0, 0, '', 15, '#ffe9b0', { align: 'center' }).setOrigin(0.5).setDepth(39);
        this.tutFinal = makeLabel(this, 0, 0, 'Приятной игры!', 26, '#ffe9b0').setOrigin(0.5).setDepth(39).setVisible(false);
        this.tutBtn = this.add.image(640, 400, 'buy_button_normal').setDisplaySize(200, 56).setDepth(39).setVisible(false);
        this.tutBtnLbl = makeLabel(this, 640, 400, 'Играть', 18, '#ffffff').setOrigin(0.5).setDepth(39).setVisible(false);
        this.tutBtn.setInteractive({ useHandCursor: true });
        this.tutBtn.on('pointerdown', () => this.finishTutorial());
        // клики по вкладкам: учебный шаг ждёт клик по нужной вкладке
        this.tabBtns[0].c.on('pointerdown', () => { this.tutTabClicked = 0; });
        this.tabBtns[1].c.on('pointerdown', () => { this.tutTabClicked = 1; });
        // список рендерит вторая камера — учебные объекты исключаем из неё
        this.listCam.ignore([this.tutDim, this.tutRing, this.tutArrow, this.tutBubble, this.tutText, this.tutFinal, this.tutBtn, this.tutBtnLbl]);
        this.tutPulse = this.tweens.add({ targets: this.tutRing, alpha: { from: 1, to: 0.4 }, duration: 700, yoyo: true, repeat: -1 });
        this.tutBob = this.tweens.add({ targets: this.tutArrow, y: { from: 0, to: 10 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.layoutTutorial();
    }

    layoutTutorial() {
        this.tutRing.clear();
        this.tutArrow.clear();
        // Позиции — от ЖИВЫХ объектов (блок GameScene, вкладки): раскладка может
        // меняться (портрет/ландшафт), захардкоженные прямоугольники здесь недопустимы.
        const gs = this.scene.get('GameScene');
        const L = this.L;
        const ring = (x, y, w, h) => {
            this.tutRing.fillStyle(0xffd75e, 0.12);
            this.tutRing.fillRect(x, y, w, h);
            this.tutRing.lineStyle(3, 0xffd75e, 1);
            this.tutRing.strokeRect(x, y, w, h);
        };
        if (this.tutorialStep === 0) {
            // блок: подсветка + стрелка сверху + подпись
            const bx = gs.blockX, by = gs.blockY;
            ring(bx - 160, by - 160, 320, 320);
            if (L.portrait) {
                // Портрет: блок выше — пузырь в зазор между HUD (низ 122) и блоком (верх by-141),
                // иначе текст ложится на строку gps/звёзд
                this.tutBubble.setPosition(bx, by - 185).setSize(440, 52);
                this.tutText.setText('Кликай по кубику — добывай руду!');
                this.tutText.setPosition(bx, by - 185);
                this.tutArrow.fillStyle(0xffd75e, 1);
                this.tutArrow.fillTriangle(bx - 14, by - 156, bx + 14, by - 156, bx, by - 146);
            } else {
                this.tutBubble.setPosition(bx, by - 280).setSize(440, 52);
                this.tutText.setText('Кликай по кубику — добывай руду!');
                this.tutText.setPosition(bx, by - 280);
                this.tutArrow.fillStyle(0xffd75e, 1);
                this.tutArrow.fillTriangle(bx - 14, by - 235, bx + 14, by - 235, bx, by - 195);
            }
        } else if (this.tutorialStep === 1 || this.tutorialStep === 2) {
            // вкладки: кольцо по живой позиции/размеру контейнера вкладки
            const t = this.tabBtns[this.tutorialStep - 1];
            const cx = t.c.x, cy = t.c.y;
            const tw = t.bg.displayWidth, th = t.bg.displayHeight;
            ring(cx - tw / 2 - 5, cy - th / 2 - 6, tw + 10, th + 12);
            if (L.tutorial.tabBubble === 'left') {
                // Ландшафт: подпись слева от вкладки, стрелка вправо
                if (this.tutorialStep === 1) {
                    this.tutBubble.setPosition(cx - 306, cy - 8).setSize(380, 66);
                    this.tutText.setText('Покупай оборудование здесь —\nоно усиливает каждый клик');
                    this.tutText.setPosition(cx - 306, cy - 8);
                    this.tutArrow.fillTriangle(cx - 111, cy - 22, cx - 111, cy + 6, cx - 81, cy - 8);
                } else {
                    this.tutBubble.setPosition(cx - 157, cy - 78).setSize(360, 46);
                    this.tutText.setText('А здесь — усиления: криты и жилы');
                    this.tutText.setPosition(cx - 157, cy - 78);
                    this.tutArrow.fillTriangle(cx, cy - 52, cx + 28, cy - 52, cx + 14, cy - 22);
                }
            } else {
                // Портрет: подпись под вкладкой (над списком), стрелка вверх
                const txt = this.tutorialStep === 1
                    ? 'Покупай оборудование здесь —\nоно усиливает каждый клик'
                    : 'А здесь — усиления: криты и жилы';
                this.tutBubble.setPosition(cx, cy + 110).setSize(380, this.tutorialStep === 1 ? 66 : 46);
                this.tutText.setText(txt);
                this.tutText.setPosition(cx, cy + 110);
                this.tutArrow.fillTriangle(cx - 14, cy + 52, cx + 14, cy + 52, cx, cy + 26);
            }
        }
    }

    stepTutorial() {
        if (!this.tutDim) return;
        const now = this.time.now;
        if (this.tutorialStep === 0 && gameState.clicks >= this.tutClickStart + 3) {
            this.tutorialStep = 1;
            this.tutShownAt = now;
            this.layoutTutorial();
        } else if (this.tutorialStep === 1 && (this.tutTabClicked === 0 || now - this.tutShownAt >= 6000)) {
            this.tutorialStep = 2;
            this.tutShownAt = now;
            this.layoutTutorial();
        } else if (this.tutorialStep === 2 && (this.tutTabClicked === 1 || now - this.tutShownAt >= 6000)) {
            this.showTutorialFinal();
        }
    }

    showTutorialFinal() {
        this.tutorialStep = 3;
        this.tutRing.clear().setVisible(false);
        this.tutArrow.clear().setVisible(false);
        this.tutBubble.setVisible(false);
        this.tutText.setVisible(false);
        this.tutFinal.setPosition(this.L.modal.cx, this.L.tutorial.finalY).setVisible(true);
        this.tutBtn.setPosition(this.L.modal.cx, this.L.tutorial.btnY).setVisible(true);
        // Ярлык переставляется ВМЕСТЕ с кнопкой: раньше он оставался на
        // ландшафтных координатах создания (640, 400) — в портрете улетал
        // вправо, кнопка оставалась пустой (скриншот игрока)
        this.tutBtnLbl.setPosition(this.L.modal.cx, this.L.tutorial.btnY).setVisible(true);
    }

    finishTutorial() {
        gameState.tutorialDone = true;
        saveGame();
        if (this.tutPulse) this.tutPulse.stop();
        if (this.tutBob) this.tutBob.stop();
        [this.tutDim, this.tutRing, this.tutArrow, this.tutBubble, this.tutText, this.tutFinal, this.tutBtn, this.tutBtnLbl]
            .forEach((o) => o.destroy());
        this.tutDim = null;
    }

    // «Полный сброс» возвращает tutorialDone=false, но учебные объекты строятся
    // единожды в create() — пересобираем в текущей сессии, иначе обучение
    // появилось бы только после перезагрузки страницы (CONTEXT: «Полный сброс
    // показывает обучение заново»). Идемпотентно по tutDim.
    maybeRebuildTutorial() {
        if (!gameState.tutorialDone && !this.tutDim) this.buildTutorial();
    }

    update() {
        this.stepTutorial();
        this.refreshUi();
    }
}
