import Phaser from 'phaser';
import {
    gameState,
    TIERS,
    addOre,
    loadGame,
    readLastExit,
    computeOfflineReward,
    saveLastExit,
    canClaimDaily,
    claimDailyReward
} from '../state.js';
import { YandexSDKStub } from '../sdk-stub.js';
import { computeLayout } from '../layout.js';
import { EVENTS, REG } from '../ui/theme.js';
import { BG_SHADE_ALPHA, tierBgKey } from '../game/constants.js';
import { backgroundMethods } from '../game/background.js';
import { blockMethods } from '../game/block.js';
import { audioMethods } from '../game/audio.js';
import { bossMethods } from '../game/boss.js';
import { mutationMethods } from '../game/mutation.js';
import { timersMethods } from '../game/timers.js';

// GameScene — игровой мир: блок, босс, мутации, фон, таймеры. Реализация разложена
// по подсистемам (src/scenes/game/*): каждый модуль — набор методов одной зоны
// ответственности, подмешиваемый в прототип сцены ниже.
export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.streakTimer = null;
        this.blockStage = 0; // 0..3 — визуальная стадия трещин
        this.blockBusy = false;
        this.blockScale = 4.4;
        this.mutation = null; // { id, endsAt } — активная мутация блока (Этап 3); единственный терминатор — таймер
        this.mutationUi = null;
        this.hitProgress = 0; // удары, накопленные на текущей стадии (для hitsPerStage > 1)
        this.boss = null; // активный босс: { def, hp, maxHp, busy, startedAt, endsAt } — режим боя
        this.bossUi = null; // контейнер оверлея боя (спрайт, HP-бар, кнопки)
        this._preBossBgm = null; // обычный BGM, замещённый босс-темой на время боя
        this._bossBy = 0; // фактический Y оверлея боя (портретный кламп)
        this._bossSaveAt = 0; // троттлинг сейва персиста боя (раз в 3 с)
    }

    create() {
        this.loadSaveThenStart();
    }

    async loadSaveThenStart() {
        await loadGame();

        // Офлайн-доход: считаем один раз при загрузке; если больше 5 минут — UIScene покажет окно
        const lastExit = await readLastExit();
        if (lastExit) {
            const info = computeOfflineReward(lastExit);
            if (info) {
                addOre(info.reward);
                this.registry.set(REG.offlineInfo, info);
            }
        }

        // Счётчик отсутствия перезапускается при КАЖДОЙ загрузке: штамп от
        // прошлого сеанса (мобильный вебвью/kill процесса не дают hidden/
        // beforeunload) иначе используется повторно — повторное начисление
        // и «72 ч» вместо реальных минут отсутствия
        saveLastExit();

        this.buildWorld();
        this.buildBlock();
        this.setupTimers();
        this.wireEvents();

        this.scene.launch('UIScene');
        this.startBgm();
        // Незавершённый бой из сейва продолжается (F5 не сбрасывает босса):
        // HP и накопленное время восстановлены, модалки дневной награды откладываются.
        if (gameState.bossFight) {
            this.startBossFight(gameState.bossFight.bossId, gameState.bossFight);
        }

        this.setGameplay(true);
        this.refreshTick();
        this.claimDaily();
        this.hidePageLoader();
    }

    // HTML-лоадер из index.html гасится, когда мир уже отрисован первым кадром —
    // до этого он закрывал «серый фон» страницы на медленных соединениях
    hidePageLoader() {
        const el = document.getElementById('loader');
        if (el) {
            el.classList.add('hidden');
            setTimeout(() => el.remove(), 500);
        }
    }

    // Ежедневная награда при первом заходе за день: выдаётся сразу (state.js),
    // UIScene показывает модалку (registry 'dailyInfo' при загрузке или событие
    // 'daily-claimed' из DevPanel — оба пути в одну очередь).
    claimDaily() {
        if (!canClaimDaily()) {
            return;
        }

        const info = claimDailyReward();
        if (!info) {
            return;
        }

        this.registry.set(REG.dailyInfo, info);
        this.game.events.emit(EVENTS.dailyClaimed, info);
    }

    // GameplayAPI Яндекса (стаб — no-op): start — игрок активен, stop — свёрнута.
    setGameplay(active) {
        const p = YandexSDKStub.player;
        if (!p || !p.gameplayStart) {
            return;
        }

        if (active && !this._gameplayActive) {
            this._gameplayActive = true;
            p.gameplayStart();
        } else if (!active && this._gameplayActive) {
            this._gameplayActive = false;
            p.gameplayStop();
        }
    }

    buildWorld() {
        this.applyLayout();

        // Стартовый градиент остаётся подложкой под фоном (страховка на случай,
        // если текстура фона ещё не готова) — ОБЯЗАТЕЛЬНО ниже bgCurrent/bgNext,
        // иначе непрозрачный градиент закроет фон целиком.
        this.bgBase = this.add.graphics().setDepth(-4);
        this.drawBase();

        // Слой фона локации: bgCurrent (видимый) + bgNext (невидимый верхний для кроссфейда).
        // Позиция/размер — по раскладке (positionBg): cover видимой зоны + 8% оверсайз.
        // bgShade — лёгкое затемнение поверх фона: контент фона не спорит с блоком и HUD.
        this.bgCurrent = this.add.image(0, 0, tierBgKey(gameState.tier)).setOrigin(0.5).setDepth(-3);
        this.bgNext = this.add
            .image(0, 0, tierBgKey(gameState.tier))
            .setOrigin(0.5)
            .setDepth(-2)
            .setAlpha(0)
            .setVisible(false);
        this.bgShade = this.add.rectangle(0, 0, 10, 10, 0x000000, BG_SHADE_ALPHA).setDepth(-1);
        // Тень над панелью (портрет): плавный градиент прячет нижнюю кромку фото
        // (при зуме читается как серая полоса) — контент «уходит» под лист
        this.bgFade = this.add.graphics().setDepth(-1);
        this.drawFade();
        this.positionBg();

        this.buildEmitters(TIERS[gameState.tier].iconKey);
    }

    applyLayout() {
        const L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        this.L = L;
        if (this.bgBase) {
            this.drawBase();
        }

        this.positionBg();
        const bx = L.block.x,
            by = L.block.y;
        const moved = this.blockX !== bx || this.blockY !== by;
        this.blockX = bx;
        this.blockY = by;
        if (this.block && moved) {
            this.block.setPosition(bx, by);
            if (this.mutationUi) {
                // Подпись мутации привязана к блоку — перезапускаем боб-твин от новой точки
                this.tweens.killTweensOf(this.mutationUi);
                this.mutationUi.setPosition(bx, by - 200);
                this.tweens.add({
                    targets: this.mutationUi,
                    y: by - 208,
                    duration: 900,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        }
    }

    setupTimers() {
        this.setupPassiveIncomeTimer();
        this.setupMutationTimer();
        this.setupAutoMineTimer();
        this.setupAutosaveTimer();
        this.setupVisibilityHandlers();
        this.setupShutdownHandler();
    }

    update() {
        this.tickBoss();
        this.tickMutation();
    }

    refreshTick() {
        // UIScene сама опрашивает состояние в update(); событие — для мгновенных реакций
        this.game.events.emit(EVENTS.uiRefresh);
    }
}

Object.assign(
    GameScene.prototype,
    backgroundMethods,
    blockMethods,
    audioMethods,
    bossMethods,
    mutationMethods,
    timersMethods
);
