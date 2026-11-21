import {
    gameState,
    TIERS,
    getUpgradeLevel,
    getOrePerSecond,
    getOfflineRate,
    OFFLINE_CAP_HOURS,
    DAILY_REWARDS,
    COMPONENTS,
    ARTIFACTS
} from '../../state.js';
import {
    statusTitles,
    statusButtons,
    offlineBody,
    dailyStreak,
    dailyDesc,
    bossRewardBounty,
    bossRewardSpeed,
    playerDownBody
} from '../../state/statusMessages.js';
import { makeLabel, addScreenDim, DIM_ALPHA, addModalContainer } from './uiKit.js';
import { addButton } from './button.js';
import { createPanel } from './panel.js';
import { stackDown } from './stack.js';
import { TEXT, DEPTH, TEX, REG, FONT_SIZE, SPACE } from '../shared/theme.js';

const OK_BUTTON = { w: 190, h: 46 };

// Каркас модального уведомления: затемнение (глотает клики), контейнер с панелью,
// заголовок и кнопка подтверждения. Содержимое окна докладывает вызывающий через
// assemble(extras, after): extras идут между заголовком и кнопкой, after — поверх кнопки.
function createAlertShell(scene, { w, h, title, titleY, titleColor = TEXT.cream, okLabel, okY, onOk }) {
    const dim = addScreenDim(scene, DIM_ALPHA.alert).setDepth(DEPTH.alertDim).setVisible(false).setInteractive();
    dim.on('pointerdown', (pointer, lx, ly, event) => event.stopPropagation());
    const modal = addModalContainer(scene).setDepth(DEPTH.alert).setVisible(false);
    const win = createPanel(scene, { w, h, title, titleY, titleSize: FONT_SIZE.title, titleColor });

    return {
        dim,
        modal,
        // кнопка создаётся после содержимого окна (порядок объектов сцены сохранён)
        assemble(extras, after = []) {
            const ok = addButton(scene, 0, okY, {
                w: OK_BUTTON.w,
                h: OK_BUTTON.h,
                key: TEX.button,
                text: okLabel,
                fontSize: FONT_SIZE.button,
                color: TEXT.white,
                fitMaxW: OK_BUTTON.w - SPACE.lg * 2,
                // Хит 80 по высоте (46 видимых — 23 CSS px на телефоне): зона
                // нажатия >= 40 CSS px; вокруг кнопки интерактивных нет
                hitWorld: true,
                hitH: 80
            });
            ok.bg.on('pointerdown', onOk);
            modal.add([win.panel, win.title, ...extras, ok.bg, ok.label, ...after]);
        }
    };
}

export const statusModalsMethods = {
    buildOfflineModal() {
        const pw = 480;
        // Врезка: content y -131..175 (контейнерные)
        const shell = createAlertShell(this, {
            w: pw,
            h: 300,
            title: statusTitles.offline,
            titleY: -114,
            okLabel: statusButtons.offline,
            okY: 96,
            onOk: () => this.hideOfflineModal()
        });
        this.offlineDim = shell.dim;
        this.offlineModal = shell.modal;
        this.offlineBody = makeLabel(this, 0, -15, '', FONT_SIZE.stat, TEXT.pale, {
            align: 'center',
            lineSpacing: 10,
            wordWrap: { width: pw - 110 }
        });
        this.offlineBody.setOrigin(0.5);
        shell.assemble([this.offlineBody]);
    },

    showOfflinePhaser(info) {
        const tier = TIERS[gameState.tier];
        const text = offlineBody({
            seconds: info.seconds,
            reward: info.reward,
            tierName: tier.name,
            ratePct: Math.round(getOfflineRate() * 100),
            orePerSec: getOrePerSecond(),
            capHours: OFFLINE_CAP_HOURS[Math.min(getUpgradeLevel('warehouse'), OFFLINE_CAP_HOURS.length - 1)],
            counted: info.counted
        });
        this.offlineBody.setText(text);
        this.offlineDim.setVisible(true);
        this.offlineModal.setVisible(true);
        this._offlineOpen = true;
        this.registry.set(REG.offlineInfo, null);
    },

    hideOfflinePhaser() {
        this.offlineDim.setVisible(false);
        this.offlineModal.setVisible(false);
        this._offlineOpen = false;
    },

    buildDailyModal() {
        // Врезка контента: y -180..180 (контейнерные)
        const shell = createAlertShell(this, {
            w: 520,
            h: 420,
            title: statusTitles.daily,
            titleY: -170,
            okLabel: statusButtons.daily,
            okY: 152,
            onOk: () => this.hideDailyModal()
        });
        this.dailyDim = shell.dim;
        this.dailyModal = shell.modal;
        this.dailyStreakText = makeLabel(this, 0, -132, '', FONT_SIZE.body, TEXT.soft).setOrigin(0.5);
        this.dailyIcon = this.add.image(0, -78, 'pickaxe_iron');
        this.dailyName = makeLabel(this, 0, -18, '', FONT_SIZE.itemName, TEXT.gold).setOrigin(0.5);
        // Верхний якорь (0.5, 0): конкретика дня добавляет 3-ю строку — текст
        // растёт ВНИЗ и не наезжает на название (перекрытие «Накопителя» поймано
        // скриншотом игрока)
        this.dailyDesc = makeLabel(this, 0, 12, '', FONT_SIZE.body, TEXT.pale, {
            align: 'center',
            lineSpacing: 8
        }).setOrigin(0.5, 0);
        // Серия: 7 слотов цикла, текущий день подсвечен. Иконки нормируем
        // placeIcon'ом — текстуры ассетов разного разрешения (30..256px).
        // Шаг центров = слот 34 + зазор SPACE.xs.
        this.dailySlots = [];
        const SLOT = 34;
        for (let i = 0; i < 7; i++) {
            const x = -114 + i * (SLOT + SPACE.xs);
            const slot = this.add.image(x, 82, 'icon_slot_frame').setDisplaySize(SLOT, SLOT);
            const ic = this.add.image(x, 82, DAILY_REWARDS[i].icon);
            this.placeIcon(ic, DAILY_REWARDS[i].icon, x, 82, 22);
            this.dailySlots.push({ slot, ic });
        }

        shell.assemble(
            [this.dailyStreakText, this.dailyIcon, this.dailyName, this.dailyDesc],
            [...this.dailySlots.map((s) => s.slot), ...this.dailySlots.map((s) => s.ic)]
        );
    },

    // Рендер дня из готового info (D4): очередь и выбор пути — фасад UIScene
    // (tryShowDailyModal), здесь только Phaser-отрисовка.
    showDailyPhaser(info) {
        const idx = (info.streak - 1) % DAILY_REWARDS.length;
        const reward = DAILY_REWARDS[idx];
        this.dailyStreakText.setText(dailyStreak(info.streak));
        this.dailyIcon.setTexture(reward.icon);
        this.placeIcon(this.dailyIcon, reward.icon, 0, -78, 64);
        // конкретика дня (руда «Накопителя» / выбранное улучшение) — внутри dailyDesc
        const desc = dailyDesc(reward, info);

        this.dailyName.setText(reward.name);
        this.dailyDesc.setText(desc);
        for (let i = 0; i < this.dailySlots.length; i++) {
            const s = this.dailySlots[i];
            const active = i === idx;
            s.ic.setTint(active ? 0xffffff : 0x606060);
            s.slot.setTint(active ? 0xffffff : 0x909090);
        }

        this.dailyDim.setVisible(true);
        this.dailyModal.setVisible(true);
        this._dailyOpen = true;
    },

    hideDailyPhaser() {
        this.dailyDim.setVisible(false);
        this.dailyModal.setVisible(false);
        this._dailyOpen = false;
    },

    buildBossRewardModal() {
        const shell = createAlertShell(this, {
            w: 480,
            h: 400,
            title: statusTitles['boss-reward'],
            titleY: -158,
            okLabel: statusButtons['boss-reward'],
            okY: 150,
            onOk: () => this.hideBossRewardModal()
        });
        this.bossRewardDim = shell.dim;
        this.bossRewardModal = shell.modal;
        this.bossRewardBounty = makeLabel(this, 0, -112, '', FONT_SIZE.button, TEXT.income).setOrigin(0.5);
        this.bossRewardSpeed = makeLabel(this, 0, -86, '', FONT_SIZE.label, TEXT.cream).setOrigin(0.5);
        this.bossRewardComps = this.add.container(0, 0);
        shell.assemble([this.bossRewardBounty, this.bossRewardSpeed, this.bossRewardComps]);

        // Top-level объекты созданы после buildMapScreen/buildCraftScreen — из
        // скролл-камер исключаем вручную (иначе сдвинутые копии окна во вьюпортах);
        // listCam накроет снапшотом setupListCamera, идущего после create()
        const bossLayers = [this.bossRewardDim, this.bossRewardModal];
        if (this.mapCam) {
            this.mapCam.ignore(bossLayers);
        }

        if (this.craftCam) {
            this.craftCam.ignore(bossLayers);
        }
    },

    showBossRewardPhaser(reward) {
        if (!reward) {
            return;
        }

        this._bossRewardOpen = true;
        if (this._mapOpen) {
            this.closeMap();
        }

        if (this._craftOpen) {
            this.closeCraft();
        }

        this.bossRewardComps.removeAll(true);
        this.bossRewardBounty.setText(bossRewardBounty(reward.bounty));
        // Бонус за скорость: «Время: 0:32 · бонус x1.50» — пусто, если время не передано
        const speedText = bossRewardSpeed(reward);
        if (speedText) {
            this.bossRewardSpeed.setText(speedText).setVisible(true);
        } else {
            this.bossRewardSpeed.setVisible(false);
        }

        // Список награды — вертикальный стек (stackDown): ячейка строки
        // компонента = иконка 30, зазор SPACE.md (шаг 42 — как прежде); блок
        // артефакта = ячейка иконки 42, зазор после последнего компонента 26
        // (эквивалент прежнего курсора «центр-на-центр 42+8»: центр имени на
        // 50 ниже центра последней строки). Внутри блока имя на 12 выше центра
        // иконки, описание на 22 ниже центра имени — как и было.
        const COMP_CELL = 30;
        const ART_CELL = 42;
        const ART_GAP = 26; // низ ячейки последнего компонента -> верх иконки артефакта
        const rows = [];
        const objs = [];
        let artifactAlone = false;
        for (const compId of Object.keys(reward.comps || {})) {
            const def = COMPONENTS.find((c) => c.id === compId);
            if (!def) {
                continue;
            }

            const icon = this.add.image(0, 0, def.icon);
            this.placeIcon(icon, def.icon, -120, 0, COMP_CELL); // позицию ставит place()
            const label = makeLabel(
                this,
                -94,
                0,
                `${def.name} ×${reward.comps[compId]}`,
                FONT_SIZE.body,
                TEXT.pale
            ).setOrigin(0, 0.5);
            objs.push(icon, label);
            rows.push({
                h: COMP_CELL,
                gapAfter: SPACE.md,
                place: (top) => {
                    icon.setPosition(-120, top + COMP_CELL / 2);
                    label.setPosition(-94, top + COMP_CELL / 2);
                }
            });
        }

        if (reward.artifactId) {
            const def = ARTIFACTS.find((a) => a.id === reward.artifactId);
            if (def) {
                // У артефактов нет поля icon (ТЗ: ключ текстуры = id)
                const icon = this.add.image(0, 0, def.id);
                this.placeIcon(icon, def.id, -120, 0, ART_CELL); // позицию ставит place()
                const name = makeLabel(this, -92, 0, def.name, FONT_SIZE.stat, TEXT.gold).setOrigin(0, 0.5);
                const desc = makeLabel(this, -92, 0, def.desc, FONT_SIZE.caption, TEXT.good).setOrigin(0, 0.5);
                objs.push(icon, name, desc);
                if (rows.length) {
                    rows[rows.length - 1].gapAfter = ART_GAP;
                } else {
                    artifactAlone = true; // награда без компонентов (verify-craft)
                }

                rows.push({
                    h: ART_CELL,
                    place: (top) => {
                        icon.setPosition(-120, top + ART_CELL / 2);
                        name.setPosition(-92, top + ART_CELL / 2 - 12);
                        desc.setPosition(-92, top + ART_CELL / 2 + 10);
                    }
                });
            }
        }

        if (rows.length) {
            // Артефакт без компонентов: прежний курсор не проходил цикл — блок
            // стоит на месте первой строки (центр имени -56, иконка -44)
            stackDown(rows, { top: artifactAlone ? -65 : -64 - COMP_CELL / 2 });
        }

        this.bossRewardComps.add(objs);
        this.bossRewardDim.setVisible(true);
        this.bossRewardModal.setVisible(true);
    },

    hideBossRewardPhaser() {
        this.bossRewardDim.setVisible(false);
        this.bossRewardModal.setVisible(false);
        this._bossRewardOpen = false;
    },

    buildPlayerDownModal() {
        const pw = 480;
        const shell = createAlertShell(this, {
            w: pw,
            h: 330,
            title: statusTitles['player-down'],
            titleY: -124,
            titleColor: '#ff8a7a',
            okLabel: statusButtons['player-down'],
            okY: 108,
            onOk: () => this.hidePlayerDownModal()
        });
        this.playerDownDim = shell.dim;
        this.playerDownModal = shell.modal;
        this.playerDownBody = makeLabel(this, 0, -20, '', FONT_SIZE.body, TEXT.pale, {
            align: 'center',
            lineSpacing: 9,
            wordWrap: { width: pw - 110 }
        }).setOrigin(0.5);
        shell.assemble([this.playerDownBody]);

        const layers = [this.playerDownDim, this.playerDownModal];
        if (this.mapCam) {
            this.mapCam.ignore(layers);
        }

        if (this.craftCam) {
            this.craftCam.ignore(layers);
        }
    },

    showPlayerDownPhaser(info) {
        if (!info) {
            return;
        }

        this._playerDownOpen = true;
        if (this._mapOpen) {
            this.closeMap();
        }

        if (this._craftOpen) {
            this.closeCraft();
        }

        this.playerDownBody.setText(
            playerDownBody({ bossName: info.bossName, dmg: info.dmg, maxPlayer: info.maxPlayer })
        );
        this.playerDownDim.setVisible(true);
        this.playerDownModal.setVisible(true);
    },

    hidePlayerDownPhaser() {
        this.playerDownDim.setVisible(false);
        this.playerDownModal.setVisible(false);
        this._playerDownOpen = false;
    }
};
