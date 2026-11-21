import Phaser from 'phaser';
import { fmt, getUpgradeCost, getBulkCost, getAffordableBulk, gameState } from '../state.js';
import { computeLayout } from '../layout.js';
import { VIEWPORT } from './shared/listGeometry.js';
import { EVENTS, REG } from './shared/theme.js';
import { hudMethods } from './phaser/hud.js';
import { panelMethods } from './phaser/upgrades.js';
import { gearMethods } from './phaser/gear.js';
import { layoutMethods } from './phaser/layout.js';
import { settingsModalMethods } from './phaser/settingsModal.js';
import { statusModalsMethods } from './phaser/statusModals.js';
import { mapScreenMethods } from './phaser/mapScreen.js';
import { tutorialMethods } from './phaser/tutorial.js';
import { isPhaserForm, upgradesOnDom } from './shared/formsFlag.js';

// UIScene — оболочка интерфейса: владеет жизненным циклом, глобальной блокировкой
// (updateBlockLock) и перерисовкой (refreshUi). Реализация разложена по фичам
// (src/ui/phaser/*): каждый модуль — набор методов одной подсистемы, который
// подмешивается в прототип сцены ниже. Внешний контракт сцены не менялся.
export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this.scrollPos = 0;
        this.maxScroll = 0;
        this.activeTab = 'equipment'; // вкладка панели улучшений
        this.buyAmount = 1; // мультипокупка: 1 / 10 / 100 / 'max'
        // Полноэкранные состояния: любой может быть открыт одновременно, блокировка
        // (registry 'blockLocked') снимается только после закрытия ПОСЛЕДНЕГО.
        // Единый пересчёт — updateBlockLock() из refreshUi каждый кадр по диффу.
        this._settingsOpen = false;
        this._offlineOpen = false;
        this._dailyOpen = false;
        this._mapOpen = false; // экран карты шахты
        this._craftOpen = false; // экран мастерской (каркас П5)
        this._bossRewardOpen = false; // окно награды босса (П4)
        this._playerDownOpen = false; // окно вырубления шахтёра (смерть в бою)
        this._blockLocked = null; // кеш updateBlockLock: registry 'blockLocked'
        this._adaptiveScale = 1; // портретный масштаб кеглей (applyLayout)
        this._rowsBuiltS = 1;
        this._craftRowsS = 1;
        this._mapS = 1;
        this._headerS = 1;
        this._pendingDaily = null; // награда ждёт, пока не закроются другие модалки
        this._tutorialPending = false; // обучение ждёт закрытия окна дневной награды
        this._tutSuppressed = false; // учебные слои погашены модалкой/боем (updateBlockLock)
        this._panelHidden = false; // портретная панель скрыта под оверлеем (applyPanelVisibility)
        this._iconMetrics = {}; // кеш метрик иконок (см. iconMetrics)
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
        this.buildBossRewardModal();
        this.buildPlayerDownModal();
        this.setupListCamera();
        this.setupListDrag();
        this.applyLayout();

        // Секция «Снаряжение» обрезается geometry-маской по зоне панели: ряды
        // не должны «проваливаться» за панель без клиппинга (скриншот игрока).
        // Маска вместо отдельной камеры: надёжно рендерится main-камерой,
        // перерисовывается в applyLayout. Три боевых предмета влезают без скролла.
        this.gearMaskG = this.make.graphics({ add: false });
        this.gearMaskG.fillStyle(0xffffff, 1);
        this.gearMaskG.fillRect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h);
        // Phaser 4: API — setMask (setGeometryMask нет); маску вешаем и на
        // контейнер, и на детей — маскирование контейнера в 4 не наследуется
        const gearMask = this.gearMaskG.createGeometryMask();
        this.gearContent.setMask(gearMask);
        this.gearContent.list.forEach((o) => o.setMask(gearMask));
        this._gearView = { ...VIEWPORT };

        // Смена ориентации/размера окна (main.js) — переставляем весь UI
        this.game.events.on(EVENTS.layoutChanged, () => this.applyLayout());

        this.input.on('wheel', (pointer, over, dx, dy) => {
            if (
                pointer.x >= VIEWPORT.x - 10 &&
                pointer.x <= VIEWPORT.x + VIEWPORT.w + 10 &&
                pointer.y >= VIEWPORT.y - 10 &&
                pointer.y <= VIEWPORT.y + VIEWPORT.h + 10
            ) {
                this.scrollPos = Phaser.Math.Clamp(this.scrollPos + dy * 0.5, 0, this.maxScroll);
                this.updateScroll();
            }
        });

        // Драг списка — setupListDrag (scene-level, работает по всей площади вьюпорта,
        // включая карточки: покупка на кнопках висит на pointerup с гасителем драга)

        this.game.events.on(EVENTS.uiRefresh, () => this.refreshUi());

        // Смена состояния боя: панель переключается на «Снаряжение» и в портрете
        // поднимается под блок босса (пересборка сетки — applyLayout)
        this.game.events.on(EVENTS.bossChanged, () => {
            this.applyLayout();
            this.refreshUi();
        });

        // Офлайн-модалка по событию: симуляция из DevPanel и реальный возврат
        // во вкладку идут по одному пути (registry.offlineInfo + offline-applied)
        this.game.events.on(EVENTS.offlineApplied, (info) => {
            if (this.offlineModal.visible) {
                return;
            }

            this.showOfflineModal(info);
        });

        // Награда за босса: ивент приходит после снятия bossActive — поверх
        // других модалок не вылезает
        this.game.events.on(EVENTS.bossDefeated, (reward) => this.showBossRewardModal(reward));
        // Шахтёр вырублен: принудительный откат — окно поверх карты/крафта
        this.game.events.on(EVENTS.playerDown, (info) => this.showPlayerDownModal(info));

        // Ежедневная награда: и путь загрузки (registry 'dailyInfo'), и DevPanel
        // («след. день» / «сброс серии») идут в одну очередь через 'daily-claimed'
        this.game.events.on(EVENTS.dailyClaimed, (info) => {
            this._pendingDaily = info;
            this.tryShowDailyModal();
        });
        if (this.registry.get(REG.dailyInfo)) {
            // после офлайн-модалки, если та тоже пришла при загрузке (delayedCall офлайна 400)
            this.time.delayedCall(900, () => {
                if (!this.registry.get(REG.dailyInfo)) {
                    return;
                }

                this._pendingDaily = this.registry.get(REG.dailyInfo);
                this.registry.set(REG.dailyInfo, null);
                this.tryShowDailyModal();
            });
        }

        // Порядок первого запуска: окно дневной награды показывается ПЕРЕД
        // обучением — иначе учебные подсказки стартовали сразу, а награда
        // вылезала поверх и перекрывала всю игру (скриншот игрока). Если награда
        // придёт — обучение откладывается до её закрытия.
        if (this.registry.get(REG.dailyInfo) || this._pendingDaily) {
            this._tutorialPending = true;
        } else {
            this.buildTutorial();
        }

        if (this.registry.get(REG.offlineInfo)) {
            this.time.delayedCall(400, () => this.showOfflineModal(this.registry.get(REG.offlineInfo)));
        }

        this.refreshUi();

        // Мастерская — DOM-слой (пилот закрыт, G3 = go). Контроллер грузится
        // отдельным чанком и монтируется один раз; openCraft() ждёт готовности.
        this._domCraftReady = import('./dom/craft.js')
            .then(({ createDomCraft }) => {
                this.domCraft = createDomCraft(this);
            })
            .catch((err) => {
                console.error('[craft:dom] не загрузился:', err);
            });

        // Настройки — DOM-форма фазы 2. Монтируем строго после мастерской: craft.js
        // собирает каркас через setHtml(#ui-root), иначе host модалки затирается.
        this._domSettingsReady = this._domCraftReady
            .then(() => import('./dom/settingsScreen.js'))
            .then(({ createDomSettings }) => {
                this.domSettings = createDomSettings(this);
            })
            .catch((err) => {
                console.error('[settings:dom] не загрузился:', err);
            });

        // Список улучшений — DOM-форма фазы 3: включена по умолчанию, откат — флаг
        // phaserForms=upgrades (upgradesOnDom). Спайк-флаг этапа 0 удалён (ревью 🟢-8).
        this._domUpgradesReady = this._domSettingsReady
            .then(() => import('./dom/upgradesPanel.js'))
            .then(({ createDomUpgrades }) => {
                if (!this.shouldMountDomUpgrades()) {
                    return;
                }

                this.domUpgrades = createDomUpgrades(this);
                this.syncDomUpgradesChrome();
            })
            .catch((err) => {
                console.error('[upgrades:dom] не загрузился:', err);
            });

        // Статус-модалки — DOM-форма фазы 3 (M2). Монтируются сразу после мастерской
        // (нужен только #ui-root), не дожидаясь настроек: бой может закончиться за
        // первые кадры, и окно награды не должно «успеть» на Phaser-путь.
        // Мост импортируем ДО создания контроллера: иначе между появлением
        // __DOM_STATUS и готовностью снимков остаётся окно, в котором фасад
        // уходит на Phaser-путь (найдено verify:settings-dom ST9).
        this._pendingStatusShows = [];
        this._statusMountFailed = false;
        this._flushStatusQueue = () => {
            const queue = this._pendingStatusShows;
            this._pendingStatusShows = [];
            for (const call of queue) {
                call();
            }

            this.tryShowDailyModal();
        };
        this._domStatusReady = this._domCraftReady
            .then(async () => {
                const [mod, bridge] = await Promise.all([import('./dom/statusModals.js'), import('./dom/bridge.js')]);
                this._statusSnap = {
                    offline: bridge.offlineSnapshot,
                    daily: bridge.dailySnapshot,
                    'boss-reward': bridge.bossRewardSnapshot,
                    'player-down': bridge.playerDownSnapshot
                };
                this.domStatus = mod.createDomStatusModals(this);
            })
            .then(() => this._flushStatusQueue())
            .catch((err) => {
                // Чанк не загрузился: очередь уходит на Phaser-путь (окно отката)
                this._statusMountFailed = true;
                console.error('[status:dom] не загрузился:', err);
                this._flushStatusQueue();
            });
    }

    // D3-развилка обучения: пока обучение не завершено, список и вкладки остаются
    // на Phaser (tutorial.js привязан к tabBtns, учебные слои — над listCam);
    // после tutorialDone DOM-панель становится основной.
    shouldMountDomUpgrades() {
        if (this.domUpgrades) {
            return false;
        }

        return upgradesOnDom() && gameState.tutorialDone === true;
    }

    // Вызывается из finishTutorial: обучение завершилось в этой сессии —
    // монтируем DOM-панель и снимаем Phaser-хром списка (D3).
    enableDomUpgrades() {
        if (this.domUpgrades || !upgradesOnDom() || !gameState.tutorialDone) {
            return;
        }

        import('./dom/upgradesPanel.js')
            .then(({ createDomUpgrades }) => {
                if (this.domUpgrades) {
                    return;
                }

                this.domUpgrades = createDomUpgrades(this);
                this.syncDomUpgradesChrome();
                this.refreshUi();
            })
            .catch((err) => {
                console.error('[upgrades:dom] не загрузился:', err);
            });
    }

    // D8: на DOM-пути Phaser-хром списка (вкладки, пакет, тир, подсказка, ряды)
    // не показывается — иначе двойной стек. Внешняя панель/звёзды/карта остаются.
    syncDomUpgradesChrome() {
        if (!this.domUpgrades) {
            return;
        }

        // Пока обучение не завершено (после «Полного сброса»), вкладки остаются
        // видимыми Phaser-объектами: tutorial.js подсвечивает именно их (D3).
        const tutorial = !gameState.tutorialDone;
        for (const t of this.tabBtns || []) {
            t.c.setVisible(tutorial);
        }

        for (const o of [this.amountC, this.viewportBg, this.tierLabel, this.hint]) {
            o?.setVisible(false);
        }

        this.listContent?.setVisible(false);
    }

    // ---------- Статус-модалки: фасад (D6) ----------
    // Публичные имена остаются прежними; путь выбирается флагом. Phaser-реализации —
    // *Phaser в phaser/statusModals.js; DOM — src/ui/dom/statusModals.js.
    statusOnDom() {
        return !isPhaserForm('status') && !!this.domStatus && !!this._statusSnap;
    }

    // Ранняя награда/офлайн до готовности DOM-контроллера: не уходим на Phaser
    // (другой экран и кегли), а откладываем вызов до монтирования.
    deferStatus(call) {
        if (isPhaserForm('status') || this.statusOnDom() || this._statusMountFailed) {
            return false;
        }

        this._pendingStatusShows.push(call);

        return true;
    }

    showOfflineModal(info) {
        if (this.deferStatus(() => this.showOfflineModal(info))) {
            return;
        }

        if (!this.statusOnDom()) {
            this.showOfflinePhaser(info);

            return;
        }

        this.registry.set(REG.offlineInfo, null);
        this.domStatus.show('offline', this._statusSnap.offline(info));
        this.updateBlockLock();
    }

    hideOfflineModal() {
        if (this.statusOnDom()) {
            this.domStatus.hide('offline');
        } else {
            this.hideOfflinePhaser();
        }

        this.tryShowDailyModal();
        this.updateBlockLock();
    }

    // Очередь награды: не поверх модалок/экранов/боя (перенесено из Phaser-метода,
    // чтобы путь не дублировал условия).
    tryShowDailyModal() {
        if (!this._pendingDaily) {
            return;
        }

        if (this.registry.get(REG.bossActive)) {
            return;
        }

        if (this._offlineOpen || this._settingsOpen || this._dailyOpen || this._playerDownOpen) {
            return;
        }

        if (this._mapOpen || (this.mapRoot && this.mapRoot.visible) || this._craftOpen || this._bossRewardOpen) {
            return;
        }

        const info = this._pendingDaily;
        if (this.deferStatus(() => this.tryShowDailyModal())) {
            return;
        }

        this._pendingDaily = null;
        if (!this.statusOnDom()) {
            this.showDailyPhaser(info);

            return;
        }

        this.domStatus.show('daily', this._statusSnap.daily(info));
        this.updateBlockLock();
    }

    hideDailyModal() {
        if (this.statusOnDom()) {
            this.domStatus.hide('daily');
        } else {
            this.hideDailyPhaser();
        }

        // Обучение, отложенное ради окна награды, стартует после его закрытия
        if (this._tutorialPending && !gameState.tutorialDone) {
            this._tutorialPending = false;
            this.buildTutorial();
        }

        this.updateBlockLock();
    }

    showBossRewardModal(reward) {
        if (!reward) {
            return;
        }

        if (this.deferStatus(() => this.showBossRewardModal(reward))) {
            return;
        }

        // Q4/D3: окно босса приоритетнее любых открытых экранов (настройки/карта/крафт)
        this._bossRewardOpen = true;
        if (this._settingsOpen) {
            this.closeModal();
        }

        if (!this.statusOnDom()) {
            this.showBossRewardPhaser(reward);

            return;
        }

        if (this._mapOpen) {
            this.closeMap();
        }

        if (this._craftOpen) {
            this.closeCraft();
        }

        this.domStatus.show('boss-reward', this._statusSnap['boss-reward'](reward));
        this.updateBlockLock();
    }

    hideBossRewardModal() {
        if (this.statusOnDom()) {
            this.domStatus.hide('boss-reward');
        } else {
            this.hideBossRewardPhaser();
        }

        this.tryShowDailyModal();
        this.updateBlockLock();
    }

    showPlayerDownModal(info) {
        if (!info) {
            return;
        }

        if (this.deferStatus(() => this.showPlayerDownModal(info))) {
            return;
        }

        // Q4/D3: вырубление приоритетнее настроек; карта/крафт закрываются ниже
        this._playerDownOpen = true;
        if (this._settingsOpen) {
            this.closeModal();
        }

        if (!this.statusOnDom()) {
            this.showPlayerDownPhaser(info);

            return;
        }

        if (this._mapOpen) {
            this.closeMap();
        }

        if (this._craftOpen) {
            this.closeCraft();
        }

        this.domStatus.show('player-down', this._statusSnap['player-down'](info));
        this.updateBlockLock();
    }

    hidePlayerDownModal() {
        if (this.statusOnDom()) {
            this.domStatus.hide('player-down');
        } else {
            this.hidePlayerDownPhaser();
        }

        this.tryShowDailyModal();
        this.updateBlockLock();
    }

    // Фасад настроек: одна точка входа для HUD/DevPanel/обучения. Выбор пути — по флагу
    // отката (D5): по умолчанию DOM, `?phaserForms=settings` — прежний Phaser-экран.
    async openModal() {
        if (this._settingsOpen) {
            return;
        }

        if (this.registry.get(REG.blockLocked)) {
            return;
        }

        if (isPhaserForm('settings')) {
            this.openSettingsPhaser();

            return;
        }

        await this._domSettingsReady;
        if (!this.domSettings) {
            // Тихий отказ чанка/цепочки не должен оставлять «мёртвую» кнопку:
            // диагностируем и отдаём управление готовому Phaser-пути (окно отката).
            console.error('[settings:dom] контроллер не смонтирован — открываю Phaser-путь');
            this.openSettingsPhaser();

            return;
        }

        this.domSettings.open();
    }

    closeModal() {
        if (!this._settingsOpen) {
            return;
        }

        if (isPhaserForm('settings')) {
            this.closeSettingsPhaser();

            return;
        }

        this.domSettings?.close();
    }

    // Открытие мастерской: единственная точка входа (HUD-кнопка, горячие клавиши).
    // Блокировка общая с остальными модалками; DOM-панель сама ставит _craftOpen.
    openCraft() {
        if (this._craftOpen) {
            return;
        }

        if (this.registry.get(REG.blockLocked)) {
            return;
        }

        if (this.domCraft) {
            this.domCraft.open();

            return;
        }

        // Первый тап до готовности чанка: открываем, как только контроллер смонтирован
        this._domCraftReady?.then(() => {
            if (!this._craftOpen && !this.registry.get(REG.blockLocked)) {
                this.domCraft?.open();
            }
        });
    }

    closeCraft() {
        if (this.domCraft && this.domCraft.isOpen()) {
            this.domCraft.close();
        }
    }

    // Единственный владелец registry 'blockLocked' и видимости listContent:
    // пересчёт каждый кадр из refreshUi, действия — только при изменении.
    // bossActive в формуле НЕ участвует: бой не держит блокировку — карта/крафт/
    // настройки открываются поверх боя (бой продолжается робо-рукой и пассивом),
    // заблокированы только спуск (guard в unlockBtn) и престиж/сброс (tryPrestige/tryReset).
    updateBlockLock() {
        const locked =
            this._settingsOpen ||
            this._offlineOpen ||
            this._dailyOpen ||
            this._mapOpen ||
            this._craftOpen ||
            this._bossRewardOpen ||
            this._playerDownOpen;
        if (locked !== this._blockLocked) {
            this._blockLocked = locked;
            this.registry.set(REG.blockLocked, locked);
        }

        const bossNow = !!this.registry.get(REG.bossActive);
        // Учебные слои гасятся под любой модалкой и боем: бабл «Кликай по
        // кубику…» торчал из-за модалки настроек с обрезанным текстом
        // (скриншот). Восстановление — по сохранённой видимости каждого слоя
        // (шаг 3 легитимно прячет кольцо/бабл — флаги это учитывают)
        if (this.tutDim) {
            const suppress = locked || bossNow;
            if (suppress !== this._tutSuppressed) {
                this._tutSuppressed = suppress;
                const layers = [
                    this.tutDim,
                    this.tutRing,
                    this.tutArrow,
                    this.tutBubble,
                    this.tutText,
                    this.tutFinal,
                    this.tutBtn,
                    this.tutBtnLbl
                ];
                if (suppress) {
                    for (const o of layers) {
                        o._tutVis = o.visible;
                        o.setVisible(false);
                    }
                } else if (this.tutorialStep === 3) {
                    this.showTutorialFinal();
                } else {
                    for (const o of layers) {
                        o.setVisible(o._tutVis !== false);
                    }

                    this.layoutTutorial();
                }
            }
        }

        // В бою панель показывает «Снаряжение» вместо списка улучшений.
        // На DOM-пути Phaser-список не строится/не показывается (D8 фазы 3).
        if (!this.domUpgrades) {
            this.listContent.setVisible(!locked && !bossNow);
        }

        if (this.gearContent) {
            const gearVis = bossNow && !locked;
            this.gearContent.setVisible(gearVis);
            this.refreshGearPanel();
        }

        // Портрет: панель целиком под оверлеем (applyPanelVisibility)
        this.applyPanelVisibility();
        if (this.mapRoot) {
            this.mapRoot.setVisible(this._mapOpen);
            this.mapContent.setVisible(this._mapOpen);
        }
    }

    refreshUi() {
        this.updateBlockLock();
        this.refreshMapNodes();
        this.refreshHud();
        this.refreshUnlockButton();
        this.refreshTabs();
        this.refreshRows();
        this.refreshSettingsModal();
        // Порядок важен: refreshUnlockButton снова показывает подсказку — на DOM-пути
        // прячем хром списка после всех штатных обновлений кадра.
        this.syncDomUpgradesChrome();
    }

    update() {
        // D3: Phaser-оверлей закрывает DOM-панель; снимок публикуется не чаще 150 мс
        if (this.domCraft) {
            this.domCraft.hideForOverlays();
            this.domCraft.tick();
        }

        this.domSettings?.tick();
        this.domUpgrades?.tick();

        this.stepTutorial();
        this.refreshUi();
    }
}

// Подмешиваем методы подсистем (имена методов уникальны — коллизий нет)
Object.assign(
    UIScene.prototype,
    hudMethods,
    panelMethods,
    gearMethods,
    layoutMethods,
    settingsModalMethods,
    statusModalsMethods,
    mapScreenMethods,
    tutorialMethods
);
