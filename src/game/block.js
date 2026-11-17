import Phaser from 'phaser';
import {
    gameState,
    rollClickGain,
    addOre,
    getAutoClicksPerSecond,
    fmt,
    MUTATIONS,
    getMutationBreakBonus
} from '../state.js';
import { playSfx } from '../sfx.js';
import { floatText, showHitFeedback } from './effects.js';
import { TEXT, REG } from '../ui/shared/theme.js';
import { BLOCK_STAGES, blockStageKey, GAME_DEPTH } from './constants.js';

export const blockMethods = {
    buildEmitters(oreIconKey) {
        if (this.oreEmitter) {
            this.oreEmitter.destroy();
        }

        if (this.debrisEmitter) {
            this.debrisEmitter.destroy();
        }

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
    },

    buildBlock() {
        // Координаты блока задаёт applyLayout (адаптивная раскладка)
        this.blockStage = 0;
        this.hitProgress = 0;
        this.blockBusy = false;
        if (this.streakTimer) {
            // хвост заживления от старого блока не должен дёргать текстуру нового
            this.streakTimer.remove();
            this.streakTimer = null;
        }

        if (this.block) {
            // Phaser НЕ снимает твины при destroy цели: зомби-shrink дожил бы до
            // delayedCall из onComplete и отработал на новом блоке (двойное дыхание,
            // ложный схлоп-поп) — твины снимаем руками
            this.tweens.killTweensOf(this.block);
            this.block.destroy();
        }

        this.blockGen = (this.blockGen || 0) + 1; // поколение блока — для отмены отложенных цепочек
        this.block = this.add
            .image(this.blockX, this.blockY, blockStageKey(gameState.tier, 1))
            .setScale(this.blockScale);
        this.block.setInteractive({ useHandCursor: true });
        this.startBreathingTween();

        this.block.on('pointerdown', (pointer) => this.handleMine(pointer));
    },

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
    },

    handleMine(pointer) {
        this.performMine(pointer.worldX, pointer.worldY, false);
    },

    // Единый путь добычи для ручного клика и Робо-руки.
    // isAuto: без тряски камеры и без инкремента счётчика ручных кликов.
    performMine(px, py, isAuto) {
        if (this.blockBusy) {
            return;
        }

        // Модалка блокирует только РУЧНОЙ клик (robо-рука — машинный доход, как
        // пассив: продолжает работать под модалкой). Ручной клик до блока и так
        // не доходит (интерактивный dim модалки перехватывает ввод) — guard
        // оставлен как страховка.
        if (!isAuto && this.registry.get(REG.blockLocked)) {
            return;
        }

        const mut = this.mutation ? MUTATIONS[this.mutation.id] : null;
        // ключ мутации = this.mutation.id (сеется из ключа MUTATIONS в startMutation)
        const { gain, crit, lucky } = rollClickGain(this.mutation ? this.mutation.id : null);
        addOre(gain);
        if (!isAuto) {
            gameState.clicks += 1;
        }

        // Звуки добычи — только ручные клики: авто-клики робо-руки работают в фоне
        // и звучали бы какофонией; разрушение блока — исключение (звучит всегда)
        if (!isAuto) {
            playSfx(this, 'pickaxe');
            if (crit || lucky) {
                playSfx(this, 'crit');
            }
        }

        // Частицы руды и всплывающий текст в точке добычи
        showHitFeedback(this, px, py, gain, { crit, lucky, isAuto });

        if ((crit || lucky) && !isAuto) {
            this.cameras.main.shake(120, 0.004);
        }

        // Трещины: 3 удара -> визуально «разбит» -> 4-й удар ломает блок и рождает новый.
        // Мутации могут замедлить прогресс стадий (замороженная: 3 удара на стадию,
        // взрывная: 2) — счётчик hitProgress копит удары до порога.
        if (this.blockStage >= BLOCK_STAGES.length) {
            this.breakBlock(isAuto);
        } else {
            this.hitProgress += 1;
            const hitsPerStage = mut && mut.hitsPerStage ? mut.hitsPerStage : 1;
            if (this.hitProgress >= hitsPerStage) {
                this.hitProgress = 0;
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
        }

        // Если по блоку долго не бить — трещины затягиваются. Окно заживления не
        // короче интервала авто-кликов: иначе редкие удары Робо-руки (0.5/с на
        // 1 ур. = раз в 2с) гаснут о зажившие трещины (окно 1.2с) и блок никогда
        // не накапливает стадии — не разрушается вовсе.
        const aps = getAutoClicksPerSecond();
        const healMs = aps > 0 ? Math.max(1200, 1000 / aps + 400) : 1200;
        if (this.streakTimer) {
            this.streakTimer.remove();
        }

        this.streakTimer = this.time.delayedCall(healMs, () => {
            if (!this.blockBusy) {
                this.blockStage = 0;
                this.hitProgress = 0;
                this.block.setTexture(blockStageKey(gameState.tier, 1));
            }
        });

        this.refreshTick();
    },

    // Робо-рука: авто-клик по блоку. Полный урон клика, без тряски камеры.
    // В бою робо-рука бьёт босса (машиновый доход, как пассив — под любым UI).
    autoMine() {
        if (this.boss) {
            const bx = this.blockX + Phaser.Math.Between(-70, 70);
            const by = this.blockY + Phaser.Math.Between(-70, 50);
            this.performBossHit(bx, by, true);

            return;
        }

        const px = this.blockX + Phaser.Math.Between(-70, 70);
        const py = this.blockY + Phaser.Math.Between(-70, 50);
        this.performMine(px, py, true);
    },

    breakBlock(fromAuto) {
        playSfx(this, 'break');
        const mut = this.mutation ? MUTATIONS[this.mutation.id] : null;

        // Взрывная мутация: бонус руды при разрушении блока + усиленный взрыв частиц
        if (mut && mut.breakBonusMult) {
            const bonus = getMutationBreakBonus(this.mutation.id);
            addOre(bonus);
            floatText(this, this.blockX, this.blockY - 80, `ВЗРЫВ! +${fmt(bonus)}`, 30, '#ff9040', {
                depth: GAME_DEPTH.floatBurst,
                rise: 60,
                duration: 1100,
                ease: 'Cubic.easeOut'
            });
            this.oreEmitter.explode(60, this.blockX, this.blockY);
            this.debrisEmitter.explode(30, this.blockX, this.blockY);
        }

        // Мутация НЕ спадает при разрушении блока — длится ровно 10с (терминатор только таймер).
        // Новый блок наследует активную мутацию; tint переустановит update(), счёт ударов — с нуля.
        this.blockBusy = true;
        this.blockStage = 0;
        this.hitProgress = 0;

        this.oreEmitter.explode(26, this.blockX, this.blockY);
        this.debrisEmitter.explode(12, this.blockX, this.blockY);
        // Тряска камеры при разрушении убрана по фидбеку — фон не должен дёргаться
        // (фидбек разрушения: взрыв частиц + «Блок разрушен!» + звук)

        floatText(this, this.blockX, this.blockY - 120, 'Блок разрушен!', 24, TEXT.cream, {
            depth: GAME_DEPTH.floatText,
            rise: 50,
            duration: 900,
            ease: 'Cubic.easeOut'
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
                const gen = this.blockGen; // поколение блока на момент разрушения
                this.time.delayedCall(120, () => {
                    // блок пересоздан (смена тира / полный сброс) — зомби-цепочка отменена:
                    // buildBlock уже снял blockBusy и собрал новый блок с дыханием
                    if (gen !== this.blockGen) {
                        return;
                    }

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
};
