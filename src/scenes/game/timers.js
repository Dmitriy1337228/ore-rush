import {
    gameState,
    TIERS,
    addOre,
    getOrePerSecond,
    getAutoClicksPerSecond,
    saveGame,
    saveLastExit,
    readLastExit,
    computeOfflineReward,
    fmt,
    SECOND_MS,
    MUTATIONS,
    MUTATION_CHECK_MS,
    MUTATION_CHANCE
} from '../../state.js';
import { floatText } from './effects.js';
import { TEXT, EVENTS, REG } from '../../ui/theme.js';
import {
    GAME_DEPTH,
    PASSIVE_TICK_MS,
    AUTO_TICK_MS,
    AUTO_BUDGET_CAP,
    AUTO_CLICKS_PER_TICK_GUARD,
    AUTOSAVE_MS
} from './constants.js';

export const timersMethods = {
    wireEvents() {
        // Ссылки сохраняются — shutdown обязан снять их с game.events (иначе
        // рестарт сцены навесит дубликаты и замкнёт уничтоженные объекты)
        this._onTierChanged = () => {
            // Кроссфейд стартует первым — до пересборки блока/эмиттеров,
            // чтобы смена фона не ждала тяжёлый кадр
            this.swapBg();
            this.buildEmitters(TIERS[gameState.tier].iconKey);
            this.buildBlock();
            this.refreshTick();
            // «Полный сброс» DevPanel тоже приходит сюда — синхронизируем mute BGM
            this.syncBgm();
        };
        this.game.events.on(EVENTS.tierChanged, this._onTierChanged);

        this._onOfflineApplied = (info) => {
            floatText(this, this.blockX, this.blockY - 140, `Шахтёры добыли: +${fmt(info.reward)}`, 26, TEXT.cream, {
                depth: GAME_DEPTH.floatText,
                rise: 50,
                duration: 1100
            });
        };
        this.game.events.on(EVENTS.offlineApplied, this._onOfflineApplied);

        // Тумблер «Музыка: вкл/выкл» и слайдер громкости (UIScene) — mute и volume BGM
        this._onMusicChanged = () => this.syncBgm();
        this.game.events.on(EVENTS.musicChanged, this._onMusicChanged);

        // Смена ориентации/размера окна (main.js) — перечитываем раскладку
        this._onLayoutChanged = () => this.applyLayout();
        this.game.events.on(EVENTS.layoutChanged, this._onLayoutChanged);
    },

    // Пассивный доход: раз в секунду
    setupPassiveIncomeTimer() {
        // Пассивный доход — раз в секунду (заряженная мутация умножает ставку)
        this.gpsTimer = this.time.addEvent({
            delay: PASSIVE_TICK_MS,
            loop: true,
            callback: () => {
                const gps = getOrePerSecond();
                if (gps > 0) {
                    const mut = this.mutation ? MUTATIONS[this.mutation.id] : null;
                    const mult = mut && mut.passiveMult ? mut.passiveMult : 1;
                    addOre(gps * mult);
                    floatText(
                        this,
                        this.blockX + 150,
                        this.blockY - 90,
                        `+${fmt(gps * mult)}`,
                        16,
                        TIERS[gameState.tier].floatColor,
                        { depth: GAME_DEPTH.floatText, startAlpha: 0.85, rise: 30, duration: 900 }
                    );
                    this.refreshTick();
                }
            }
        });
    },

    // Мутации блока
    setupMutationTimer() {
        // Мутации блока (Этап 3): раз в MUTATION_CHECK_MS шанс MUTATION_CHANCE —\n        // случайная мутация на MUTATION_DURATION_MS.
        // Пока мутация активна, триггер ждёт; единственный терминатор — таймер.
        // В бою новые мутации не стартуем (бой не держит blockLocked — guard явный):
        // подпись/тинт мутации не должны всплывать поверх оверлея босса.
        this.mutationTimer = this.time.addEvent({
            delay: MUTATION_CHECK_MS,
            loop: true,
            callback: () => {
                if (this.mutation || this.registry.get(REG.blockLocked) || this.registry.get(REG.bossActive)) {
                    return;
                }

                if (Math.random() >= MUTATION_CHANCE) {
                    return;
                }

                const types = Object.keys(MUTATIONS);
                this.startMutation(types[Math.floor(Math.random() * types.length)]);
            }
        });
    },

    // Робо-рука
    setupAutoMineTimer() {
        // Робо-рука: бюджетный аккумулятор авто-кликов (AUTO_CLICKS_PER_ROBOARM за уровень).
        // Копим доли кликов каждые AUTO_TICK_MS — целые исполняем; устойчиво к смене уровня.
        // Во время анимации разрушения клики не списываются — бюджет сохраняется
        // и исполняется после (иначе редкие удары терялись); модалки её не стопорят.
        this.autoBudget = 0;
        this.autoTimer = this.time.addEvent({
            delay: AUTO_TICK_MS,
            loop: true,
            callback: () => {
                const aps = getAutoClicksPerSecond();
                if (aps <= 0) {
                    return;
                }

                this.autoBudget += aps * (AUTO_TICK_MS / SECOND_MS);
                // Кап бюджета: во время анимации разрушения (blockBusy) клики не
                // списываются — без капа копился бы залп на всё время простоя.
                // Модалки (blockLocked) робо-руку не останавливают — она работает
                // под ними, как и пассивный доход.
                if (this.autoBudget > AUTO_BUDGET_CAP) {
                    this.autoBudget = AUTO_BUDGET_CAP;
                }

                let guard = 0;
                while (this.autoBudget >= 1 && guard < AUTO_CLICKS_PER_TICK_GUARD) {
                    if (this.blockBusy) {
                        break;
                    }

                    this.autoBudget -= 1;
                    guard++;
                    this.autoMine();
                }
            }
        });
    },

    // Автосохранение
    setupAutosaveTimer() {
        // Автосохранение раз в AUTOSAVE_MS
        this.saveTimer = this.time.addEvent({
            delay: AUTOSAVE_MS,
            loop: true,
            callback: () => {
                saveGame();
                // Heartbeat счётчика офлайна: hidden/beforeunload на мобильном
                // вебвью и при kill процесса не срабатывают — без heartbeat штамп
                // оставался со старого сеанса и офлайн показывал дни вместо минут.
                // Пока вкладка видима, штамп живой; при freeze/kill замирает на
                // моменте последнего видимого тика = честное время отсутствия.
                // rAF-таймер на hidden замирает сам, поверх финальной записи
                // из setupVisibilityHandlers ничего не пишет.
                saveLastExit();
            }
        });
    },

    // Офлайн-учёт при сворачивании и закрытии вкладки
    setupVisibilityHandlers() {
        // Офлайн: время выхода фиксируем при сворачивании/закрытии (один вызов setStats за событие)
        this.onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                this.setGameplay(false);
                saveGame();
                saveLastExit();
            } else {
                // Возврат во вкладку: если отсутствовали дольше 5 минут — начисляем офлайн.
                // СНАЧАЛА читаем время выхода, записанное при hidden: перезапись «сейчас»
                // до чтения затирает период отсутствия и делает начисление невозможным
                // (мобильный вебвью Яндекса сворачивается без перезагрузки страницы).
                readLastExit().then((lastExit) => {
                    if (!lastExit) {
                        saveLastExit(); // первый отсчёт

                        return;
                    }

                    const info = computeOfflineReward(lastExit);
                    if (info) {
                        addOre(info.reward);
                        this.registry.set(REG.offlineInfo, info);
                        saveLastExit(); // начинаем новый отсчёт
                        this.game.events.emit(EVENTS.offlineApplied, info);
                    } else {
                        // меньше порога / нет пассива — перезапускаем отсчёт
                        saveLastExit();
                    }
                });
                this.setGameplay(true);
            }
        };
        document.addEventListener('visibilitychange', this.onVisibility);

        this.onBeforeUnload = () => {
            saveGame();
            saveLastExit();
        };
        window.addEventListener('beforeunload', this.onBeforeUnload);
    },

    // Освобождение ресурсов сцены
    setupShutdownHandler() {
        this.events.on('shutdown', () => {
            saveGame();
            if (this.boss) {
                this.stopBossBgm();
            }

            this.cancelBossWindup();
            this.destroyBossOverlay();
            this.boss = null;
            this.registry.set(REG.bossActive, false);
            document.removeEventListener('visibilitychange', this.onVisibility);
            window.removeEventListener('beforeunload', this.onBeforeUnload);
            this.game.events.off(EVENTS.tierChanged, this._onTierChanged);
            this.game.events.off(EVENTS.offlineApplied, this._onOfflineApplied);
            this.game.events.off(EVENTS.musicChanged, this._onMusicChanged);
            this.game.events.off(EVENTS.layoutChanged, this._onLayoutChanged);
        });
    }
};
