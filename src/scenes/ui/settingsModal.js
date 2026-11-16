import Phaser from 'phaser';
import {
    gameState, TIERS, getOfflineRate, getOfflineCapSeconds, canPrestige, getStarsGain, doPrestige, PRESTIGE_REQUIREMENT, getPrestigeMult, DIAMOND_INDEX, resetGame, saveGame, fmt
} from '../../state.js';
import { makeLabel, addScreenDim, DIM_ALPHA, addModalContainer } from '../../ui/uiKit.js';
import { addButton } from '../../ui/button.js';
import { createPanel } from '../../ui/panel.js';
import { TEXT, DEPTH, TEX, EVENTS, REG, FONT_SIZE, SPACE } from '../../ui/theme.js';
import { playSfx } from '../../sfx.js';

export const settingsModalMethods = {
    buildModal() {
        const pw = 560;
        const ph = 600;
        this.modalDim = addScreenDim(this, DIM_ALPHA.screen)
            .setDepth(DEPTH.screenDim).setVisible(false).setInteractive();
        this.modalDim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());

        this.modal = addModalContainer(this).setDepth(DEPTH.screen).setVisible(false);

        // Врезка панели (image): content y -261..249, x -216..216 (контейнерные координаты).
        // Крестик в правом верхнем углу: заходит за врезку в зону рамки, не задевая заклёпку
        const win = createPanel(this, {
            w: pw, h: ph, title: 'Настройки', titleY: -232, titleSize: FONT_SIZE.display,
            close: { x: pw / 2 - 60, y: -228, onClose: () => this.closeModal() }
        });
        const panel = win.panel;
        const title = win.title;
        const closeBtn = win.close;

        this.modalStats = makeLabel(this, -pw / 2 + 56, -186, '', FONT_SIZE.body, TEXT.pale, { lineSpacing: 5 });
        this.modalStats.setOrigin(0, 0);

        // Звук (эффекты) и Музыка (фон): два тумблера в ряд
        const tbW = 200;
        const tbH = 44;
        // Хит 80 по высоте (44 видимых — 22-24 CSS px на телефоне); по горизонтали
        // не расширяем (между тумблерами зазор 10) — зона ниже уходит под
        // интерактивный слайдер громкости, он выше по порядку отрисовки и
        // корректно забирает пересечение
        ({ bg: this.soundBtn, label: this.soundText } = addButton(this, -105, -34, {
            w: tbW, h: tbH, key: TEX.button,
            text: 'Звук: вкл', fontSize: FONT_SIZE.body, color: TEXT.white,
            fitMaxW: tbW - SPACE.lg * 2,
            hitWorld: true, hitH: 80
        }));
        this.soundBtn.on('pointerdown', () => {
            gameState.soundOn = !gameState.soundOn;
            this.refreshSoundToggle();
            if (gameState.soundOn) playSfx(this, 'purchase'); // подтверждение включения
            saveGame();
            this.refreshUi();
        });

        ({ bg: this.musicBtn, label: this.musicText } = addButton(this, 105, -34, {
            w: tbW, h: tbH, key: TEX.button,
            text: 'Музыка: вкл', fontSize: FONT_SIZE.body, color: TEXT.white,
            fitMaxW: tbW - SPACE.lg * 2,
            hitWorld: true, hitH: 80
        }));
        this.musicBtn.on('pointerdown', () => {
            gameState.musicOn = !gameState.musicOn;
            this.refreshMusicControls();
            this.game.events.emit(EVENTS.musicChanged);
            saveGame();
            this.refreshUi();
        });

        // Громкость музыки: слайдер (musicVolume 0..1, применяется на каждый сдвиг)
        this.volLabel = makeLabel(this, -150, 14, 'Громкость:', FONT_SIZE.label, TEXT.soft).setOrigin(0.5);
        this.volG = this.add.graphics(); // трек -60..120 (180), заливка и ручка перерисовываются
        this.volPct = makeLabel(this, 170, 14, '50%', FONT_SIZE.label, TEXT.bright).setOrigin(0.5);
        const volZone = this.add.zone(-66, -8, 192, 44).setOrigin(0, 0).setInteractive();
        const seekVolume = (gameX) => {
            // Контейнер модалки ставит applyLayout (в портрете со масштабом k):
            // левый край трека = modal.x - 60*k, длина 180*k
            const k = this._modalScale || 1;
            gameState.musicVolume = Phaser.Math.Clamp((gameX - (this.modal.x - 60 * k)) / (180 * k), 0, 1);
            this.refreshMusicControls();
            this.game.events.emit(EVENTS.musicChanged);
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
        const presTitle = makeLabel(this, 0, 48, 'Сброс шахты (Rebirth)', FONT_SIZE.accent, TEXT.cream).setOrigin(0.5, 0);
        this.prestigeInfo = makeLabel(this, 0, 82, '', FONT_SIZE.label, TEXT.pale, { align: 'center', wordWrap: { width: pw - 120 }, lineSpacing: 6 });
        this.prestigeInfo.setOrigin(0.5, 0);

        const pbW = 300;
        const pbH = 50;
        // addNineC внутри addButton ставит origin (0.5): координата кнопки = её
        // центр, подпись — в тот же центр
        ({ bg: this.prestigeBtn, label: this.prestigeText } = addButton(this, 0, 158, {
            w: pbW, h: pbH, key: TEX.buttonDisabled,
            text: 'Сбросить шахту', fontSize: FONT_SIZE.button, color: TEXT.white,
            fitMaxW: pbW - SPACE.lg * 2
        }));
        this.prestigeBtn.on('pointerdown', () => this.tryPrestige());

        const rbW = 300;
        const rbH = 46;
        ({ bg: this.resetBtn, label: this.resetText } = addButton(this, 0, 216, {
            w: rbW, h: rbH, key: TEX.buttonDisabled,
            text: 'Сбросить весь прогресс', fontSize: FONT_SIZE.body, color: TEXT.white,
            fitMaxW: rbW - SPACE.lg * 2
        }));
        this.resetBtn.on('pointerdown', () => this.tryReset());

        this.modal.add([panel, title, closeBtn, this.modalStats, this.soundBtn, this.soundText, this.musicBtn, this.musicText, this.volLabel, this.volG, this.volPct, volZone, presTitle, this.prestigeInfo, this.prestigeBtn, this.prestigeText, this.resetBtn, this.resetText]);
        this.prestigeArmed = false;
        this.resetArmed = false;
    },

    refreshSoundToggle() {
        if (!this.soundBtn) return;
        this.soundBtn.setTexture(gameState.soundOn ? TEX.button : TEX.buttonDisabled);
        this.soundText.setText(gameState.soundOn ? 'Звук: вкл' : 'Звук: выкл');
        this.soundText.setColor(gameState.soundOn ? TEXT.white : TEXT.muted);
    },

    refreshMusicControls() {
        if (!this.musicBtn) return;
        this.musicBtn.setTexture(gameState.musicOn ? TEX.button : TEX.buttonDisabled);
        this.musicText.setText(gameState.musicOn ? 'Музыка: вкл' : 'Музыка: выкл');
        this.musicText.setColor(gameState.musicOn ? TEXT.white : TEXT.muted);
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
    },

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
    },

    closeModal() {
        this.modalDim.setVisible(false);
        this.modal.setVisible(false);
        this._settingsOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под настройками
    },

    tryPrestige() {
        if (this.registry.get(REG.bossActive)) return;
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
        this.game.events.emit(EVENTS.tierChanged);
        const float = this.spawnFloat(this.L.modal.cx, this.L.modal.cy - 60, `+${gain} ★ Множитель: x${getPrestigeMult().toFixed(1)}`, 26, TEXT.gold);
        float.setOrigin(0.5).setDepth(DEPTH.screenFloat);
        this.tweens.add({ targets: float, y: float.y - 60, alpha: 0, duration: 1600, onComplete: () => float.destroy() });
    },

    tryReset() {
        if (this.registry.get(REG.bossActive)) return;
        if (!this.resetArmed) {
            this.resetArmed = true;
            this.resetText.setText('Точно сбросить?');
            return;
        }
        resetGame();
        this.resetArmed = false;
        this.closeModal();
        this.game.events.emit(EVENTS.tierChanged);
        this.refreshUi();
        this.maybeRebuildTutorial();
    },

    // Модалки: затемнение на всю сетку, панели по центру, масштаб в портрете
    applyModalsLayout(L) {
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
        // Окно вырубания шахтёра — та же сетка модалок (иначе в портрете оно
        // уезжало за правый край экрана: координаты прибиты к ландшафту)
        this.playerDownDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        this.playerDownModal.setPosition(L.modal.cx, L.modal.cy);
        if (this.tutDim) this.tutDim.setPosition(L.modal.cx, L.modal.cy).setSize(L.W, L.H);
        if (L.portrait) {
            // Портрет: контейнерные модалки масштабируются в свободную зону
            // (zoneTop..zoneBot), иначе окно «маркой» на высоком телефоне.
            // Слайдер громкости в seekVolume учитывает _modalScale
            const mk = (pw0, ph0) => Math.min(1.45, (L.W - 24) / pw0, (L.modal.zoneBot - L.modal.zoneTop - 24) / ph0);
            this._modalScale = mk(560, 600);
            this.modal.setScale(this._modalScale);
            this.offlineModal.setScale(mk(480, 300));
            this.dailyModal.setScale(mk(520, 420));
            this.bossRewardModal.setScale(mk(480, 400));
            this.playerDownModal.setScale(mk(480, 330));
            // Окно вырубления масштабируется x1.45 — первая строка тела цепляла
            // нижний край заголовка «Ты вырубился!» (аудит, oy=2): опускаем
            // тело на 6 локальных px (~9 экранных)
            if (this.playerDownBody) this.playerDownBody.setY(-14);
        } else {
            this._modalScale = 1;
            this.modal.setScale(1);
            this.offlineModal.setScale(1);
            this.dailyModal.setScale(1);
            this.bossRewardModal.setScale(1);
            this.playerDownModal.setScale(1);
            if (this.playerDownBody) this.playerDownBody.setY(-20);
        }
    },

    // Кегли текста окна настроек по ориентации: в портрете поднимаем на ступень
    // шкалы FONT_SIZE (FIT-даунскейл ~0.52 на телефонах съедает кегль). Статам в
    // портрете достаётся кнопочный кегль, тумблерам — статовый.
    applySettingsTextLayout(L) {
        if (this.modalStats) {
            if (L.portrait) {
                this.modalStats.setFontSize(FONT_SIZE.button).setY(-196);
                this.prestigeInfo.setFontSize(FONT_SIZE.body);
                this.soundText.setFontSize(FONT_SIZE.stat);
                this.musicText.setFontSize(FONT_SIZE.stat);
                this.volLabel.setFontSize(FONT_SIZE.body);
                this.volPct.setFontSize(FONT_SIZE.body);
            } else {
                this.modalStats.setFontSize(FONT_SIZE.body).setY(-186);
                this.prestigeInfo.setFontSize(FONT_SIZE.label);
                this.soundText.setFontSize(FONT_SIZE.body);
                this.musicText.setFontSize(FONT_SIZE.body);
                this.volLabel.setFontSize(FONT_SIZE.label);
                this.volPct.setFontSize(FONT_SIZE.label);
            }
        }
    },

    // Окно настроек (если открыто): статы и престиж
    refreshSettingsModal() {
        const tier = TIERS[gameState.tier];
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
            const bossLocked = !!this.registry.get(REG.bossActive);
            if (canPrestige()) {
                // Компактные 2 строки (не 2+2 с переносом): при больших числах
                // «(постоянно +N0% к доходу)» удлиняло блок до 4-5 строк — текст
                // наезжал на кнопку престижа (аудит settings-stress). Бонус x10
                // и так виден в статах окна («Звёзды … — множитель»)
                this.prestigeInfo.setText(`За текущий забег: +${gain} ★\nСброс: руда, шахта и улучшения обнулятся.`);
                this.prestigeInfo.setY(80); // низ 2 строк (~130) не задевает кнопку (верх 133)
                this.prestigeBtn.setTexture(bossLocked ? TEX.buttonDisabled : TEX.button);
                this.prestigeText.setColor(bossLocked ? TEXT.muted : TEXT.white);
            } else {
                this.prestigeInfo.setY(82);
                const have = gameState.tierEarned[DIAMOND_INDEX];
                this.prestigeInfo.setText(`Для rebirth нужно добыть ${fmt(PRESTIGE_REQUIREMENT)} алмазов за забег.\nУ вас: ${fmt(have)} (${Math.floor(have / PRESTIGE_REQUIREMENT * 100)}%).`);
                this.prestigeBtn.setTexture(TEX.buttonDisabled);
                this.prestigeText.setColor(TEXT.muted);
            }
            this.resetText.setColor(bossLocked ? TEXT.muted : TEXT.white);
        }
    }
};
