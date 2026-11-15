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
    DAILY_REWARDS, BOSSES, COMPONENTS, ARTIFACTS,
    ITEMS, CRAFT_RECIPES, useItem, canCraft, startCraft, canClaimCraft, claimCraft,
    getItemPrice, buyItem, canBuyItem, getBossRecord
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

// Адаптивный кегль: ставит целевой размер (уже умноженный на масштаб) и ужинает
// шагом по 1px, пока текст не впишется в maxW (прецедент ужина имён рядов).
function fitFontSize(t, target, maxW, min = 9) {
    let size = Math.max(min, Math.round(target));
    t.setFontSize(size);
    while (size > min && t.width > maxW) {
        size -= 1;
        t.setFontSize(size);
    }
    return size;
}

// Ужимает кегль, пока текст занимает больше одной строки (перенос не допускается).
function fitOneLine(t, target, min = 9) {
    let size = Math.max(min, Math.round(target));
    t.setFontSize(size);
    while (size > min && t.height > size * 1.55) {
        size -= 1;
        t.setFontSize(size);
    }
    return size;
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

// Карта шахты «как настольная»: фон-доска map_board, вертикальная тропа из
// кружков (Graphics), соединённых пунктиром со стрелками-шевронами; тексты —
// под кружком. Прокрутка камерой mapCam по внутренней зоне панели. Контент:
// отступ сверху 90, узлы шагом 132 (кружок r28/34 + подписи снизу; шаг держит
// зазор тропы «низ подписи + 4s + 6 <= верх следующего кружка − 9s» для ВСЕХ
// пар, включая босс → следующий тир, где подписи глубже), запас снизу 60.
const MAP_NODE_H = 132;
const MAP_HEAD = 90;
const MAP_TAIL = 60;
const MAP_R_TIER = 28;
const MAP_R_BOSS = 34;

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
        // Полноэкранные состояния: любой может быть открыт одновременно, блокировка
        // (registry 'blockLocked') снимается только после закрытия ПОСЛЕДНЕГО.
        // Единый пересчёт — updateBlockLock() из refreshUi каждый кадр по диффу.
        this._settingsOpen = false;
        this._offlineOpen = false;
        this._dailyOpen = false;
        this._mapOpen = false;       // экран карты шахты
        this._craftOpen = false;     // экран мастерской (каркас П5)
        this._bossRewardOpen = false; // окно награды босса (П4)
        this._blockLocked = null;    // кеш updateBlockLock: registry 'blockLocked'
        this._adaptiveScale = 1;     // портретный масштаб кеглей (applyLayout)
        this._rowsBuiltS = 1;
        this._craftRowsS = 1;
        this._mapS = 1;
        this._headerS = 1;
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
        this.buildGearSection();
        this.buildUnlockButton();
        this.buildModal();
        this.buildOfflineModal();
        this.buildDailyModal();
        this.buildMapScreen();
        this.buildCraftScreen();
        this.buildBossRewardModal();
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

        // Смена состояния боя: панель переключается на «Снаряжение» и в портрете
        // поднимается под блок босса (пересборка сетки — applyLayout)
        this.game.events.on('boss-changed', () => {
            this.applyLayout();
            this.refreshUi();
        });

        // Офлайн-модалка по событию: симуляция из DevPanel и реальный возврат
        // во вкладку идут по одному пути (registry.offlineInfo + offline-applied)
        this.game.events.on('offline-applied', (info) => {
            if (this.offlineModal.visible) return;
            this.showOfflineModal(info);
        });

        // Награда за босса: ивент приходит после снятия bossActive — поверх
        // других модалок не вылезает
        this.game.events.on('boss-defeated', (reward) => this.showBossRewardModal(reward));

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
        // Шестерёнка + подпись: зазор 10px между иконкой и текстом. Иконка
        // нормируется setDisplaySize (текстуры разного разрешения), подпись —
        // с левым якорем: раньше она упиралась в шестерёнку вплотную (скрин игрока)
        this.settingsGear = this.add.image(btnX + 29, 62, 'gear_icon').setDisplaySize(26, 26).setDepth(12);
        this.settingsLbl = makeLabel(this, btnX + 52, 62, 'Настройки', 16, '#ffffff').setOrigin(0, 0.5).setDepth(12);
        this.settingsBtn.on('pointerdown', () => {
            this.openModal();
        });
        this.settingsBtn.on('pointerover', () => this.settingsBtn.setAlpha(0.9));
        this.settingsBtn.on('pointerout', () => this.settingsBtn.setAlpha(1));

        // Кнопки «Карта» и «Крафт» слева от «Настройки» (позиции из L.hud в applyLayout)
        this.mapBtn = addImg(this, 830, 38, 'buy_button_normal', 110, 48, 11);
        this.mapBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
        this.mapLbl = makeLabel(this, 885, 62, 'Карта', 14, '#ffffff').setOrigin(0.5).setDepth(12);
        this.mapBtn.on('pointerdown', () => this.openMap());
        this.mapBtn.on('pointerover', () => this.mapBtn.setAlpha(0.9));
        this.mapBtn.on('pointerout', () => this.mapBtn.setAlpha(1));

        this.craftBtn = addImg(this, 952, 38, 'buy_button_normal', 110, 48, 11);
        this.craftBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
        this.craftLbl = makeLabel(this, 1007, 62, 'Крафт', 14, '#ffffff').setOrigin(0.5).setDepth(12);
        this.craftBtn.on('pointerdown', () => this.openCraft());
        this.craftBtn.on('pointerover', () => this.craftBtn.setAlpha(0.9));
        this.craftBtn.on('pointerout', () => this.craftBtn.setAlpha(1));

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
        this._rowsBuiltS = this._adaptiveScale;
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

    // ---------- Секция «Снаряжение» панели (видна только в босс-бое) ----------

    // Во время боя правая панель показывает предметы для файта вместо списка
    // улучшений (замечание игрока: снаряжение не видно). Геометрия — как у рядов
    // улучшений: addImg-карточка (пропорциональный скейл; НЕ nine-slice — борды
    // 10px-заготовки при setDisplaySize растягиваются в ~30x, поймано скриншотом
    // игрока) и кнопки add.image. Компоновка: иконка+имя+запас сверху, описание
    // во всю ширину, две кнопки в нижнем ряду карточки.
    buildGearSection() {
        this.gearContent = this.add.container(0, 0).setDepth(12).setVisible(false);
        this.gearTitle = makeLabel(this, 0, 0, 'Снаряжение', 18, '#ffe9b0').setOrigin(0.5);
        this.gearContent.add(this.gearTitle);
        this.gearRows = ITEMS.filter((it) => it.bossUse).map((def) => {
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', 10, 10, 11);
            const icon = this.add.image(0, 0, def.id);
            const name = makeLabel(this, 0, 0, def.name, 15, '#ffe9b0');
            name.setOrigin(0, 0.5);
            const stock = makeLabel(this, 0, 0, '', 13, '#ffe9b0');
            stock.setOrigin(1, 0.5);
            const desc = makeLabel(this, 0, 0, def.desc, 12, '#c8c8c8', { wordWrap: { width: 200 } });
            desc.setOrigin(0, 0);
            const buyBtn = this.add.image(0, 0, 'buy_button_normal').setDepth(12);
            buyBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
            const buyLbl = makeLabel(this, 0, 0, '', 12, '#ffffff').setOrigin(0.5);
            buyBtn.on('pointerup', () => {
                if (this._listDragging) return;
                if (buyItem(def.id)) {
                    playSfx(this, 'purchase');
                    this.refreshGearPanel(true);
                }
            });
            const useBtn = this.add.image(0, 0, 'buy_button_normal').setDepth(12);
            useBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
            const useLbl = makeLabel(this, 0, 0, 'Использовать', 12, '#ffffff').setOrigin(0.5);
            useBtn.on('pointerup', () => {
                if (this._listDragging) return;
                if ((gameState.items[def.id] || 0) > 0 && useItem(def.id, true)) {
                    playSfx(this, 'purchase');
                    this.refreshGearPanel(true);
                }
            });
            this.gearContent.add([card, icon, name, stock, desc, buyBtn, buyLbl, useBtn, useLbl]);
            return { def, card, icon, name, stock, desc, buyBtn, buyLbl, useBtn, useLbl, _key: null };
        });
    }

    // Позиция секции от вьюпорта панели (пересчёт в applyLayout, включая боевой
    // вариант портретной сетки)
    layoutGearSection() {
        if (!this.gearContent) return;
        const vw = VIEWPORT;
        const s = this._adaptiveScale || 1;
        const ts = this.L.portrait ? s : 1;
        this.gearTitle.setPosition(vw.x + vw.w / 2, vw.y + 16);
        this.gearTitle.setFontSize(Math.round(18 * ts));
        const rh = Math.round(160 * ts);
        let ry = vw.y + 34;
        for (const row of this.gearRows) {
            const w = vw.w - 8;
            // addImg — origin (0.5): setPosition задаёт ЦЕНТР карточки
            // (пойманный аудит-чеком сдвиг на полширины — карточка вылезала
            // за левый край вьюпорта, иконка висела вне карточки)
            row.card.setPosition(vw.x + 4 + w / 2, ry + rh / 2);
            row.card.setDisplaySize(w, rh);
            const f = w / 835; // пропорции текстуры карточки — ниша иконки слева
            const iconCX = vw.x + 4 + Math.round(118 * f);
            const iconSize = Math.round(52 * ts);
            row.icon.setPosition(iconCX, ry + Math.round(56 * ts));
            row.icon.setDisplaySize(iconSize, iconSize);
            const textX = iconCX + iconSize / 2 + 14;
            const textRight = vw.x + 4 + w - 14;
            // Столбик: имя -> запас -> описание (в ландшафте 280px «имя + запас»
            // в одну строку не помещаются — поймано аудит-чеком наезда)
            row.name.setPosition(textX, ry + Math.round(28 * ts));
            row.name.setFontSize(Math.round(15 * ts));
            row.stock.setPosition(textX, ry + Math.round(54 * ts));
            row.stock.setFontSize(Math.round(13 * ts));
            row.stock.setOrigin(0, 0.5);
            row.desc.setPosition(textX, ry + Math.round(78 * ts));
            row.desc.setFontSize(Math.round(12 * ts));
            row.desc.wordWrap = { width: Math.max(80, textRight - textX) };
            row.desc.updateText();
            // Кнопки в нижнем ряду карточки: две по половине ширины с зазором 12;
            // отступ от описания >= 19px (наезд текста на кнопки — скриншот игрока)
            const btnW = Math.round((w - 28 - 12) / 2);
            const btnH = Math.round(40 * ts);
            const btnY = ry + rh - btnH - 10;
            row.buyBtn.setPosition(vw.x + 4 + 14 + btnW / 2, btnY + btnH / 2);
            row.buyBtn.setDisplaySize(btnW, btnH);
            row.buyLbl.setPosition(row.buyBtn.x, row.buyBtn.y);
            row.buyLbl.setFontSize(Math.round(12 * ts));
            row.useBtn.setPosition(vw.x + 4 + 14 + btnW + 12 + btnW / 2, btnY + btnH / 2);
            row.useBtn.setDisplaySize(btnW, btnH);
            row.useLbl.setPosition(row.useBtn.x, row.useBtn.y);
            row.useLbl.setFontSize(Math.round(12 * ts));
            ry += rh + 10;
        }
        this.refreshGearPanel(true);
    }

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
            row.stock.setText(`в запасе: ${stock}`);
            row.buyBtn.setTexture(canBuy ? 'buy_button_normal' : 'buy_button_disabled_gray');
            row.buyLbl.setText(`Купить · ${fmt(price)}`);
            row.useBtn.setTexture(stock > 0 ? 'buy_button_normal' : 'buy_button_disabled_gray');
        }
    }

    // ---------- Адаптивная раскладка (см. src/layout.js) ----------

    applyLayout() {
        const L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        this.L = L;
        // Боевой вариант портретной сетки: панель поднимается под блок босса
        // (пустота под боссом и сжатая панель — замечание игрока), кнопки
        // Карта/Крафт следуют за панелью. Формула byF синхронна с
        // GameScene.buildBossOverlay (кламп 386).
        const bossNow = !!this.registry.get('bossActive');
        if (L.portrait && bossNow) {
            const byF = Math.max(L.block.y, 386);
            const fightPy = byF + 224;
            L.panel.py = fightPy;
            L.panel.ph = L.H - fightPy;
            L.viewport.y = fightPy + 156;
            L.viewport.h = Math.max(220, L.panel.ph - 156 - 32);
            L.hud.mapBtn.y = fightPy + 24;
            L.hud.craftBtn.y = fightPy + 24;
            L.unlock.y = fightPy - 56;
            L.unlock.hintY = fightPy - 24;
        }
        Object.assign(VIEWPORT, L.viewport);
        // Портретный масштаб кеглей: 390px -> 1.8, 720px -> 1.0 (FIT-даунскейл
        // съедает мелкий шрифт на телефонах — замечание игрока R7-R9)
        this._adaptiveScale = L.portrait ? Phaser.Math.Clamp(720 / (this.scale.displaySize.width || 720), 1.0, 1.8) : 1.0;
        const s = this._adaptiveScale;
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
        if (L.portrait) {
            // Кегли HUD с клампами под доступную ширину бара (поток
            // счётчик -> имя -> ставка двигается вправо от counterX)
            this.coalText.setFontSize(Phaser.Math.Clamp(Math.round(30 * s), 30, 36));
            this.oreName.setFontSize(Phaser.Math.Clamp(Math.round(13 * s), 13, 16));
            this.statsLine.setFontSize(Phaser.Math.Clamp(Math.round(14 * s), 14, 18));
            this._statsFitKey = null;
            this._gpsFitKey = null;
            this.starsText.setFontSize(Phaser.Math.Clamp(Math.round(16 * s), 16, 22));
            this.buffLine.setFontSize(Phaser.Math.Clamp(Math.round(13 * s), 13, 20));
        } else {
            this.coalText.setFontSize(30);
            this.oreName.setFontSize(13);
            this.statsLine.setFontSize(h.statsSize);
            // Кегль сброшен — кеш ужина статов обязан инвалидироваться, иначе
            // после applyLayout (босс-бой) refreshUi пропускает ужин и длинные
            // статы наезжают на «Карта» (поймано аудитом сценария 19)
            this._statsFitKey = null;
            this.starsText.setFontSize(16);
            this.buffLine.setFontSize(13);
        }
        const btnX = h.btnX;
        if (L.portrait) {
            // «Настройки»: растёт от правого края (кегль и высота с клампом
            // под врезку бара), звёзды в портрете на панели — место свободно
            const sBtn = Math.min(s, 1.25);
            const bw = Math.round(h.btnW * sBtn);
            const bh = Phaser.Math.Clamp(Math.round(h.btnH * sBtn), h.btnH, 64);
            const right = h.btnX + h.btnW;
            this.settingsBtn.setPosition(right - bw / 2, h.centerY);
            this.settingsBtn.setDisplaySize(bw, bh);
            this.settingsGear.setPosition(right - bw + Math.round(h.gearDx * sBtn), h.centerY);
            this.settingsGear.setDisplaySize(Math.round(26 * sBtn), Math.round(26 * sBtn));
            this.settingsLbl.setPosition(right - bw + Math.round(h.labelDx * sBtn), h.centerY);
            fitFontSize(this.settingsLbl, 16 * sBtn, bw - Math.round(h.labelDx * sBtn) - 8, 14);
        } else {
            this.settingsBtn.setPosition(btnX + h.btnW / 2, h.centerY);
            this.settingsBtn.setDisplaySize(h.btnW, h.btnH);
            this.settingsGear.setPosition(btnX + h.gearDx, h.centerY);
            this.settingsGear.setDisplaySize(26, 26);
            this.settingsLbl.setPosition(btnX + h.labelDx, h.centerY);
            this.settingsLbl.setFontSize(16);
        }
        this.mapBtn.setPosition(h.mapBtn.x + h.mapBtn.w / 2, h.mapBtn.y + h.mapBtn.h / 2);
        this.mapBtn.setDisplaySize(h.mapBtn.w, h.mapBtn.h);
        this.mapLbl.setPosition(h.mapBtn.x + h.mapBtn.w / 2, h.mapBtn.y + h.mapBtn.h / 2);
        this.craftBtn.setPosition(h.craftBtn.x + h.craftBtn.w / 2, h.craftBtn.y + h.craftBtn.h / 2);
        this.craftBtn.setDisplaySize(h.craftBtn.w, h.craftBtn.h);
        this.craftLbl.setPosition(h.craftBtn.x + h.craftBtn.w / 2, h.craftBtn.y + h.craftBtn.h / 2);
        if (L.portrait) {
            // Кнопки на планке панели: кегль по масштабу; высота клампится до 38,
            // чтобы низ (py+39 + h/2) не заходил на полосу вкладок (py+58)
            const btnH = Phaser.Math.Clamp(Math.round(30 * s), 30, 38);
            this.mapBtn.setDisplaySize(h.mapBtn.w, btnH);
            this.craftBtn.setDisplaySize(h.craftBtn.w, btnH);
            fitFontSize(this.mapLbl, 14 * s, h.mapBtn.w - 16, 11);
            fitFontSize(this.craftLbl, 14 * s, h.craftBtn.w - 16, 11);
        } else {
            this.mapLbl.setFontSize(14);
            this.craftLbl.setFontSize(14);
        }

        // Панель улучшений + шапка (вкладки/тир/мультипокупка)
        const p = L.panel;
        this.panelImg.setPosition(p.px + p.pw / 2, p.py + p.ph / 2);
        this.panelImg.setDisplaySize(p.pw, p.ph);
        this.panelTitle.setPosition(p.px + p.pw / 2, p.py + p.titleDy);
        this.panelTitle.setFontSize(p.titleSize);
        // В портрете звёзды живут на планке заголовка панели (HUD плотный);
        // в ландшафте — в HUD перед кнопкой «Настройки»
        if (L.portrait) this.starsText.setPosition(p.px + p.pw - 24, p.py + p.titleDy);
        // Ландшафт: звёзды ПОД HUD-баром справа (строка бафов слева) — в баре
        // при длинных статах «клик: 2712 · крит: 31%» они наезжали на текст
        // (скриншот сценария 19); правый край барa — якорь origin (1,0.5)
        else this.starsText.setPosition(h.barX + h.barW - 10, h.barY + h.barH + 10);
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

        // Список: камера клиппинга следует за вьюпортом; смена ширины или
        // портретного масштаба — пересборка рядов (rowGeom зависит от s)
        if (this.listCam) this.listCam.setViewport(L.viewport.x, L.viewport.y, L.viewport.w, L.viewport.h);
        if (this.rows && this.rows.length && (this._rowsBuiltW !== VIEWPORT.w || this._rowsBuiltS !== s)) {
            this.rebuildRows();
        }
        this._rowsBuiltW = VIEWPORT.w;
        this._rowsBuiltS = s;

        // Кнопка спуска + подсказка
        const u = L.unlock;
        this.unlockBtn.setPosition(u.cx - u.w / 2, u.y);
        this.unlockText.setPosition(u.cx, u.y + u.h / 2);
        this.unlockText.setFontSize(u.textSize);
        this.hint.setPosition(u.cx, u.hintY);
        this.hint.setFontSize(u.hintSize);
        // В бою спуск скрыт целиком (заблокирован; серая кнопка рядом с боссом
        // читалась как «вернуться в шахту» и наезжала на подсказку слотов)
        const hideUnlock = bossNow;
        this.unlockBtn.setVisible(!hideUnlock);
        this.unlockText.setVisible(!hideUnlock);
        this.hint.setVisible(!hideUnlock);

        // Секция «Снаряжение» панели — позиция от вьюпорта (в бою панель выше)
        this.layoutGearSection();

        // Модалки: затемнение на всю сетку, панель по центру; текст в портрете
        // крупнее (FIT-даунскейл ~0.52 на телефонах съедает кегль)
        this.modalDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.offlineDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.dailyDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.modal.setPosition(L.modal.cx, L.modal.cy);
        this.offlineModal.setPosition(L.modal.cx, L.modal.cy);
        this.dailyModal.setPosition(L.modal.cx, L.modal.cy);
        this.mapDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.craftDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.bossRewardDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.bossRewardModal.setPosition(L.modal.cx, L.modal.cy);

        // Экран карты: ландшафт 760x620 в L.modal; портрет — w=W-24, h=min(py-40,640),
        // центр h/2+16 (панель в свободной зоне над «листом»)
        let mpw, mph, mcy;
        if (L.portrait) {
            mpw = L.W - 24;
            mph = Math.min(L.panel.py - 40, 640);
            mcy = Math.round(mph / 2) + 16;
        } else {
            mpw = 760;
            mph = 620;
            mcy = L.modal.cy;
        }
        this.mapRoot.setPosition(L.modal.cx, mcy);
        this.mapPanel.setDisplaySize(mpw, mph);
        this.mapTitle.setPosition(0, -mph / 2 + 64);
        this.mapTitle.setFontSize(L.portrait ? 26 : 30);
        this.mapClose.setPosition(mpw / 2 - 60, -mph / 2 + 72);
        const mvx = L.modal.cx - mpw / 2 + 40;
        const mvw = mpw - 80;
        const mvy = mcy - mph / 2 + 96;
        const mvh = mph - 156;
        this.mapCam.setViewport(mvx, mvy, mvw, mvh);
        this._mapView = { x: mvx, y: mvy, w: mvw, h: mvh };
        this.mapBoard.setPosition(mvx + mvw / 2 - L.modal.cx, mvy + mvh / 2 - mcy);
        this.mapBoard.setDisplaySize(mvw, mvh);
        if (this.mapNodes && this._mapS !== s) {
            this._mapS = s;
            if (this._mapAnim) this.skipMapAnim();
            this.buildMapNodes();
        }
        this._mapHalfH = mph / 2;
        this._mapMaxScroll = Math.max(0, this._mapContentH - mvh);
        this.mapCam.scrollY = Phaser.Math.Clamp(this.mapCam.scrollY, 0, this._mapMaxScroll);
        this._nodeCX = mvw / 2;
        for (const node of this.mapNodes) node.root.x = this._nodeCX;
        if (this.mapMiner) this.mapMiner.x = this._nodeCX + Math.round(-150 * s);
        // Смена ориентации без смены s (s=1.0): узлы не пересобираются, но cx
        // меняется — тропа осталась бы на старой колонке; сдвигаем вслед за узлами
        if (this._trailCX !== undefined && this._trailCX !== this._nodeCX) this._redrawMapTrail();

        // Экран мастерской (каркас): ландшафт 560x600 в L.modal; портрет w=W-24,
        // h=min(py-40,560), cy=h/2+16 — П5 наполнит содержимое
        let cpw, cph, ccy;
        if (L.portrait) {
            cpw = L.W - 24;
            cph = Math.min(L.panel.py - 40, 560);
            ccy = Math.round(cph / 2) + 16;
        } else {
            cpw = 560;
            cph = 600;
            ccy = L.modal.cy;
        }
        this.craftRoot.setPosition(L.modal.cx, ccy);
        this.craftPanel.setDisplaySize(cpw, cph);
        this.craftTitle.setPosition(0, -cph / 2 + 68);
        this.craftTitle.setFontSize(L.portrait ? 26 : 30);
        this.craftClose.setPosition(cpw / 2 - 60, -cph / 2 + 72);
        if (this.craftHeader && this._headerS !== s) {
            this._headerS = s;
            this.buildCraftHeader();
        }
        if (this.craftHeader) this.craftHeader.setPosition(0, -cph / 2 + 108);
        const cvx = L.modal.cx - cpw / 2 + 40;
        const cvw = cpw - 80;
        const headerExtra = Math.max(0, Math.round(22 * Math.min(s, 1.6)) - 22) >> 1;
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
        this._rowsBuiltS = this._adaptiveScale;
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
        const key = `${this.L.portrait ? 'p' : 'l'}|${this._adaptiveScale}`;
        if (this._rowGeomKey === key) return this._rowGeomCache;
        this._rowGeomKey = key;
        if (this.L.portrait) {
            const s = this._adaptiveScale;
            // Поправка приёмки: кегли рядов панели растут по _adaptiveScale,
            // ВЫСОТА РЯДА (108) сохраняется — клампы под карточку, без переносов
            const nameSize = Math.round(18 * Math.min(s, 1.5));
            const nameMin = Math.round(13 * Math.min(s, 1.5));
            const nameSizes = [];
            for (let v = nameSize; v >= nameMin; v--) nameSizes.push(v);
            const descSize = Math.round(14 * Math.min(s, 1.5));
            const descY = Math.max(34, Math.round(10 + nameSize * 1.2 + 3));
            const geom = {
                h: 108, iconCY: 56, iconSize: Phaser.Math.Clamp(Math.round(48 * s), 48, 64),
                nameY: 10, nameSizes,
                descY, descSize,
                priceY: Math.max(88, Math.round(descY + descSize * 1.2 + 6)),
                priceSize: Math.round(15 * Math.min(s, 1.3)), priceIconSize: Math.round(18 * Math.min(s, 1.3)),
                levelSize: Math.round(14 * Math.min(s, 1.3)), rightInset: 20,
                btnY: 28, btnW: 104, btnH: 44, btnSize: Math.round(15 * Math.min(s, 1.33)),
                lockSize: Math.round(13 * Math.min(s, 1.3))
            };
            this._rowGeomCache = geom;
            return geom;
        }
        const geom = {
            h: ROW_H, iconCY: ROW.iconY, iconSize: 40,
            nameY: ROW.nameY, nameSizes: [15, 14, 13, 12, 11, 10],
            descY: ROW.descY, descSize: ROW.descSize,
            priceY: ROW.priceY, priceSize: 13, priceIconSize: 16, levelSize: 12, rightInset: 12,
            btnY: ROW.btnY, btnW: ROW.btnW, btnH: ROW.btnH, btnSize: 14, lockSize: 11
        };
        this._rowGeomCache = geom;
        return geom;
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
        if (this.L.portrait) fitOneLine(descText, g.descSize, 11);
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
        fitFontSize(btnText, g.btnSize, btnW - 12, 8);

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

    // Всплывающие подписи создаются динамически — исключаем их из скролл-камер
    // (иначе списки и карта рисуют сдвинутые копии внутри своих вьюпортов)
    spawnFloat(x, y, text, size, color, extra = {}) {
        const float = makeLabel(this, x, y, text, size, color, extra);
        if (this.listCam) float.cameraFilter |= this.listCam.id;
        if (this.mapCam) float.cameraFilter |= this.mapCam.id;
        if (this.craftCam) float.cameraFilter |= this.craftCam.id;
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
            if (this.registry.get('bossActive')) return;
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
            this.openMap({ animate: true });
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
        this.refreshUi();
    }

    closeModal() {
        this.modalDim.setVisible(false);
        this.modal.setVisible(false);
        this._settingsOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под настройками
    }

    tryPrestige() {
        if (this.registry.get('bossActive')) return;
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
        if (this.registry.get('bossActive')) return;
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
        this.registry.set('offlineInfo', null);
    }

    hideOfflineModal() {
        this.offlineDim.setVisible(false);
        this.offlineModal.setVisible(false);
        this._offlineOpen = false;
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

    // Награда не показывается поверх других модалок и полноэкранных экранов —
    // очередь до их закрытия; в бою тоже откладывается (не дёргаем игрока),
    // покажется после боя — по закрытию окна награды/экрана
    tryShowDailyModal() {
        if (!this._pendingDaily) return;
        if (this.registry.get('bossActive')) return;
        if (this.offlineModal.visible || this.modal.visible || this.dailyModal.visible) return;
        if (this.mapRoot.visible || this.craftRoot.visible || this._bossRewardOpen) return;
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
    }

    hideDailyModal() {
        this.dailyDim.setVisible(false);
        this.dailyModal.setVisible(false);
        this._dailyOpen = false;
        // Обучение, отложенное ради окна награды, стартует после его закрытия
        if (this._tutorialPending && !gameState.tutorialDone) {
            this._tutorialPending = false;
            this.buildTutorial();
        }
    }

    // ---------- Модалка награды за босса ----------

    buildBossRewardModal() {
        const pw = 480;
        const ph = 400;
        this.bossRewardDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.65)
            .setDepth(50).setVisible(false).setInteractive();
        this.bossRewardDim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());

        this.bossRewardModal = this.add.container(640, 360).setDepth(51).setVisible(false);
        const panel = addImgC(this, 0, 0, 'modal_panel_metal', pw, ph);
        const title = makeLabel(this, 0, -158, 'Босс повержен!', 26, '#ffe9b0').setOrigin(0.5);
        this.bossRewardBounty = makeLabel(this, 0, -112, '', 17, '#8fd18f').setOrigin(0.5);
        this.bossRewardSpeed = makeLabel(this, 0, -86, '', 14, '#ffe9b0').setOrigin(0.5);
        this.bossRewardComps = this.add.container(0, 0);
        const okBtn = addNineC(this, 0, 150, 'buy_button_normal', 190, 46);
        okBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 190, 46), Phaser.Geom.Rectangle.Contains);
        const okText = makeLabel(this, 0, 150, 'Забрать', 17, '#ffffff').setOrigin(0.5);
        okBtn.on('pointerdown', () => this.hideBossRewardModal());
        this.bossRewardModal.add([panel, title, this.bossRewardBounty, this.bossRewardSpeed, this.bossRewardComps, okBtn, okText]);

        // Top-level объекты созданы после buildMapScreen/buildCraftScreen — из
        // скролл-камер исключаем вручную (иначе сдвинутые копии окна во вьюпортах);
        // listCam накроет снапшотом setupListCamera, идущего после create()
        const bossLayers = [this.bossRewardDim, this.bossRewardModal];
        if (this.mapCam) this.mapCam.ignore(bossLayers);
        if (this.craftCam) this.craftCam.ignore(bossLayers);
    }

    showBossRewardModal(reward) {
        if (!reward) return;
        this._bossRewardOpen = true;
        if (this._mapOpen) this.closeMap();
        if (this._craftOpen) this.closeCraft();
        this.bossRewardComps.removeAll(true);
        this.bossRewardBounty.setText(`Баунти: +${fmt(reward.bounty)} руды`);
        // Бонус за скорость: «Время: 0:32 · бонус x1.50» — пусто, если время не передано
        if (reward.elapsedSec) {
            const mm = Math.floor(reward.elapsedSec / 60);
            const ss = String(reward.elapsedSec % 60).padStart(2, '0');
            const mult = reward.speedMult ? `x${reward.speedMult.toFixed(2).replace(/\.?0+$/, '')}` : 'x1';
            this.bossRewardSpeed.setText(`Время: ${mm}:${ss} · бонус ${mult}`).setVisible(true);
        } else {
            this.bossRewardSpeed.setVisible(false);
        }
        let y = -64;
        for (const compId of Object.keys(reward.comps || {})) {
            const def = COMPONENTS.find((c) => c.id === compId);
            if (!def) continue;
            const icon = this.add.image(0, 0, def.icon);
            this.placeIcon(icon, def.icon, -120, y, 30);
            const label = makeLabel(this, -94, y, `${def.name} ×${reward.comps[compId]}`, 15, '#d8d8d8').setOrigin(0, 0.5);
            this.bossRewardComps.add([icon, label]);
            y += 42;
        }
        if (reward.artifactId) {
            const def = ARTIFACTS.find((a) => a.id === reward.artifactId);
            if (def) {
                y += 8;
                // У артефактов нет поля icon (ТЗ: ключ текстуры = id)
                const icon = this.add.image(0, 0, def.id);
                this.placeIcon(icon, def.id, -120, y + 12, 42);
                const name = makeLabel(this, -92, y, def.name, 16, '#ffd75e').setOrigin(0, 0.5);
                const desc = makeLabel(this, -92, y + 22, def.desc, 12, '#9ad29a').setOrigin(0, 0.5);
                this.bossRewardComps.add([icon, name, desc]);
            }
        }
        this.bossRewardDim.setVisible(true);
        this.bossRewardModal.setVisible(true);
    }

    hideBossRewardModal() {
        this.bossRewardDim.setVisible(false);
        this.bossRewardModal.setVisible(false);
        this._bossRewardOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под окном босса
    }

    // ---------- Карта шахты ----------

    buildMapScreen() {
        this.mapDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6)
            .setDepth(40).setVisible(false).setInteractive();
        // Тап по карте приходит ИМЕННО сюда: stopPropagation dim'а гасит и
        // scene-level pointerdown, поэтому старт драга (и skip анимации) — здесь
        this.mapDim.on('pointerdown', (pointer, lx, ly, event) => {
            this.startMapDrag(pointer);
            event.stopPropagation();
        });

        this.mapRoot = this.add.container(640, 360).setDepth(41).setVisible(false);
        this.mapPanel = addImgC(this, 0, 0, 'modal_panel_metal', 760, 620);
        // Фон-доска на внутренней зоне панели (растягивается в applyLayout):
        // ребёнок mapRoot сразу после панели — над металлом, под заголовком/
        // крестиком; узлы рисует mapCam ПОВЕРХ (камеры рендерятся после main)
        this.mapBoard = addImgC(this, 0, 0, 'map_board', 680, 464);
        this.mapBoard.setAlpha(0.9);
        this.mapTitle = makeLabel(this, 0, -246, 'Карта шахты', 30, '#ffe9b0').setOrigin(0.5);
        this.mapClose = addImgC(this, 320, -238, 'close_button_square', 44, 44);
        this.mapClose.setInteractive(new Phaser.Geom.Rectangle(0, 0, 196, 191), Phaser.Geom.Rectangle.Contains);
        this.mapClose.on('pointerdown', () => this.closeMap());
        this.mapRoot.add([this.mapPanel, this.mapBoard, this.mapTitle, this.mapClose]);

        // Контент — top-level контейнер (как listContent): вложенный в mapRoot
        // ребёнок рендерился бы только через родителя, а mapCam его игнорирует.
        // Depth 42 — чтобы тапы по кружкам боссов приходили раньше dim (depth 40).
        this.mapContent = this.add.container(0, 0).setDepth(42).setVisible(false);
        this.cameras.main.ignore(this.mapContent);

        // Тропа (пунктир + шевроны) — первый ребёнок mapContent: под кружками;
        // перерисовывается в refreshMapNodes при смене статусов узлов
        this.mapTrail = this.add.graphics();
        this.mapContent.add(this.mapTrail);

        this.buildMapNodes();

        this.mapMiner = this.add.image(0, 0, 'miner_portrait');
        this.placeIcon(this.mapMiner, 'miner_portrait', 190, MAP_HEAD, 36);
        this.mapContent.add(this.mapMiner);

        this.mapCam = this.cameras.add(300, 146, 680, 464, false, 'mapCam');
        this.mapCam.setRoundPixels(true);
        const others = this.children.list.filter((o) => o !== this.mapContent);
        this.mapCam.ignore(others);
        this.mapCam.setVisible(false);
        this._mapView = { x: 300, y: 146, w: 680, h: 464 };
        this._mapHalfH = 310;
        this._mapMaxScroll = Math.max(0, this._mapContentH - 464);
        this._nodeCX = 340;

        this.input.on('wheel', (pointer, over, dx, dy) => {
            if (!this._mapOpen) return;
            const v = this._mapView;
            if (pointer.x >= v.x - 10 && pointer.x <= v.x + v.w + 10
                && pointer.y >= v.y - 10 && pointer.y <= v.y + v.h + 10) {
                this.mapCam.scrollY = Phaser.Math.Clamp(this.mapCam.scrollY + dy * 0.5, 0, this._mapMaxScroll);
            }
        });
        this.setupMapDrag();
    }

    // Узлы карты: кружок (Graphics) по центру колонки, иконка внутри, тексты
    // под кружком; позиции и кегли по портретному масштабу; пересоздаются
    // при смене s (applyLayout), статусы (обводка/пульс) обновляет refreshMapNodes
    buildMapNodes() {
        const s = this._adaptiveScale || 1;
        for (const node of (this.mapNodes || [])) {
            if (node.pulse) {
                node.pulse.stop();
                node.pulse = null;
            }
            if (node.ringPulse) {
                node.ringPulse.stop();
                node.ringPulse = null;
            }
            node.root.destroy();
        }
        this.mapNodes = [];
        let idx = 0;
        for (let t = 0; t < TIERS.length; t++) {
            this.mapNodes.push(this.buildMapTierNode(t, idx++));
            const boss = BOSSES.find((b) => b.tier === t);
            if (boss) this.mapNodes.push(this.buildMapBossNode(boss, idx++));
        }
        this._mapContentH = Math.round((MAP_HEAD + this.mapNodes.length * MAP_NODE_H + MAP_TAIL) * s);
        if (this.mapTrail) this.mapTrail.clear();
    }

    buildMapTierNode(t, idx) {
        const s = this._adaptiveScale || 1;
        const r = Math.round(MAP_R_TIER * s);
        const root = this.add.container(340, Math.round((MAP_HEAD + idx * MAP_NODE_H) * s));
        const ring = this.add.graphics().setPosition(0, r);
        const ringLine = this.add.graphics().setPosition(0, r);
        const icon = this.add.image(0, r, TIERS[t].iconKey);
        this.placeIcon(icon, TIERS[t].iconKey, 0, r, Math.round(30 * Math.min(s, 1.6)));
        const nameY = r * 2 + Math.round(8 * s);
        const name = makeLabel(this, 0, nameY, `${t + 1}. ${TIERS[t].name}`, 13, '#ffffff').setOrigin(0.5, 0);
        fitFontSize(name, 13 * s, (this._mapView ? this._mapView.w : 680) - 24, 10);
        root.add([ring, ringLine, icon, name]);
        this.mapContent.add(root);
        return { kind: 'tier', tier: t, root, ring, ringLine, icon, name, pulse: null, ringPulse: null, _state: null, _r: r };
    }

    buildMapBossNode(boss, idx) {
        const s = this._adaptiveScale || 1;
        const r = Math.round(MAP_R_BOSS * s);
        const root = this.add.container(340, Math.round((MAP_HEAD + idx * MAP_NODE_H) * s));
        const ring = this.add.graphics().setPosition(0, r);
        const ringLine = this.add.graphics().setPosition(0, r);
        ring.setInteractive(new Phaser.Geom.Circle(0, 0, r), Phaser.Geom.Circle.Contains);
        const icon = this.add.image(0, r, boss.icon);
        this.placeIcon(icon, boss.icon, 0, r, Math.round(40 * Math.min(s, 1.6)));
        const nameY = r * 2 + Math.round(7 * s);
        const maxW = (this._mapView ? this._mapView.w : 680) - 24;
        const name = makeLabel(this, 0, nameY, boss.name, 14, '#ffffff').setOrigin(0.5, 0);
        fitFontSize(name, 14 * s, maxW, 10);
        const status = makeLabel(this, 0, nameY + Math.round(18 * s), '', 12, '#9a9a9a').setOrigin(0.5, 0);
        fitFontSize(status, 12 * s, maxW, 10);
        root.add([ring, ringLine, icon, name, status]);
        this.mapContent.add(root);
        const node = { kind: 'boss', boss, root, ring, ringLine, icon, name, status, pulse: null, ringPulse: null, _state: null, _r: r };
        // Кружок перехватывает тап у dim (mapCam выше в hit-test) — драг стартуем
        // и с него, иначе жест, начатый на кружке, не скроллит
        ring.on('pointerdown', (p) => this.startMapDrag(p));
        ring.on('pointerup', () => {
            if (this._mapDragging) return;
            // Ключ состояния включает рекорд («available|45») — сравниваем префикс
            if (!node._state || !node._state.startsWith('available')) return;
            this._onBossNodeTap(boss.id);
        });
        return node;
    }

    _onBossNodeTap(bossId) {
        if (this.registry.get('bossActive')) return;
        this.closeMap();
        // registry 'blockLocked' обновляется в refreshUi следующего кадра — пересчитываем
        // сразу, иначе guard startBossFight увидит устаревший lock от открытой карты
        this.updateBlockLock();
        const gs = this.scene.get('GameScene');
        if (gs) gs.startBossFight(bossId);
    }

    refreshMapNodes() {
        if (!this.mapNodes) return;
        let changed = false;
        for (const node of this.mapNodes) {
            if (node.kind === 'tier') {
                const key = gameState.tier > node.tier ? 'passed'
                    : gameState.tier === node.tier ? 'current' : 'future';
                if (node._state === key) continue;
                node._state = key;
                changed = true;
                this._drawMapRing(node, key === 'passed' ? 0x6a6a6a : key === 'future' ? 0x3a3d40 : 0xffd75e);
                node.icon.setTint(key === 'passed' ? 0x909090 : key === 'future' ? 0x505050 : 0xffffff);
                node.name.setColor(key === 'passed' ? '#9a9a9a' : key === 'future' ? '#6a6a6a' : '#ffffff');
                if (key === 'current' && !node.pulse) {
                    node.pulse = this.tweens.add({ targets: node.root, alpha: { from: 1, to: 0.55 }, duration: 500, yoyo: true, repeat: -1 });
                } else if (key !== 'current' && node.pulse) {
                    node.pulse.stop();
                    node.pulse = null;
                    node.root.setAlpha(1);
                }
            } else {
                const b = node.boss;
                const defeated = !!gameState.bossesDefeated[b.id];
                // Рекорд в ключе диффа: новый рекорд перерисовывает подпись и при
                // неизменном статусе «побеждён»
                const rec = getBossRecord(b.id);
                const recTxt = rec ? ` · ${Math.floor(rec / 60)}:${String(rec % 60).padStart(2, '0')}` : '';
                const key = `${defeated ? 'defeated' : gameState.tier >= b.tier ? 'available' : 'locked'}|${rec ?? 'x'}`;
                if (node._state === key) continue;
                node._state = key;
                changed = true;
                if (key.startsWith('defeated')) {
                    node.status.setText(`побеждён${recTxt}`).setColor('#7ee787');
                } else if (key.startsWith('available')) {
                    node.status.setText(`Сразиться!${recTxt}`).setColor('#ffd75e');
                } else {
                    node.status.setText(`нужен: шахта ${b.tier + 1}`).setColor('#9a9a9a');
                }
                const ringColor = key.startsWith('defeated') ? 0x7ee787 : key.startsWith('available') ? 0xffd75e : 0x6a6a6a;
                this._drawMapRing(node, ringColor);
                node.icon.setTint(key.startsWith('locked') ? 0x505050 : 0xffffff);
                node.name.setColor(key.startsWith('locked') ? '#6a6a6a' : '#ffffff');
                if (key.startsWith('available') && !node.pulse) {
                    node.pulse = this.tweens.add({ targets: node.status, alpha: { from: 1, to: 0.45 }, duration: 450, yoyo: true, repeat: -1 });
                    node.ringPulse = this.tweens.add({ targets: node.ringLine, alpha: { from: 1, to: 0.45 }, duration: 450, yoyo: true, repeat: -1 });
                } else if (!key.startsWith('available') && node.pulse) {
                    node.pulse.stop();
                    node.pulse = null;
                    node.status.setAlpha(1);
                    if (node.ringPulse) {
                        node.ringPulse.stop();
                        node.ringPulse = null;
                        node.ringLine.setAlpha(1);
                    }
                }
            }
        }
        if (changed) this._redrawMapTrail();
    }

    // Кружок узла: тёмная заливка (ring) + цветная обводка отдельным Graphics
    // (ringLine — по ней пульсирует доступный босс), перерисовка только при
    // смене состояния — вызовы из refreshMapNodes по диффу
    _drawMapRing(node, color) {
        node.ring.clear();
        node.ring.fillStyle(0x2a2d31, 1);
        node.ring.fillCircle(0, 0, node._r);
        node.ringLine.clear();
        node.ringLine.lineStyle(Math.max(2, Math.round(3 * Math.min(this._adaptiveScale || 1, 1.6))), color, 1);
        node.ringLine.strokeCircle(0, 0, node._r);
        node._ringColor = color;
    }

    // Тропа между последовательными кружками: пунктир 6/6 по оси колонки
    // (от подписи узла до шеврона у вершины следующего кружка). Пройденные
    // отрезки — золото, будущие — тусклые. Перерисовка при смене статусов узлов.
    _redrawMapTrail() {
        if (!this.mapTrail || !this.mapNodes || this.mapNodes.length < 2) return;
        const g = this.mapTrail;
        g.clear();
        const s = this._adaptiveScale || 1;
        const cx = this._nodeCX;
        this._trailCX = cx;
        const curIdx = this._findNodeIndex(gameState.tier);
        const dashW = Math.max(2, Math.round(2 * Math.min(s, 1.6)));
        for (let k = 0; k < this.mapNodes.length - 1; k++) {
            const a = this.mapNodes[k];
            const b = this.mapNodes[k + 1];
            const passed = curIdx >= k + 1;
            const color = passed ? 0xc9a55a : 0x8a7a55;
            const alpha = passed ? 0.9 : 0.35;
            const lbl = a.kind === 'tier' ? a.name : a.status;
            const from = a.root.y + lbl.y + lbl.height + Math.round(4 * s);
            const to = b.root.y - Math.round(9 * s);
            g.fillStyle(color, alpha);
            for (let y = from; y + 6 <= to; y += 12) {
                g.fillRect(cx - dashW / 2, y, dashW, 6);
            }
            g.fillTriangle(cx - Math.round(5 * s), to, cx + Math.round(5 * s), to, cx, b.root.y + Math.round(2 * s));
        }
    }

    _findNodeIndex(tier) {
        return this.mapNodes.findIndex((n) => n.kind === 'tier' && n.tier === tier);
    }

    // Y центра кружка узла (root.y — верх контейнера, кружок сдвинут на _r вниз):
    // скролл-цель и шахтёр должны смотреть на центр, а не на макушку кружка
    _mapNodeY(idx) {
        const s = this._adaptiveScale || 1;
        const node = this.mapNodes && this.mapNodes[idx];
        const r = node ? node._r : Math.round(MAP_R_TIER * s);
        return Math.round((MAP_HEAD + idx * MAP_NODE_H) * s) + r;
    }

    _mapScrollTarget(idx) {
        return Phaser.Math.Clamp(this._mapNodeY(idx) - this._mapView.h / 2, 0, this._mapMaxScroll);
    }

    _placeMapMiner(idx) {
        this.placeIcon(this.mapMiner, 'miner_portrait', this._nodeCX + Math.round(-150 * (this._adaptiveScale || 1)), this._mapNodeY(idx), 36);
        this.mapMiner.setVisible(true);
    }

    openMap({ animate = false } = {}) {
        if (this._mapOpen) return;
        if (this.registry.get('blockLocked')) return;
        this._mapOpen = true;
        this.mapDim.setVisible(true);
        this.mapRoot.setVisible(true);
        this.mapCam.setVisible(true);
        this.refreshMapNodes();
        const curIdx = this._findNodeIndex(gameState.tier);
        if (animate) {
            const prevIdx = Math.max(0, this._findNodeIndex(Math.max(0, gameState.tier - 1)));
            const fromScroll = this._mapScrollTarget(prevIdx);
            const toScroll = this._mapScrollTarget(curIdx);
            const fromY = this._mapNodeY(prevIdx);
            const toY = this._mapNodeY(curIdx);
            this.mapCam.scrollY = fromScroll;
            this._placeMapMiner(prevIdx);
            const proxy = { p: 0 };
            this._mapAnim = this.tweens.add({
                targets: proxy,
                p: 1,
                duration: 1400,
                ease: 'Sine.easeInOut',
                onUpdate: () => {
                    this.mapCam.scrollY = fromScroll + (toScroll - fromScroll) * proxy.p;
                    this.mapMiner.y = fromY + (toY - fromY) * proxy.p;
                },
                onComplete: () => {
                    this._mapAnim = null;
                    this._placeMapMiner(curIdx);
                    this._arriveFx(gameState.tier);
                }
            });
        } else {
            this.mapCam.scrollY = this._mapScrollTarget(curIdx);
            this._placeMapMiner(curIdx);
        }
    }

    skipMapAnim() {
        if (!this._mapAnim) return;
        this._mapAnim.stop();
        this._mapAnim = null;
        const curIdx = this._findNodeIndex(gameState.tier);
        this.mapCam.scrollY = this._mapScrollTarget(curIdx);
        this._placeMapMiner(curIdx);
        this._arriveFx(gameState.tier);
    }

    _arriveFx(tierIndex) {
        this.mapCam.flash(250, 255, 255, 255);
        const banner = makeLabel(this, 0, -this._mapHalfH + 118, `Уровень ${tierIndex + 1}: ${TIERS[tierIndex].name}!`, 22, '#ffe9b0', { align: 'center' }).setOrigin(0.5);
        banner.setAlpha(0);
        this.mapRoot.add(banner);
        this.tweens.add({
            targets: banner,
            alpha: { from: 0, to: 1 },
            duration: 250,
            yoyo: true,
            hold: 1100,
            onComplete: () => banner.destroy()
        });
    }

    closeMap() {
        if (this._mapAnim) {
            this._mapAnim.stop();
            this._mapAnim = null;
        }
        this.mapDim.setVisible(false);
        this.mapRoot.setVisible(false);
        this.mapCam.setVisible(false);
        this._mapOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под картой
    }

    setupMapDrag() {
        const inMapZone = (p) => {
            const v = this._mapView;
            return p.x >= v.x - 6 && p.x <= v.x + v.w + 6
                && p.y >= v.y - 6 && p.y <= v.y + v.h + 6;
        };
        // Вызывается из хендлеров dim и слотов боссов (dim гасит scene-level down).
        // Тап/драг по слоту во время анимации спуска тоже завершает её (skip)
        this.startMapDrag = (p) => {
            if (this._mapAnim) this.skipMapAnim();
            if (!this._mapOpen || !inMapZone(p)) return;
            this._mapDragId = p.id;
            this._mapDragStartY = p.y;
            this._mapDragStartScroll = this.mapCam.scrollY;
            this._mapDragging = false;
        };
        this.input.on('pointermove', (p) => {
            if (p.id !== this._mapDragId || !p.isDown) return;
            const delta = this._mapDragStartY - p.y;
            if (!this._mapDragging && Math.abs(delta) > 6) this._mapDragging = true;
            if (this._mapDragging) {
                this.mapCam.scrollY = Phaser.Math.Clamp(this._mapDragStartScroll + delta, 0, this._mapMaxScroll);
            }
        });
        const endDrag = (p) => {
            if (p && p.id !== this._mapDragId) return;
            this._mapDragId = null;
            this.time.delayedCall(0, () => { this._mapDragging = false; });
        };
        this.input.on('pointerup', endDrag);
        this.input.on('pointerupoutside', endDrag);
    }

    // ---------- Мастерская (каркас П5) ----------

    buildCraftScreen() {
        this.craftDim = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6)
            .setDepth(40).setVisible(false).setInteractive();
        // stopPropagation dim'а гасит scene-level pointerdown — старт драга здесь
        this.craftDim.on('pointerdown', (pointer, lx, ly, event) => {
            this.startCraftDrag(pointer);
            event.stopPropagation();
        });

        this.craftRoot = this.add.container(640, 360).setDepth(41).setVisible(false);
        this.craftPanel = addImgC(this, 0, 0, 'modal_panel_metal', 560, 600);
        this.craftTitle = makeLabel(this, 0, -232, 'Мастерская', 30, '#ffe9b0').setOrigin(0.5);
        this.craftClose = addImgC(this, 220, -228, 'close_button_square', 44, 44);
        this.craftClose.setInteractive(new Phaser.Geom.Rectangle(0, 0, 196, 191), Phaser.Geom.Rectangle.Contains);
        this.craftClose.on('pointerdown', () => this.closeCraft());
        this.craftRoot.add([this.craftPanel, this.craftTitle, this.craftClose]);

        // Шапка (фиксированная, не скроллится): 5 компонентов — иконка + счётчик.
        // Дети craftRoot рендерит только main (craftCam/mapCam проигнорировали
        // корень при создании) — отдельные ignore не нужны.
        this.buildCraftHeader();

        this.craftContent = this.add.container(0, 0).setDepth(42).setVisible(false);
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
    }

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
        const fSize = Math.max(11, Math.round(13 * Math.min(s, 1.35)));
        const compRowStartX = -(COMPONENTS.length * slotW) / 2;
        COMPONENTS.forEach((def, i) => {
            const sx = compRowStartX + i * slotW;
            const icon = this.add.image(0, 0, def.icon);
            this.placeIcon(icon, def.icon, sx + Math.round(11 * k), 0, iconSize);
            const t = makeLabel(this, sx + Math.round(26 * k), 0, '0', fSize, '#e8e8e8').setOrigin(0, 0.5);
            this.craftHeader.add([icon, t]);
            this.craftCompRow.push({ id: def.id, text: t });
        });
    }

    // Наполнение мастерской: три секции рядами h84 на upgrade_row_card_1 (шаг 90).
    // Пересобирается только при смене ширины вьюпорта (портрет/ландшафт);
    // текущие значения обновляет refreshCraftUi по диффу (паттерн _buffLineText).
    buildCraftContent() {
        const w = this._craftView.w;
        const s = this._adaptiveScale || 1;
        const f = w / 835;
        const iconCX = Math.round(118 * f);
        const textX = Math.round(186 * f) + 34;
        const iconSize = Math.round(40 * Math.min(s, 1.6));
        const rowH = Math.round(84 * s);
        const step = rowH + 6;
        const btnW = Phaser.Math.Clamp(Math.round(84 * s), 64, 120);
        const btnH = Phaser.Math.Clamp(Math.round(32 * Math.min(s, 1.5)), 32, 48);
        const btnCX = w - 12 - btnW / 2;
        const btnCY = Math.round(42 * s);
        const buyCY = Math.round(rowH * 0.28);
        const actCY = Math.round(rowH * 0.72);
        const textMaxW = btnCX - btnW / 2 - 8 - textX;
        const nameSize = Math.max(9, Math.round(14 * s));
        const subSize = Math.max(9, Math.round(12 * s));
        const cellW = Math.floor((w - 10) / 2);

        this.craftContent.removeAll(true);
        this.craftItemRows = {};
        this.craftRecipeRows = {};
        this.craftArtCells = {};
        let y = Math.round(8 * s);

        const header = (title) => {
            const t = makeLabel(this, 2, y, title, Math.max(11, Math.round(16 * s)), '#ffe9b0').setOrigin(0, 0);
            this.craftContent.add(t);
        };

        header('Активируемые');
        y += Math.round(36 * s);
        for (const def of ITEMS) {
            const rc = this.add.container(0, y);
            const card = addImg(this, 0, 0, 'upgrade_row_card_1', w, rowH);
            const icon = this.add.image(0, 0, def.id);
            this.placeIcon(icon, def.id, iconCX, btnCY, iconSize);
            const name = makeLabel(this, textX, Math.round(8 * s), def.name, nameSize, '#ffffff').setOrigin(0, 0);
            fitFontSize(name, nameSize, textMaxW, 9);
            const sub = makeLabel(this, textX, Math.round(30 * s), `эффект: ${def.desc}`, subSize, '#c8c8c8').setOrigin(0, 0);
            fitFontSize(sub, subSize, textMaxW, 9);
            const hint = makeLabel(this, textX, Math.round(52 * s), '', subSize, '#ffd75e').setOrigin(0, 0);
            const btn = this.add.image(btnCX, actCY, 'buy_button_normal').setDisplaySize(btnW, btnH);
            btn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
            const btnText = makeLabel(this, btnCX, actCY, 'Активировать', subSize, '#ffffff').setOrigin(0.5);
            fitFontSize(btnText, subSize, btnW - 12, 8);
            const buyBtn = this.add.image(btnCX, buyCY, 'buy_button_normal').setDisplaySize(btnW, btnH);
            buyBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
            const buyBtnText = makeLabel(this, btnCX, buyCY, '', subSize, '#ffffff').setOrigin(0.5);
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
            this.craftItemRows[def.id] = { def, rc, icon, name, sub, hint, btn, btnText, buyBtn, buyBtnText, _key: null, _hintKey: null, _err: null, _errUntil: 0, _hintSize: subSize, _hintMaxW: textMaxW, _buySize: subSize, _buyMaxW: btnW - 12 };
            y += step;
        }

        y += Math.round(14 * s);
        header('Рецепты');
        const warn = makeLabel(this, w - 2, y + 3, 'крафт нельзя отменить', Math.max(9, Math.round(11 * s)), '#e09090').setOrigin(1, 0);
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
            const name = makeLabel(this, textX, Math.round(8 * s), resultDef.name, Math.max(9, Math.round(13 * s)), '#ffffff').setOrigin(0, 0);
            fitFontSize(name, Math.round(13 * s), textMaxW, 9);
            const desc = makeLabel(this, textX, Math.round(26 * s), `Получишь: ${resultDef.desc}`, subSize, '#9ad29a').setOrigin(0, 0);
            fitFontSize(desc, subSize, textMaxW, 9);
            const needLbl = makeLabel(this, textX, Math.round(44 * s), 'Нужно:', Math.max(9, Math.round(11 * s)), '#c8c8c8').setOrigin(0, 0.5);
            const costPairs = [];
            const pairNodes = [];
            const pairIcon = Math.round(16 * Math.min(s, 1.5));
            const pairFont = Math.max(9, Math.round(12 * s));
            let cx = textX + needLbl.width + Math.round(6 * s);
            for (const compId of Object.keys(recipe.cost)) {
                const compDef = COMPONENTS.find((c) => c.id === compId);
                const cIcon = this.add.image(0, 0, compDef.icon);
                this.placeIcon(cIcon, compDef.icon, cx + Math.round(8 * s), Math.round(44 * s), pairIcon);
                const cText = makeLabel(this, cx + Math.round(20 * s), Math.round(44 * s), String(recipe.cost[compId]), pairFont, '#ffd75e').setOrigin(0, 0.5);
                pairNodes.push(cIcon, cText);
                costPairs.push({ id: compId, text: cText });
                cx += Math.round(20 * s) + cText.width + Math.round(12 * s);
            }
            const footMaxW = btnCX - btnW / 2 - 8 - textX;
            const footSize = Math.max(9, Math.round(11 * s));
            const srcTxt = recipe.result.kind === 'artifact'
                ? 'крафт'
                : `дроп: ${[...new Set(Object.keys(recipe.cost).map((compId) => (BOSSES.find((b) => b.drops[compId]) || {}).name).filter(Boolean))].join(', ')}`;
            const status = makeLabel(this, textX, Math.round(62 * s), '', footSize, '#e09090').setOrigin(0, 0);
            const src = makeLabel(this, textX, Math.round(62 * s), srcTxt, footSize, '#9a9a9a').setOrigin(0, 0);
            fitFontSize(src, footSize, footMaxW, 9);
            const btn = this.add.image(btnCX, btnCY, 'buy_button_normal').setDisplaySize(btnW, btnH);
            btn.setInteractive(new Phaser.Geom.Rectangle(0, 0, 267, 133), Phaser.Geom.Rectangle.Contains);
            const label = recipe.craftMs === 0 ? 'Создать' : `Крафт ${Math.round(recipe.craftMs / 60000)} мин`;
            const btnText = makeLabel(this, btnCX, btnCY, label, subSize, '#ffffff').setOrigin(0.5);
            fitFontSize(btnText, subSize, btnW - 12, 8);
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
            this.craftRecipeRows[recipe.id] = { recipe, rc, icon, name, desc, needLbl, costPairs, status, src, btn, btnText, label, resultDef, _key: null, _footTxt: null, _btnSize: subSize, _btnMaxW: btnW - 12, _footSize: footSize, _footMaxW: footMaxW };
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
            const iconX = Math.round(30 * Math.min(s, 1.4));
            const icon = this.add.image(0, 0, def.id);
            this.placeIcon(icon, def.id, iconX, Math.round(42 * Math.min(s, 1.4)), Math.round(40 * Math.min(s, 1.4)));
            const nameX = Math.round(58 * Math.min(s, 1.4));
            const name = makeLabel(this, nameX, Math.round(8 * s), def.name, Math.max(9, Math.round(12 * s)), '#ffd75e').setOrigin(0, 0);
            fitFontSize(name, Math.round(12 * s), cellW - nameX - 8, 9);
            const line = makeLabel(this, nameX, Math.round(30 * s), '', Math.max(9, Math.round(12 * s)), '#9ad29a', { wordWrap: { width: cellW - nameX - 14 } }).setOrigin(0, 0);
            rc.add([card, icon, name, line]);
            this.craftContent.add(rc);
            card.setInteractive(new Phaser.Geom.Rectangle(0, 0, 835, 218), Phaser.Geom.Rectangle.Contains);
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
    }

    _mmss(msLeft) {
        const sec = Math.max(0, Math.ceil(msLeft / 1000));
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    }

    // Активация предмета из мастерской: useItem(id,false); при отказе — красная
    // строка-подсказка в ряду на 2с (R5: флоаты под модалкой нечитаемы).
    activateItemRow(def) {
        if (!useItem(def.id, false)) {
            const stock = (gameState.items[def.id] || 0) <= 0;
            this.setItemRowError(def, stock ? 'нет предмета' : (def.bossUse ? 'только в бою' : 'баф ещё активен'));
        }
        this.refreshUi();
    }

    setItemRowError(def, msg) {
        const row = this.craftItemRows[def.id];
        if (!row) return;
        row._err = msg;
        row._errUntil = Date.now() + 2000;
    }

    // Дифф-обновление мастерской (каждый кадр при открытом экране): счётчики
    // шапки, тексты/кнопки/цвета рядов. Перерисовка только при смене состояния.
    refreshCraftUi() {
        for (const c of this.craftCompRow) {
            const s = fmt(gameState.components[c.id] || 0);
            if (c.text.text !== s) c.text.setText(s);
        }
        const bossActive = !!this.registry.get('bossActive');
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
            let hintColor = '#ffd75e';
            if (errActive) {
                hintTxt = row._err;
                hintColor = '#e09090';
            } else if (active) {
                hintTxt = `в запасе: ${stock} · ${eff.bossMult ? `бомба ${this._mmss(buffLeft)}` : eff.veinForce ? `жила ${this._mmss(buffLeft)}` : `x${slotMult} ${this._mmss(buffLeft)}`}`;
            } else if (stock <= 0) {
                hintTxt = 'нет предмета';
                hintColor = '#e09090';
            } else if (def.bossUse) {
                hintTxt = `в запасе: ${stock} · только в бою`;
                hintColor = '#e09090';
            }
            const hintKey = `${hintTxt}|${hintColor}`;
            if (hintKey !== row._hintKey) {
                row._hintKey = hintKey;
                row.hint.setText(hintTxt).setColor(hintColor);
                fitFontSize(row.hint, row._hintSize, row._hintMaxW, 9);
            }
            const price = getItemPrice(id);
            const buyBlocked = gameState.ore < price || stock >= def.stackMax;
            const buyLbl = `Купить ${fmt(price)}`;
            const key = `${stock}|${blocked}|${buyLbl}|${buyBlocked}`;
            if (key !== row._key) {
                row._key = key;
                row.btn.setTexture(blocked ? 'buy_button_disabled_gray' : 'buy_button_normal');
                row.btnText.setColor(blocked ? '#b0b0b0' : '#ffffff');
                row.buyBtn.setTexture(buyBlocked ? 'buy_button_disabled_gray' : 'buy_button_normal');
                row.buyBtnText.setText(buyLbl).setColor(buyBlocked ? '#b0b0b0' : '#ffffff');
                fitFontSize(row.buyBtnText, row._buySize, row._buyMaxW, 8);
            }
        }

        for (const id of Object.keys(this.craftRecipeRows)) {
            const row = this.craftRecipeRows[id];
            const busy = !!gameState.crafting;
            const mine = busy && gameState.crafting.recipeId === id;
            const ready = mine && canClaimCraft();
            const owned = row.recipe.result.kind === 'artifact' && gameState.artifacts.includes(row.recipe.result.id);
            let btnText = row.label;
            let texture = 'buy_button_normal';
            let color = '#ffffff';
            let statusTxt = '';
            if (mine) {
                if (ready) {
                    btnText = 'Забрать';
                } else {
                    btnText = this._mmss(gameState.crafting.endsAt - now);
                    texture = 'buy_button_disabled_gray';
                    color = '#b0b0b0';
                }
            } else if (owned || busy || !canCraft(id)) {
                texture = 'buy_button_disabled_gray';
                color = '#b0b0b0';
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
                fitFontSize(row.btnText, row._btnSize, row._btnMaxW, 8);
                row.btn.setTexture(texture);
                if (statusTxt !== row._footTxt) {
                    row._footTxt = statusTxt;
                    row.status.setText(statusTxt).setVisible(statusTxt !== '');
                    if (statusTxt) fitFontSize(row.status, row._footSize, row._footMaxW, 9);
                    row.src.setVisible(statusTxt === '');
                }
                for (const pair of row.costPairs) {
                    pair.text.setColor((gameState.components[pair.id] || 0) >= row.recipe.cost[pair.id] ? '#ffd75e' : '#f0638c');
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
                lineColor = '#9ad29a';
            } else if (hintActive) {
                lineTxt = cell._hintText;
                lineColor = '#ffd75e';
            } else {
                const boss = BOSSES.find((b) => b.id === cell.def.source);
                lineTxt = boss ? `Босс: ${boss.name}` : 'Крафт';
                lineColor = '#9a9a9a';
            }
            if (owned !== cell._owned || lineTxt !== cell._lineTxt || lineColor !== cell._lineColor) {
                cell._owned = owned;
                cell._lineTxt = lineTxt;
                cell._lineColor = lineColor;
                cell.rc.setAlpha(owned ? 1 : 0.25);
                cell.line.setText(lineTxt).setColor(lineColor);
            }
        }
    }

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
    }

    openCraft() {
        if (this._craftOpen) return;
        if (this.registry.get('blockLocked')) return;
        this._craftOpen = true;
        this.craftDim.setVisible(true);
        this.craftRoot.setVisible(true);
        this.craftCam.setVisible(true);
        this.refreshUi();
    }

    closeCraft() {
        this.craftDim.setVisible(false);
        this.craftRoot.setVisible(false);
        this.craftCam.setVisible(false);
        this._craftOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под мастерской
    }

    // ---------- Единая блокировка полноэкранных состояний ----------

    // Единственный владелец registry 'blockLocked' и видимости listContent:
    // пересчёт каждый кадр из refreshUi, действия — только при изменении.
    // bossActive в формуле НЕ участвует: бой не держит блокировку — карта/крафт/
    // настройки открываются поверх боя (бой продолжается робо-рукой и пассивом),
    // заблокированы только спуск (guard в unlockBtn) и престиж/сброс (tryPrestige/tryReset).
    updateBlockLock() {
        const locked = this._settingsOpen || this._offlineOpen || this._dailyOpen
            || this._mapOpen || this._craftOpen || this._bossRewardOpen;
        if (locked !== this._blockLocked) {
            this._blockLocked = locked;
            this.registry.set('blockLocked', locked);
        }
        const bossNow = !!this.registry.get('bossActive');
        // В бою панель показывает «Снаряжение» вместо списка улучшений
        this.listContent.setVisible(!locked && !bossNow);
        if (this.gearContent) {
            this.gearContent.setVisible(bossNow && !locked);
            this.refreshGearPanel();
        }
        if (this.mapRoot) {
            this.mapRoot.setVisible(this._mapOpen);
            this.mapContent.setVisible(this._mapOpen);
        }
        if (this.craftRoot) {
            this.craftRoot.setVisible(this._craftOpen);
            this.craftContent.setVisible(this._craftOpen);
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
        // Бафы предметов (мастерская): множитель добычи, бомба (бой), стимулятор жилы
        if (Date.now() < gameState.miningBuffUntil) parts.push(`x${gameState.miningBuffMult} ${left(gameState.miningBuffUntil)}`);
        if (Date.now() < gameState.bossBuffUntil) parts.push(`бомба ${left(gameState.bossBuffUntil)}`);
        if (Date.now() < gameState.itemVeinUntil) parts.push(`жила ${left(gameState.itemVeinUntil)}`);
        const text = parts.join(' · ');
        if (text !== this._buffLineText) {
            this._buffLineText = text;
            this.buffLine.setText(text);
        }
    }

    // ---------- Обновление UI (дифф-опрос каждый кадр) ----------

    refreshUi() {
        this.updateBlockLock();
        this.refreshMapNodes();
        if (this._craftOpen) this.refreshCraftUi();
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
        // В портрете ставка ужинается до левого края «Настроек» (кнопка растёт
        // влево от btnX), иначе длинная ставка заходит под неё. Ключ = текст|x:
        // сдвиг строки (имя руды выросло) пересчитывает ужин.
        if (this.L.portrait) {
            const gpsKey = `${rate}|${Math.round(this.gpsText.x)}`;
            if (gpsKey !== this._gpsFitKey) {
                this._gpsFitKey = gpsKey;
                fitFontSize(this.gpsText, this.L.hud.gpsSize, this.settingsBtn.x - this.settingsBtn.displayWidth / 2 - 8 - this.gpsText.x, 11);
            }
        }
        // «клик» = фактическая добыча обычного клика: базовый урон + синергия
        // (% от пассива) — совпадает с всплывающими цифрами без крита/жилы.
        // Ландшафт: в одну строку за ставкой; портрет: второй строкой под ставкой.
        // x выставляется ДО ужина — предел считается от фактического левого края
        // строки, ключ = текст|x: пересчёт и при смене текста, и при сдвиге.
        // Текст звёзд обновляется до ужина статов (ширина звёзд влияет на предел
        // только в портрете — там звёзды на панели; в ландшафте звёзды под баром)
        this.starsText.setText(gameState.stars > 0 ? `★ ${gameState.stars} (x${getPrestigeMult().toFixed(1)})` : '');
        const statsTxt = `клик: ${fmt(getClickDamage() + getSynergyGain())} · крит: ${Math.round(getCritChance() * 100)}%`;
        this.statsLine.x = this.L.portrait ? this.gpsText.x : this.gpsText.x + this.gpsText.width + 26;
        const statsKey = `${statsTxt}|${Math.round(this.statsLine.x)}`;
        if (statsKey !== this._statsFitKey) {
            this._statsFitKey = statsKey;
            this.statsLine.setText(statsTxt);
            if (this.L.portrait) {
                fitFontSize(this.statsLine, Math.round(14 * this._adaptiveScale), this.settingsBtn.x - this.settingsBtn.displayWidth / 2 - 8 - this.statsLine.x, 11);
            } else {
                // Ландшафт: ужин до левого края кнопки «Карта» (длинные статы
                // «клик: 2712 · крит: 31%» наезжали на звёзды в баре)
                fitFontSize(this.statsLine, this.L.hud.statsSize, this.L.hud.mapBtn.x - 8 - this.statsLine.x, 10);
            }
        }
        this.updateBuffLine();
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
        // В бою спуск скрыт целиком (заблокирован; серая кнопка в бою вводила
        // в заблуждение и наезжала на подсказку слотов босса)
        const hideUnlock = !!this.registry.get('bossActive');
        if (next) {
            this.unlockBtn.setVisible(!hideUnlock);
            this.unlockText.setVisible(!hideUnlock);
            this.unlockText.setText(`Спуск: ${next.name} — ${fmt(getNextUnlockPrice())} ${tier.gen || tier.name.toLowerCase()}`);
            const bossLocked = !!this.registry.get('bossActive');
            if (canUnlockTier() && !bossLocked) {
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
            this.hint.setVisible(!hideUnlock);
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
            const bossLocked = !!this.registry.get('bossActive');
            if (canPrestige()) {
                this.prestigeInfo.setText(`За текущий забег: +${gain} ★ (постоянно +${gain * 10}% к доходу)\nСброс: руда, уровень шахты и улучшения обнулятся.`);
                this.prestigeBtn.setTexture(bossLocked ? 'buy_button_disabled_gray' : 'buy_button_normal');
                this.prestigeText.setColor(bossLocked ? '#b0b0b0' : '#ffffff');
            } else {
                const have = gameState.tierEarned[DIAMOND_INDEX];
                this.prestigeInfo.setText(`Для rebirth нужно добыть ${fmt(PRESTIGE_REQUIREMENT)} алмазов за забег.\nУ вас: ${fmt(have)} (${Math.floor(have / PRESTIGE_REQUIREMENT * 100)}%).`);
                this.prestigeBtn.setTexture('buy_button_disabled_gray');
                this.prestigeText.setColor('#b0b0b0');
            }
            this.resetText.setColor(bossLocked ? '#b0b0b0' : '#ffffff');
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
        // (и из скролл-камер карты/крафта — они создаются позже ignore-списков)
        const tutLayers = [this.tutDim, this.tutRing, this.tutArrow, this.tutBubble, this.tutText, this.tutFinal, this.tutBtn, this.tutBtnLbl];
        this.listCam.ignore(tutLayers);
        if (this.mapCam) this.mapCam.ignore(tutLayers);
        if (this.craftCam) this.craftCam.ignore(tutLayers);
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
