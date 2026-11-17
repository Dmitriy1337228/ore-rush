import { gameState } from '../state.js';
import { BG_FADE_MS, BG_OVERSIZE, tierBgKey } from './constants.js';

export const backgroundMethods = {
    drawBase() {
        const g = this.bgBase;
        g.clear();
        g.fillGradientStyle(0x3a3f44, 0x3a3f44, 0x1c1e22, 0x1c1e22, 1);
        g.fillRect(-80, -80, this.L.W + 160, this.L.H + 160);
    },

    positionBg() {
        if (!this.bgCurrent || !this.L) {
            return;
        }

        // Cover видимой зоны (0..bgCoverToY по вертикали, вся ширина) с запасом 8%:
        // тряска камеры при крите (~5px) не открывает края. Ландшафт даёт ровно
        // прежние 1382x778. Портрет — масштаб считается от ЗОНЫ УГЛУБЛЁННОЙ за панель
        // (bgCoverToY + 250): нижняя кромка фото (плоский «пол») прячется ЗА панелью,
        // а видимый низ прижимается к её верхней кромке.
        const frame = this.textures.getFrame(this.bgCurrent.texture.key);
        const coverDeep = this.L.portrait ? this.L.bgCoverToY + 250 : this.L.bgCoverToY;
        const scale = Math.max(this.L.W / frame.width, coverDeep / frame.height);
        const dw = Math.round(frame.width * scale * BG_OVERSIZE);
        const dh = Math.round(frame.height * scale * BG_OVERSIZE);
        const cx = this.L.W / 2;
        const cy = this.L.portrait ? coverDeep - dh / 2 + 2 : this.L.H / 2;
        this.bgCurrent.setPosition(cx, cy).setDisplaySize(dw, dh);
        this.bgNext.setPosition(cx, cy).setDisplaySize(dw, dh);
        this.bgShade.setPosition(this.L.W / 2, this.L.H / 2).setSize(this.L.W, this.L.H);
        this.drawFade();
    },

    // Тень над панелью (только портрет): плавный градиент от прозрачного к
    // чёрному — нижняя кромка фото «тонет» в тени перед листом. Прежние
    // ступенчатые 16 полос читались на телефоне как «полоски» (вопрос игрока)
    drawFade() {
        if (!this.bgFade || !this.L) {
            return;
        }

        const g = this.bgFade;
        g.clear();
        if (!this.L.portrait) {
            return;
        }

        const FH = 260;
        g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.88, 0.88);
        g.fillRect(0, this.L.bgCoverToY - FH, this.L.W, FH);
    },

    // Плавная смена фона при переходе на новый тир (или «Полный сброс» на тир 1).
    // ВСТРЕЧНЫЙ кроссфейд: старый фон гаснет (1->0), новый проявляется (0->1) —
    // переход читается одинаково в обе стороны (на светлый и на тёмный фон):
    // чистое fade-in поверх тёмного старого «не видно» в ранних кадрах, если новый фон светлее.
    swapBg() {
        const key = tierBgKey(gameState.tier);
        const cur = this.bgCurrent,
            nxt = this.bgNext;
        if (!nxt.visible && cur.texture.key === key) {
            return;
        }

        // Незавершённый кроссфейд мгновенно доводим до конца: частично проявленный
        // новый фон становится текущим, иначе новая смена стартует «с прыжка»
        this.tweens.killTweensOf([cur, nxt]);
        if (nxt.visible) {
            cur.setTexture(nxt.texture.key).setAlpha(1).setVisible(true);
            nxt.setVisible(false).setAlpha(0);
            if (cur.texture.key === key) {
                return;
            }
        }

        // Фейд: новый слой проявляется сверху, старый под ним гаснет
        nxt.setTexture(key).setAlpha(0).setVisible(true);
        this.tweens.add({ targets: nxt, alpha: 1, duration: BG_FADE_MS, ease: 'Linear' });
        this.tweens.add({
            targets: cur,
            alpha: 0,
            duration: BG_FADE_MS,
            ease: 'Linear',
            onComplete: () => {
                cur.setTexture(key).setAlpha(1).setVisible(true);
                nxt.setVisible(false).setAlpha(0);
            }
        });
    }
};
