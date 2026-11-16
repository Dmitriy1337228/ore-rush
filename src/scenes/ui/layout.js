import Phaser from 'phaser';
import {
    gameState, TIERS, getNextTier
} from '../../state.js';
import { VIEWPORT } from '../../ui/listGeometry.js';
import { REG } from '../../ui/theme.js';
import { computeLayout } from '../../layout.js';

export const layoutMethods = {
    applyLayout() {
        const L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        this.L = L;
        // Боевой вариант портретной сетки: панель поднимается под блок босса
        // (пустота под боссом и сжатая панель — замечание игрока), кнопки
        // Карта/Крафт следуют за панелью. Формула byF синхронна с
        // GameScene.buildBossOverlay (кламп 386).
        const bossNow = !!this.registry.get(REG.bossActive);
        // Боевой вариант портрета: панель НЕ прыгает (py как вне боя); во врезке
        // без хрома, док — Карта/Крафт на всю ширину. Спуск прячется также,
        // когда нового тира нет вовсе (док: Карта/Крафт 306)
        const dockWide = L.portrait ? (bossNow || !getNextTier()) : bossNow;
        if (L.portrait && dockWide) {
            L.viewport.y = L.panel.py + L.panel.recessTop + 10;
            L.viewport.h = L.panel.recessBot - L.panel.recessTop - 10 - L.dock.h - L.dock.gap;
            L.hud.mapBtn = { x: L.dock.x, y: L.dock.y, w: L.dock.bossSideW, h: L.dock.h };
            L.hud.craftBtn = { x: L.dock.x + L.dock.bossSideW + L.dock.gap, y: L.dock.y, w: L.dock.bossSideW, h: L.dock.h };
        }
        Object.assign(VIEWPORT, L.viewport);
        // Портретный масштаб кеглей: 390px -> 1.8, 720px -> 1.0 (FIT-даунскейл
        // съедает мелкий шрифт на телефонах — замечание игрока R7-R9)
        this._adaptiveScale = L.portrait ? Phaser.Math.Clamp(720 / (this.scale.displaySize.width || 720), 1.0, 1.8) : 1.0;
        const s = this._adaptiveScale;
        const tierIcon = TIERS[gameState.tier].iconKey;

        this.applyHudLayout(L, s, tierIcon);
        this.applyPanelLayout(L, s);
        this.applyUnlockLayout(L, s, dockWide);
        this.applyGearLayout();
        this.applyModalsLayout(L);
        this.applyMapLayout(L, s);
        this.applySettingsTextLayout(L);

        if (this.tutDim) {
            this.tutDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
            if (this.tutCam) this.tutCam.setViewport(0, 0, L.W, L.H);
            this.layoutTutorial();
        }
        if (this.tutorialStep === 3 && this.tutFinal) this.showTutorialFinal();
        // Политика видимости панели — ПОСЛЕДНИМ шагом: перекрывает всё, что
        // раскладка выше выставила видимым, пока открыт оверлей
        this.applyPanelVisibility();
    },

    // Портрет: при любой блокировке (модалка/бой) панель улучшений скрывается
    // целиком — под затемнением не остаётся «пустого лотка» (жалоба игрока на
    // «серую тень»). HUD остаётся видимым. Восстановление — через applyLayout,
    // который заново выставляет легитимные видимости (chromeHidden и пр.)
    applyPanelVisibility() {
        const hide = !!(this.L && this.L.portrait && this._blockLocked);
        if (hide === this._panelHidden) return;
        this._panelHidden = hide;
        const els = [
            this.panelImg, this.panelTitle, this.starsText, this.viewportBg,
            this.tierLabel, this.amountC, this.hint,
            this.mapBtn, this.mapLbl, this.craftBtn, this.craftLbl,
            this.unlockBtn, this.unlockText
        ];
        for (const t of this.tabBtns) els.push(t.c);
        if (!hide) {
            // Восстановление ЯВНОЕ: applyLayout не пере-показывает mapBtn/
            // starsText/viewportBg (у них нет пер-кадровых setVisible) —
            // сначала всё видно, затем applyLayout откатит state-зависимое
            // (в бою хром скрыт, hint в портрете всегда скрыт — refreshUi)
            for (const o of els) if (o) o.setVisible(true);
            this.applyLayout();
            return;
        }
        for (const o of els) if (o) o.setVisible(false);
        if (this.listContent) this.listContent.setVisible(false);
        if (this.gearContent) this.gearContent.setVisible(false);
    }
};
