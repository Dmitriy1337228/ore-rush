import Phaser from 'phaser';
import { fmt, getUpgradeCost, getBulkCost, getAffordableBulk } from '../state.js';
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
import { isPhaserForm } from './shared/formsFlag.js';

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
        this.domSettings?.open();
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

        // В бою панель показывает «Снаряжение» вместо списка улучшений
        this.listContent.setVisible(!locked && !bossNow);
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
    }

    update() {
        // D3: Phaser-оверлей закрывает DOM-панель; снимок публикуется не чаще 150 мс
        if (this.domCraft) {
            this.domCraft.hideForOverlays();
            this.domCraft.tick();
        }

        this.domSettings?.tick();

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
