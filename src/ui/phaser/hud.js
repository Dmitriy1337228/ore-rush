import Phaser from 'phaser';
import {
    gameState,
    TIERS,
    getClickDamage,
    getOrePerSecond,
    getSynergyGain,
    getCritChance,
    getPrestigeMult,
    fmt
} from '../../state.js';
import { addImg, makeLabel, fitFontSize, setHitRect, setHitWorld } from './uiKit.js';
import { addButton } from './button.js';
import { tierLabelText } from '../../state/upgradesMessages.js';
import { TEXT, DEPTH, TEX, HIT, REG, FONT_SIZE, SPACE, TOUCH_MIN } from '../shared/theme.js';
import { measureIcon } from '../shared/iconMetrics.js';

// Пол ужина строки статов в ландшафте (min fitFontSize; измерительная строка
// минимальной ширины статов — см. refreshHud)
const STATS_MIN_SIZE = 10;

export const hudMethods = {
    buildHud() {
        // Бар 1250x112 изображением (пропорции текстуры сохранены).
        // Врезка source 41..171 (темная зона) -> при масштабе 112/225=0.4978 рисуется
        // в y 30..95 (центр 62.5). Пары текстов выровнены по нижней кромке (origin 0,1):
        // так совпадают базовые линии шрифтов разных размеров.
        // Позиции — ландшафтные; applyLayout переставляет под ориентацию.
        const h = this.L.hud;
        this.hudBar = addImg(this, h.barX, h.barY, 'hud_bar_background', h.barW, h.barH, 10);

        this.oreIcon = this.add.image(h.iconX, h.centerY, TIERS[gameState.tier].iconKey).setDepth(DEPTH.ui);
        this.placeIcon(this.oreIcon, TIERS[gameState.tier].iconKey, h.iconX, h.centerY, h.iconSize);
        this.coalText = makeLabel(this, h.counterX, h.counterY, '0', FONT_SIZE.display, TEXT.white);
        this.coalText.setOrigin(0, 1).setDepth(DEPTH.ui);
        this.oreName = makeLabel(this, 0, h.counterY, TIERS[gameState.tier].name, FONT_SIZE.captionLg, TEXT.soft);
        this.oreName.setOrigin(0, 1).setDepth(DEPTH.ui); // x обновляется от ширины счётчика

        this.gpsIcon = this.add.image(h.gpsIconX, h.gpsIconY, TIERS[gameState.tier].iconKey).setDepth(DEPTH.ui);
        this.placeIcon(this.gpsIcon, TIERS[gameState.tier].iconKey, h.gpsIconX, h.gpsIconY, h.gpsIconSize);
        this.gpsText = makeLabel(this, h.gpsTextX, h.gpsTextY, '', FONT_SIZE.accent, TEXT.income);
        this.gpsText.setOrigin(0, 1).setDepth(DEPTH.ui);
        this.statsLine = makeLabel(this, 0, h.statsY, '', FONT_SIZE.label, TEXT.soft);
        this.statsLine.setOrigin(0, 1).setDepth(DEPTH.ui); // x обновляется от ширины gps
        // Кеш портретной сетки HUD: ключ пересчёта ставки/статов и поправки базовых линий
        this._hudKey = null;
        this._hudStatsKey = null;
        this._hudStatsSize = FONT_SIZE.stat;
        // Звёзды престижа: фиксированная зона ПЕРЕД кнопкой «Настройки» (правый край,
        // origin 1,0.5 — растут влево, не наезжают на кнопку). Зазор до кнопки 12px.
        this.starsText = makeLabel(this, h.starsRight, h.starsY, '', FONT_SIZE.stat, TEXT.gold);
        this.starsText.setOrigin(1, 0.5).setDepth(DEPTH.ui);

        // Кнопка «Настройки»: изображение h.btnW x h.btnH, центр по врезке (centerY),
        // внутри горизонтальной врезки бара (source face 47..1844 -> drawn 47..1234)
        const btnW = h.btnW;
        const btnH = h.btnH;
        const btnX = 1234 - SPACE.sm - btnW; // 1234 — правый край врезки бара (face source)
        const btnY = h.centerY - btnH / 2;
        this.settingsBtn = addImg(this, btnX, btnY, TEX.buttonDisabled, btnW, btnH, 11);
        // Hit-area в координатах кадра текстуры (origin 0.5 + setDisplaySize:
        // локальные координаты ввода — кадр 260x133, не отображаемый размер)
        setHitRect(this.settingsBtn, 260, 133);
        // Шестерёнка + подпись: зазор 10px между иконкой и текстом. Иконка
        // нормируется setDisplaySize (текстуры разного разрешения), подпись —
        // с левым якорем: раньше она упиралась в шестерёнку вплотную (скрин игрока)
        this.settingsGear = this.add
            .image(btnX + h.gearDx, h.centerY, 'gear_icon')
            // 26 — диаметр шестерёнки в кнопке
            .setDisplaySize(26, 26)
            .setDepth(DEPTH.uiAbove);
        this.settingsLbl = makeLabel(this, btnX + h.labelDx, h.centerY, 'Настройки', FONT_SIZE.stat, TEXT.white)
            .setOrigin(0, 0.5)
            .setDepth(DEPTH.uiAbove);
        this.settingsBtn.on('pointerdown', () => {
            this.openModal();
        });
        this.settingsBtn.on('pointerover', () => this.settingsBtn.setAlpha(0.9));
        this.settingsBtn.on('pointerout', () => this.settingsBtn.setAlpha(1));

        // Кнопки «Карта» и «Крафт» слева от «Настройки» (позиции из L.hud в
        // applyLayout). Button (kind image): addImg центрирует — центры
        // (mapBtn/craftBtn.x + w/2, y + h/2); hit — кадр текстуры, как раньше.
        ({ bg: this.mapBtn, label: this.mapLbl } = addButton(
            this,
            h.mapBtn.x + h.mapBtn.w / 2,
            h.mapBtn.y + h.mapBtn.h / 2,
            {
                kind: 'image',
                w: h.mapBtn.w,
                h: h.mapBtn.h,
                key: TEX.button,
                depth: 11,
                text: 'Карта',
                fontSize: FONT_SIZE.label,
                color: TEXT.white,
                hitW: HIT.button[0],
                hitH: HIT.button[1]
            }
        ));
        this.mapLbl.setDepth(DEPTH.uiAbove);
        this.mapBtn.on('pointerdown', () => this.openMap());
        this.mapBtn.on('pointerover', () => this.mapBtn.setAlpha(0.9));
        this.mapBtn.on('pointerout', () => this.mapBtn.setAlpha(1));

        ({ bg: this.craftBtn, label: this.craftLbl } = addButton(
            this,
            h.craftBtn.x + h.craftBtn.w / 2,
            h.craftBtn.y + h.craftBtn.h / 2,
            {
                kind: 'image',
                w: h.craftBtn.w,
                h: h.craftBtn.h,
                key: TEX.button,
                depth: 11,
                text: 'Крафт',
                fontSize: FONT_SIZE.label,
                color: TEXT.white,
                hitW: HIT.button[0],
                hitH: HIT.button[1]
            }
        ));
        this.craftLbl.setDepth(DEPTH.uiAbove);
        this.craftBtn.on('pointerdown', () => this.openCraft());
        this.craftBtn.on('pointerover', () => this.craftBtn.setAlpha(0.9));
        this.craftBtn.on('pointerout', () => this.craftBtn.setAlpha(1));

        // Активные дневные бафы с обратным отсчётом (под HUD-баром): «x2 9:59 · жила 1:59».
        // Пустая строка, когда бафов нет; setText только при смене строки.
        this.buffLine = makeLabel(this, h.barX, h.barY + h.barH + 6, '', FONT_SIZE.captionLg, TEXT.gold); // 6 — зазор под баром
        this.buffLine.setOrigin(0, 0).setDepth(DEPTH.ui);
        this._buffLineText = '';
    },

    // Активные дневные бафы: строка под HUD-баром «x2 9:59 · жила 1:59 · крит 4:31».
    // setText только при смене строки (каждый кадр иначе перерисовывал бы канвас-текст).
    updateBuffLine() {
        const parts = [];
        const left = (until) => {
            const sec = Math.max(0, Math.ceil((until - Date.now()) / 1000));

            return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        };
        if (Date.now() < gameState.dailyBuffUntil) {
            parts.push(`x${gameState.dailyBuffMult} ${left(gameState.dailyBuffUntil)}`);
        }

        if (Date.now() < gameState.dailyVeinUntil) {
            parts.push(`жила ${left(gameState.dailyVeinUntil)}`);
        }

        if (Date.now() < gameState.dailyCritUntil) {
            parts.push(`крит ${left(gameState.dailyCritUntil)}`);
        }

        // Бафы предметов (мастерская): множитель добычи, бомба (бой), стимулятор жилы
        if (Date.now() < gameState.miningBuffUntil) {
            parts.push(`x${gameState.miningBuffMult} ${left(gameState.miningBuffUntil)}`);
        }

        if (Date.now() < gameState.bossBuffUntil) {
            parts.push(`бомба ${left(gameState.bossBuffUntil)}`);
        }

        if (Date.now() < gameState.itemVeinUntil) {
            parts.push(`жила ${left(gameState.itemVeinUntil)}`);
        }

        const text = parts.join(' · ');
        if (text !== this._buffLineText) {
            this._buffLineText = text;
            this.buffLine.setText(text);
        }
    },

    placeIcon(icon, key, cx, cy, size = 40) {
        // Размер контента нормируется к `size` px: текстуры руд разного разрешения
        // (от 30 до 256px канваса) должны отображаться одинаково во всех местах UI.
        const m = this.iconMetrics(key);
        icon.setTexture(key);
        icon.setCrop(m.cropX, m.cropY, m.cropW, m.cropH);
        icon.setScale(size / Math.max(m.cropW, m.cropH));
        icon.setPosition(cx, cy);
    },

    // Единый визуальный размер и ЦЕНТРИРОВКА иконок по КОНТЕНТУ (см. ui/shared/iconMetrics.js);
    // метрики кешируются на сцене по ключу текстуры.
    iconMetrics(key) {
        if (!this._iconMetrics[key]) {
            this._iconMetrics[key] = measureIcon(this.textures, key);
        }

        return this._iconMetrics[key];
    },

    // Шапка: HUD-бар, счётчик, ставка, кнопки «Настройки/Карта/Крафт»
    applyHudLayout(L, s, tierIcon) {
        // HUD: бар на всю ширину сетки (в ландшафте — прежние 1250px по центру)
        const h = L.hud;
        this.hudBar.setPosition(h.barX + h.barW / 2, h.barY + h.barH / 2);
        this.hudBar.setDisplaySize(h.barW, h.barH);
        // Строка бафов — сразу под нижней кромкой HUD-бара
        this.buffLine.setPosition(h.barX + 10, h.barY + h.barH + 6);
        this.placeIcon(this.oreIcon, tierIcon, h.iconX, h.centerY, h.iconSize);
        if (L.portrait) {
            // Кегли портрета не ужимаются ниже читаемых (min: счётчик 30, имя 14, статы 16)
            const coalSize = Phaser.Math.Clamp(Math.round(FONT_SIZE.display * s), 30, 36);
            const nameSize = Phaser.Math.Clamp(Math.round(FONT_SIZE.label * s), 14, 16);
            const gpsSize = h.gpsSize;
            // Поправка базовой линии: origin(0,1) выравнивает низ БОКСА, а у крупного
            // кегля глубже спуск -> мелкие тексты строки 1 поднимаем на ~0.2*разницу кеглей
            const fix = (sz) => Math.round((coalSize - sz) * 0.2);
            this.coalText.setFontSize(coalSize);
            this.coalText.setOrigin(0, 1).setPosition(h.counterX, h.row1Y);
            this.oreName.setFontSize(nameSize);
            this.oreName.setOrigin(0, 1).setPosition(h.counterX, h.row1Y - fix(nameSize));
            // Ставка: правый край (origin 1,1), x и иконка ставятся в refreshUi
            this.gpsText.setFontSize(gpsSize);
            this.gpsText.setOrigin(1, 1).setPosition(h.counterX, h.row1Y - fix(gpsSize));
            this.placeIcon(
                this.gpsIcon,
                tierIcon,
                h.counterX,
                h.row1Y - fix(gpsSize) - Math.round(gpsSize * 0.6),
                h.gpsIconSize
            );
            // Статы: строка 2, общий левый край со счётчиком
            this._hudStatsSize = Phaser.Math.Clamp(Math.round(FONT_SIZE.label * s), 16, 18);
            this.statsLine.setFontSize(this._hudStatsSize);
            this.statsLine.setOrigin(0, 1).setPosition(h.statsXBase, h.row2Y);
            this.starsText.setFontSize(Phaser.Math.Clamp(Math.round(FONT_SIZE.stat * s), 16, 22));
            this.buffLine.setFontSize(Phaser.Math.Clamp(Math.round(FONT_SIZE.captionLg * s), 13, 20));
        } else {
            this.coalText.setPosition(h.counterX, h.counterY);
            this.oreName.setPosition(h.counterX, h.counterY);
            // Доход и клик/крит — в ландшафте в одну строку
            this.placeIcon(this.gpsIcon, tierIcon, h.gpsIconX, h.gpsIconY, h.gpsIconSize);
            this.gpsText.setOrigin(0, 1).setPosition(h.gpsTextX, h.gpsTextY);
            this.gpsText.setFontSize(h.gpsSize);
            this.statsLine.setOrigin(0, 1).setPosition(h.statsXBase, h.statsY);
            this.coalText.setFontSize(FONT_SIZE.display);
            this.oreName.setFontSize(FONT_SIZE.captionLg);
            this.statsLine.setFontSize(h.statsSize);
            // Кегль сброшен — кеш ужина статов обязан инвалидироваться, иначе
            // после applyLayout (босс-бой) refreshUi пропускает ужин и длинные
            // статы наезжают на «Карта» (поймано аудитом сценария 19)
            this._statsFitKey = null;
            this.starsText.setFontSize(FONT_SIZE.stat);
            this.buffLine.setFontSize(FONT_SIZE.captionLg);
        }

        this.statsLine.setVisible(h.statsVisible);
        // Кегль/позиции сброшены — кеши ужина обязаны инвалидироваться
        this._statsFitKey = null;
        this._gpsFitKey = null;
        this._hudKey = null;
        this._hudStatsKey = null;
        const btnX = h.btnX;
        if (L.portrait) {
            // «Настройки»: растёт от правого края (кегль и высота с клампом
            // под врезку бара), звёзды в портрете на панели — место свободно
            const sBtn = Math.min(s, 1.25);
            const bw = Math.round(h.btnW * sBtn);
            const bh = Phaser.Math.Clamp(Math.round(h.btnH * sBtn), h.btnH, 64);
            const right = h.btnX + h.btnW;
            this.settingsBtn.setPosition(right - bw / 2, h.centerY);
            this.settingsBtn.setDisplaySize(bw, bh);
            this.settingsGear.setPosition(right - bw + Math.round(h.gearDx * sBtn), h.centerY);
            this.settingsGear.setDisplaySize(Math.round(26 * sBtn), Math.round(26 * sBtn));
            this.settingsLbl.setPosition(right - bw + Math.round(h.labelDx * sBtn), h.centerY);
            fitFontSize(this.settingsLbl, FONT_SIZE.stat * sBtn, bw - Math.round(h.labelDx * sBtn) - SPACE.sm, 14);
        } else {
            this.settingsBtn.setPosition(btnX + h.btnW / 2, h.centerY);
            this.settingsBtn.setDisplaySize(h.btnW, h.btnH);
            this.settingsGear.setPosition(btnX + h.gearDx, h.centerY);
            this.settingsGear.setDisplaySize(26, 26); // 26 — диаметр шестерёнки в кнопке
            this.settingsLbl.setPosition(btnX + h.labelDx, h.centerY);
            this.settingsLbl.setFontSize(FONT_SIZE.stat);
        }

        this.mapBtn.setPosition(h.mapBtn.x + h.mapBtn.w / 2, h.mapBtn.y + h.mapBtn.h / 2);
        this.mapBtn.setDisplaySize(h.mapBtn.w, h.mapBtn.h);
        this.mapLbl.setPosition(h.mapBtn.x + h.mapBtn.w / 2, h.mapBtn.y + h.mapBtn.h / 2);
        this.craftBtn.setPosition(h.craftBtn.x + h.craftBtn.w / 2, h.craftBtn.y + h.craftBtn.h / 2);
        this.craftBtn.setDisplaySize(h.craftBtn.w, h.craftBtn.h);
        this.craftLbl.setPosition(h.craftBtn.x + h.craftBtn.w / 2, h.craftBtn.y + h.craftBtn.h / 2);
        // Зона нажатия кнопок шапки не ниже TOUCH_MIN по высоте: картинки 48-60px
        // дают 26-33 CSS px на телефоне (картинка не меняется)
        for (const btn of [this.settingsBtn, this.mapBtn, this.craftBtn]) {
            setHitWorld(btn, btn.displayWidth, Math.max(btn.displayHeight, TOUCH_MIN));
        }

        if (L.portrait) {
            // Док: крупные кнопки (150/306 x 92), кегль от масштаба с читаемым минимумом
            this.mapLbl.setFontSize(Phaser.Math.Clamp(Math.round(FONT_SIZE.label * s), 16, 26));
            this.craftLbl.setFontSize(Phaser.Math.Clamp(Math.round(FONT_SIZE.label * s), 16, 26));
        } else {
            this.mapLbl.setFontSize(FONT_SIZE.label);
            this.craftLbl.setFontSize(FONT_SIZE.label);
        }
    },

    // Шапка: счётчик руды, ставка, статы, звёзды, подпись тира
    refreshHud() {
        const tier = TIERS[gameState.tier];
        const h = this.L.hud;

        this.coalText.setText(fmt(gameState.ore));
        if (this.oreIcon.texture.key !== tier.iconKey) {
            this.placeIcon(this.oreIcon, tier.iconKey, h.iconX, h.centerY, h.iconSize);
        }

        this.oreName.setText(tier.name.toLowerCase());
        this.oreName.x = h.counterX + this.coalText.width + (this.L.portrait ? h.nameGap : 10);
        // Ставка = фактическая фоновая добыча (пассив × множитель мутации)
        const rate = fmt(getOrePerSecond() * (this.registry.get(REG.passiveMult) || 1));
        this.starsText.setText(gameState.stars > 0 ? `★ ${gameState.stars} (x${getPrestigeMult().toFixed(1)})` : '');
        const clickTxt = fmt(getClickDamage() + getSynergyGain());
        const critPct = Math.round(getCritChance() * 100);

        if (this.L.portrait) {
            // Правый предел текстов HUD — левый край «Настроек» минус gapR
            const limitR = Math.round(this.settingsBtn.x - this.settingsBtn.displayWidth / 2 - h.gapR);
            const nameRight = Math.round(this.oreName.x + this.oreName.width);
            // Ставка (строка 1, справа): ужин/компакт только при смене ключа
            const gpsKey = `${rate}|${limitR}|${nameRight}|${tier.iconKey}`;
            if (gpsKey !== this._hudKey) {
                this._hudKey = gpsKey;
                // Доступная ширина под текст ставки: от имени руды до предела за вычетом иконки
                const avail = limitR - (nameRight + h.midGap) - h.gpsIconSize - h.gpsIconGap;
                this.gpsText.setText(`+${rate} руды/сек`);
                fitFontSize(this.gpsText, h.gpsSize, avail, 16);
                if (this.gpsText.width > avail) {
                    // Кегль не ужимаем ниже 16: сокращаем формулировку
                    this.gpsText.setText(`+${rate}/сек`);
                    fitFontSize(this.gpsText, h.gpsSize, avail, 14);
                }
            }

            this.gpsText.x = limitR;
            const gIconX = limitR - this.gpsText.width - h.gpsIconGap - h.gpsIconSize / 2;
            const gIconY = Math.round(this.gpsText.y - this.gpsText.height / 2);
            if (this.gpsIcon.texture.key !== tier.iconKey) {
                this.placeIcon(this.gpsIcon, tier.iconKey, gIconX, gIconY, h.gpsIconSize);
            } else {
                this.gpsIcon.setPosition(gIconX, gIconY);
            }

            // Статы (строка 2): левый край = counterX, предел — limitR
            const statsTxt = `клик ${clickTxt} · крит ${critPct}%`;
            const statsKey = `${statsTxt}|${limitR}`;
            if (statsKey !== this._hudStatsKey) {
                this._hudStatsKey = statsKey;
                this.statsLine.setText(statsTxt);
                fitFontSize(this.statsLine, this._hudStatsSize, limitR - h.statsXBase, 14);
            }

            this.statsLine.x = h.statsXBase;
        } else {
            // Ландшафт: ставка и статы одной строкой; правый предел — левый край
            // «Карты» минус зазор. Форма ставки двухступенчатая (как в портрете):
            // если статы после полной «+N руды/сек» не влезают даже на минимуме
            // ужина (10px) — короткая «+N/сек»; иначе статы наезжали на кнопку
            // «Карта» при больших числах (аудит stress/settings-stress)
            const gx = Math.max(h.gpsIconX, this.oreName.x + this.oreName.width + 14);
            if (this.gpsIcon.texture.key !== tier.iconKey) {
                this.placeIcon(this.gpsIcon, tier.iconKey, gx, h.centerY, h.gpsIconSize);
            } else {
                this.gpsIcon.x = gx;
            }

            const limitR = h.mapBtn.x - SPACE.sm;
            const statsTxt = `клик: ${clickTxt} · крит: ${critPct}%`;
            // Минимальная ширина статов — меряем внеэкранной строкой, не трогая
            // боевую (её кегль/текст ставит key-guarded ужин ниже)
            if (!this._hudMeasure) {
                this._hudMeasure = makeLabel(this, 0, -2000, '', STATS_MIN_SIZE, '#ffffff').setVisible(false);
            }

            this._hudMeasure.setFontSize(STATS_MIN_SIZE).setText(statsTxt);
            const statsMinW = Math.ceil(this._hudMeasure.width);
            const gpsX = gx + 20;
            this.gpsText.setText(`+${rate} руды/сек`);
            this.gpsText.x = gpsX;
            if (gpsX + this.gpsText.width + 26 + statsMinW > limitR) {
                this.gpsText.setText(`+${rate}/сек`);
                this.gpsText.x = gpsX;
            }

            this.statsLine.x = this.gpsText.x + this.gpsText.width + 26;
            const statsKey = `${statsTxt}|${Math.round(this.statsLine.x)}`;
            if (statsKey !== this._statsFitKey) {
                this._statsFitKey = statsKey;
                this.statsLine.setText(statsTxt);
                fitFontSize(this.statsLine, this.L.hud.statsSize, limitR - this.statsLine.x, STATS_MIN_SIZE);
            }
        }

        this.updateBuffLine();
        // x звёзд фиксирован (правый край перед кнопкой «Настройки»), не двигается от статов
        // Имя руды бывает длинным («Серебро», «Уранит») — ужинаем кегль строки
        // тира, чтобы текст не заходил под кнопку мультипокупки (скриншот игрока).
        // Пересчёт только при смене текста (строка меняется раз в спуск).
        // Портрет: короткий формат («Шахта 1 · Уголь») под кегль 22 — полный
        // «уровень шахты: …» ужинался до ~7 экранных px (ревью читаемости)
        const tierText = tierLabelText(gameState.tier, tier.name, this.L.portrait);
        if (this._tierText !== tierText) {
            this._tierText = tierText;
            this.tierLabel.setText(tierText);
            const p = this.L.panel;
            const btnLeft = this.L.viewport.x + this.L.viewport.w - p.amountPadRight - p.amountW;
            const maxW = btnLeft - this.tierLabel.x - 10;
            let size = p.tierLabelSize;
            this.tierLabel.setFontSize(size);
            while (size > 10 && this.tierLabel.width > maxW) {
                size -= 1;
                this.tierLabel.setFontSize(size);
            }
        }
    }
};
