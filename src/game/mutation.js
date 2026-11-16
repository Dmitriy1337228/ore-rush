import Phaser from 'phaser';
import { gameState, MUTATIONS, MUTATION_DURATION_MS } from '../state.js';
import { playSfx } from '../sfx.js';
import { makeLabel } from '../ui/shared/uiKit.js';
import { floatText } from './effects.js';
import { TEXT, REG, FONT_SIZE } from '../ui/shared/theme.js';
import { blockStageKey, GAME_DEPTH } from './constants.js';

export const mutationMethods = {
    // Активирует мутацию на 10с (или указанную длительность — DevPanel/тесты).
    // Единственный терминатор — таймер: мутация переживает разрушение блока и смену тира.
    startMutation(typeId, duration = MUTATION_DURATION_MS) {
        const def = MUTATIONS[typeId];
        if (!def) {
            return;
        }

        if (this.mutation) {
            this.clearMutation(false);
        }

        // Конечные цвета пульса предвычисляем один раз — update() интерполирует числа без аллокаций
        const c1 = Phaser.Display.Color.IntegerToColor(def.tints[0]);
        const c2 = Phaser.Display.Color.IntegerToColor(def.tints[1]);
        this.mutation = {
            id: typeId,
            endsAt: this.time.now + duration,
            tints: def.tints,
            c1: { r: c1.r, g: c1.g, b: c1.b },
            c2: { r: c2.r, g: c2.g, b: c2.b }
        };
        this.hitProgress = 0;
        // HUD-ставка (UIScene) должна показывать фактическую фоновую добычу — с множителем мутации
        this.registry.set(REG.passiveMult, def.passiveMult || 1);
        playSfx(this, 'mutation');

        // Подпись + таймер над блоком (парят)
        this.mutationUi = this.add.container(this.blockX, this.blockY - 200).setDepth(GAME_DEPTH.floatBurst);
        this.mutationName = makeLabel(this, 0, 0, def.name, FONT_SIZE.cardTitle, TEXT.white).setOrigin(0.5);
        this.mutationTime = makeLabel(
            this,
            0,
            28,
            `${Math.ceil(duration / 1000)}с`,
            FONT_SIZE.stat,
            TEXT.cream
        ).setOrigin(0.5);
        this.mutationUi.add([this.mutationName, this.mutationTime]);
        this.tweens.add({
            targets: this.mutationUi,
            y: this.blockY - 208,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Всплывашка-объявление
        floatText(this, this.blockX, this.blockY - 120, `Мутация: ${def.name}!`, 26, TEXT.cream, {
            depth: GAME_DEPTH.floatBurst,
            rise: 55,
            duration: 1200,
            ease: 'Cubic.easeOut'
        });

        this.refreshTick();
    },

    // Снимает мутацию: убирает подпись/tint, восстанавливает текстуру текущей стадии.
    // restoreTexture=false — когда текстуру ставит другой код (анимация разрушения, buildBlock).
    clearMutation(restoreTexture = true) {
        if (this.mutationUi) {
            this.tweens.killTweensOf(this.mutationUi);
            this.mutationUi.destroy();
            this.mutationUi = null;
            this.mutationName = null;
            this.mutationTime = null;
        }

        this.mutation = null;
        this.hitProgress = 0;
        this.registry.set(REG.passiveMult, 1);
        this.block.clearTint();
        if (restoreTexture && !this.blockBusy) {
            this.block.setTexture(blockStageKey(gameState.tier, Math.min(this.blockStage + 1, 4)));
        }

        this.refreshTick();
    },

    // Тик мутации блока: таймер, тинт
    tickMutation() {
        if (!this.mutation) {
            return;
        }

        const remaining = this.mutation.endsAt - this.time.now;
        if (remaining <= 0) {
            this.clearMutation(true);

            return;
        }

        if (this.mutationTime) {
            this.mutationTime.setText(`${Math.ceil(remaining / 1000)}с`);
        }

        const palette = this.mutation.tints;
        if (palette.length > 2) {
            // Радуга: перебор цветов
            this.block.setTint(palette[Math.floor(this.time.now / 120) % palette.length]);
        } else {
            // Пульс/мерцание между двумя цветами палитры (числа, без аллокаций)
            const m = this.mutation;
            const speed = this.mutation.id === 'explosive' ? 180 : 260;
            const t = 0.5 + 0.5 * Math.sin(this.time.now / speed);
            this.block.setTint(
                Phaser.Display.Color.GetColor(
                    Math.round(m.c1.r + (m.c2.r - m.c1.r) * t),
                    Math.round(m.c1.g + (m.c2.g - m.c1.g) * t),
                    Math.round(m.c1.b + (m.c2.b - m.c1.b) * t)
                )
            );
        }
    }
};
