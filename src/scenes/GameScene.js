import Phaser from 'phaser';
import {
    gameState, TIERS, rollClickGain, addOre, getOrePerSecond, getAutoClicksPerSecond,
    saveGame, loadGame, saveLastExit, readLastExit, computeOfflineReward, fmt
} from '../state.js';

const FONT = '"Monocraft", "Inter", "Consolas", monospace';

const BLOCK_STAGES = [1, 2, 3, 4];

function blockStageKey(tier, stage) {
    const prefix = TIERS[tier].blockPrefix;
    if (prefix === 'block') {
        return ['block_stage_1_intact', 'block_stage_2_cracked', 'block_stage_3_heavy_cracks', 'block_stage_4_shattered'][stage - 1];
    }
    return `${prefix}_stage_${stage}`;
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

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.streakTimer = null;
        this.blockStage = 0;   // 0..3 — визуальная стадия трещин
        this.blockBusy = false;
        this.blockScale = 4.4;
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
                this.registry.set('offlineInfo', info);
            }
        }

        this.buildWorld();
        this.buildBlock();
        this.setupTimers();
        this.wireEvents();

        this.scene.launch('UIScene');
        this.refreshTick();
    }

    // ---------- Мир ----------

    buildWorld() {
        const g = this.add.graphics();
        g.fillGradientStyle(0x3a3f44, 0x3a3f44, 0x1c1e22, 0x1c1e22, 1);
        g.fillRect(0, 0, 1280, 720);

        this.buildEmitters(TIERS[gameState.tier].iconKey);
    }

    buildEmitters(oreIconKey) {
        if (this.oreEmitter) this.oreEmitter.destroy();
        if (this.debrisEmitter) this.debrisEmitter.destroy();

        // Текстуры руд разного разрешения (канвасы от 30 до 256px) — нормируем
        // частицы к ~30px видимого размера (старый калибр: 135px x 0.22 = 30px).
        const frame = this.textures.getFrame(oreIconKey);
        const k = Math.min(30 / frame.width, 30 / frame.height);

        this.oreEmitter = this.add.particles(0, 0, oreIconKey, {
            emitting: false,
            lifespan: { min: 500, max: 1100 },
            speed: { min: 120, max: 340 },
            angle: { min: 200, max: 340 },
            gravityY: 700,
            scale: { start: k, end: k * 0.27 },
            rotate: { min: -180, max: 180 }
        });
        this.debrisEmitter = this.add.particles(0, 0, 'ore_particle_debris', {
            emitting: false,
            lifespan: { min: 400, max: 900 },
            speed: { min: 80, max: 260 },
            angle: { min: 190, max: 350 },
            gravityY: 800,
            scale: { start: 1, end: 0.3 }
        });
    }

    buildBlock() {
        this.blockX = 400;
        this.blockY = 400;
        this.blockStage = 0;
        this.blockBusy = false;

        if (this.block) this.block.destroy();
        this.block = this.add.image(this.blockX, this.blockY, blockStageKey(gameState.tier, 1)).setScale(this.blockScale);
        this.block.setInteractive({ useHandCursor: true });
        this.startBreathingTween();

        this.block.on('pointerdown', (pointer) => this.handleMine(pointer));
    }

    startBreathingTween() {
        this.tweens.add({
            targets: this.block,
            scaleX: { from: this.blockScale, to: this.blockScale + 0.1 },
            scaleY: { from: this.blockScale, to: this.blockScale + 0.1 },
            duration: 1400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    wireEvents() {
        // Смена тира (от UIScene после покупки уровня шахты или престижа)
        this.game.events.on('tier-changed', () => {
            this.buildEmitters(TIERS[gameState.tier].iconKey);
            this.buildBlock();
            this.refreshTick();
        });

        this.game.events.on('offline-applied', (info) => {
            const float = makeLabel(this, this.blockX, this.blockY - 140, `Шахтёры добыли: +${fmt(info.reward)}`, 26, '#ffe9b0');
            float.setOrigin(0.5).setDepth(20);
            this.tweens.add({ targets: float, y: float.y - 50, alpha: 0, duration: 1100, onComplete: () => float.destroy() });
        });
    }

    setupTimers() {
        // Пассивный доход — раз в секунду
        this.gpsTimer = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                const gps = getOrePerSecond();
                if (gps > 0) {
                    addOre(gps);
                    const float = makeLabel(this, this.blockX + 150, this.blockY - 90, `+${fmt(gps)}`, 16, TIERS[gameState.tier].floatColor);
                    float.setOrigin(0.5).setDepth(20).setAlpha(0.85);
                    this.tweens.add({ targets: float, y: float.y - 30, alpha: 0, duration: 900, onComplete: () => float.destroy() });
                    this.refreshTick();
                }
            }
        });

        // Робо-рука: бюджетный аккумулятор авто-кликов (0.5 клика/сек за уровень).
        // Копим доли кликов каждые 200мс — целые исполняем; устойчиво к смене уровня.
        // Во время анимации разрушения/блокировки клики не списываются — бюджет
        // сохраняется и исполняется после (иначе редкие удары терялись).
        this.autoBudget = 0;
        this.autoTimer = this.time.addEvent({
            delay: 200,
            loop: true,
            callback: () => {
                const aps = getAutoClicksPerSecond();
                if (aps <= 0) return;
                this.autoBudget += aps * 0.2;
                let guard = 0;
                while (this.autoBudget >= 1 && guard < 100) {
                    if (this.blockBusy || this.registry.get('blockLocked')) break;
                    this.autoBudget -= 1;
                    guard++;
                    this.autoMine();
                }
            }
        });

        // Автосохранение раз в 5 секунд
        this.saveTimer = this.time.addEvent({
            delay: 5000,
            loop: true,
            callback: () => saveGame()
        });

        // Офлайн: время выхода фиксируем при сворачивании/закрытии (один вызов setStats за событие)
        this.onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                saveGame();
                saveLastExit();
            } else {
                // Возврат во вкладку: если отсутствовали дольше 5 минут — начисляем офлайн
                saveLastExit(); // перезаписываем старое время выхода актуальным
                readLastExit().then((lastExit) => {
                    if (!lastExit) return;
                    const info = computeOfflineReward(lastExit);
                    if (info) {
                        addOre(info.reward);
                        this.registry.set('offlineInfo', info);
                        saveLastExit(); // начинаем новый отсчёт
                        this.game.events.emit('offline-applied', info);
                    }
                });
            }
        };
        document.addEventListener('visibilitychange', this.onVisibility);

        this.onBeforeUnload = () => {
            saveGame();
            saveLastExit();
        };
        window.addEventListener('beforeunload', this.onBeforeUnload);

        this.events.on('shutdown', () => {
            saveGame();
            document.removeEventListener('visibilitychange', this.onVisibility);
            window.removeEventListener('beforeunload', this.onBeforeUnload);
        });
    }

    // ---------- Добыча ----------

    handleMine(pointer) {
        this.performMine(pointer.worldX, pointer.worldY, false);
    }

    // Единый путь добычи для ручного клика и Робо-руки.
    // isAuto: без тряски камеры и без инкремента счётчика ручных кликов.
    performMine(px, py, isAuto) {
        if (this.blockBusy) return;
        if (this.registry.get('blockLocked')) return; // открыта модалка в UIScene

        const { gain, crit, lucky } = rollClickGain();
        addOre(gain);
        if (!isAuto) gameState.clicks += 1;

        // Частицы руды из точки добычи
        this.oreEmitter.explode(crit || lucky ? 16 : 8, px, py);
        this.debrisEmitter.explode(crit || lucky ? 8 : 4, px, py);

        // Всплывающий текст (авто-клики — мельче, чтобы не забивали ручные)
        let label = `+${fmt(gain)}`;
        let color = TIERS[gameState.tier].floatColor;
        if (lucky) { label = `ЖИЛА! +${fmt(gain)}`; color = '#ffec8a'; }
        else if (crit) { label = `КРИТ! +${fmt(gain)}`; color = '#ffd75e'; }
        const size = crit || lucky ? 30 : (isAuto ? 16 : 22);
        const float = makeLabel(this, px, py - 30, label, size, color);
        float.setOrigin(0.5);
        this.tweens.add({
            targets: float,
            y: float.y - 60,
            alpha: 0,
            duration: 750,
            ease: 'Cubic.easeOut',
            onComplete: () => float.destroy()
        });

        if ((crit || lucky) && !isAuto) this.cameras.main.shake(120, 0.004);

        // Трещины: 3 удара -> визуально «разбит» -> 4-й удар ломает блок и рождает новый
        if (this.blockStage >= BLOCK_STAGES.length) {
            this.breakBlock(isAuto);
        } else {
            this.blockStage += 1;
            this.block.setTexture(blockStageKey(gameState.tier, Math.min(this.blockStage + 1, 4)));
            this.tweens.killTweensOf(this.block);
            this.tweens.add({
                targets: this.block,
                scaleX: this.blockScale - 0.3,
                scaleY: this.blockScale - 0.3,
                duration: 50,
                yoyo: true,
                ease: 'Quad.easeOut',
                onComplete: () => this.startBreathingTween()
            });
        }

        // Если по блоку долго не бить — трещины затягиваются. Окно заживления не
        // короче интервала авто-кликов: иначе редкие удары Робо-руки (0.5/с на
        // 1 ур. = раз в 2с) гаснут о зажившие трещины (окно 1.2с) и блок никогда
        // не накапливает стадии — не разрушается вовсе.
        const aps = getAutoClicksPerSecond();
        const healMs = aps > 0 ? Math.max(1200, 1000 / aps + 400) : 1200;
        if (this.streakTimer) this.streakTimer.remove();
        this.streakTimer = this.time.delayedCall(healMs, () => {
            if (!this.blockBusy) {
                this.blockStage = 0;
                this.block.setTexture(blockStageKey(gameState.tier, 1));
            }
        });

        this.refreshTick();
    }

    // Робо-рука: авто-клик по блоку. Полный урон клика, без тряски камеры.
    autoMine() {
        const px = this.blockX + Phaser.Math.Between(-70, 70);
        const py = this.blockY + Phaser.Math.Between(-70, 50);
        this.performMine(px, py, true);
    }

    breakBlock(fromAuto) {
        this.blockBusy = true;
        this.blockStage = 0;

        this.oreEmitter.explode(26, this.blockX, this.blockY);
        this.debrisEmitter.explode(12, this.blockX, this.blockY);
        if (!fromAuto) this.cameras.main.shake(160, 0.005);

        const bonusFloat = makeLabel(this, this.blockX, this.blockY - 120, 'Блок разрушен!', 24, '#ffe9b0', { fontStyle: 'bold' });
        bonusFloat.setOrigin(0.5).setDepth(20);
        this.tweens.add({
            targets: bonusFloat,
            y: bonusFloat.y - 50,
            alpha: 0,
            duration: 900,
            ease: 'Cubic.easeOut',
            onComplete: () => bonusFloat.destroy()
        });

        this.tweens.killTweensOf(this.block);
        this.tweens.add({
            targets: this.block,
            scaleX: this.blockScale * 0.75,
            scaleY: this.blockScale * 0.75,
            angle: -8,
            alpha: 0.15,
            duration: 130,
            ease: 'Quad.easeIn',
            onComplete: () => {
                this.time.delayedCall(120, () => {
                    this.block.setTexture(blockStageKey(gameState.tier, 1));
                    this.block.setScale(this.blockScale * 0.6);
                    this.tweens.add({
                        targets: this.block,
                        scaleX: this.blockScale,
                        scaleY: this.blockScale,
                        angle: 0,
                        alpha: 1,
                        duration: 220,
                        ease: 'Back.easeOut',
                        onComplete: () => {
                            this.blockBusy = false;
                            this.startBreathingTween();
                        }
                    });
                });
            }
        });
    }

    refreshTick() {
        // UIScene сама опрашивает состояние в update(); событие — для мгновенных реакций
        this.game.events.emit('ui-refresh');
    }
}
