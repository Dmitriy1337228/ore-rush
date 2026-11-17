import { gameState, saveGame } from '../../state.js';
import { makeLabel, fitFontSize, addScreenDim, DIM_ALPHA, setHitWorld } from './uiKit.js';
import { TEXT, DEPTH, TEX, FONT_SIZE, SPACE } from '../shared/theme.js';

export const tutorialMethods = {
    buildTutorial() {
        if (gameState.tutorialDone) {
            return;
        }

        if (this.tutDim) {
            return;
        } // идемпотентность: не строим второй слой поверх

        this.tutorialStep = 0;
        this.tutClickStart = gameState.clicks;
        this.tutShownAt = 0;
        this.tutTabClicked = -1;
        // Учебные слои (38/39) — НАД игровым UI, но ПОД модалками (40/41/50/51):
        // иначе обучение перекрывало настройки/офлайн-окно у нового игрока
        this.tutDim = addScreenDim(this, DIM_ALPHA.tutorial).setDepth(DEPTH.tutorialDim);
        this.tutRing = this.add.graphics().setDepth(DEPTH.tutorial);
        this.tutArrow = this.add.graphics().setDepth(DEPTH.tutorial);
        this.tutBubble = this.add
            .rectangle(0, 0, 1, 1, 0x1c1620, 0.92)
            .setDepth(DEPTH.tutorial)
            .setStrokeStyle(2, 0xffd75e, 1);
        this.tutText = makeLabel(this, 0, 0, '', FONT_SIZE.body, TEXT.cream, { align: 'center' })
            .setOrigin(0.5)
            .setDepth(DEPTH.tutorial);
        this.tutFinal = makeLabel(this, 0, 0, 'Приятной игры!', FONT_SIZE.title, TEXT.cream)
            .setOrigin(0.5)
            .setDepth(DEPTH.tutorial)
            .setVisible(false);
        this.tutBtn = this.add
            .image(640, 400, TEX.button)
            .setDisplaySize(200, 56)
            .setDepth(DEPTH.tutorial)
            .setVisible(false);
        this.tutBtnLbl = makeLabel(this, 640, 400, 'Играть', FONT_SIZE.buttonLg, TEXT.white)
            .setOrigin(0.5)
            .setDepth(DEPTH.tutorial)
            .setVisible(false);
        // Хит 80 по высоте (56 видимых — 28-30 CSS px на телефоне); кнопка одиночная
        setHitWorld(this.tutBtn, 200, 80);
        this.tutBtn.input.cursor = 'pointer';
        this.tutBtn.on('pointerdown', () => this.finishTutorial());
        // клики по вкладкам: учебный шаг ждёт клик по нужной вкладке
        this.tabBtns[0].c.on('pointerdown', () => {
            this.tutTabClicked = 0;
        });
        this.tabBtns[1].c.on('pointerdown', () => {
            this.tutTabClicked = 1;
        });
        // список рендерит вторая камера — учебные объекты исключаем из неё
        // (и из скролл-камер карты/крафта — они создаются позже ignore-списков)
        const tutLayers = [
            this.tutDim,
            this.tutRing,
            this.tutArrow,
            this.tutBubble,
            this.tutText,
            this.tutFinal,
            this.tutBtn,
            this.tutBtnLbl
        ];
        this.listCam.ignore(tutLayers);
        if (this.mapCam) {
            this.mapCam.ignore(tutLayers);
        }

        if (this.craftCam) {
            this.craftCam.ignore(tutLayers);
        }

        // Своя камера учебных слоёв ПОВЕРХ listCam: listCam рендерит карточки
        // ПОСЛЕ main-камеры, и любой учебный объект в зоне вьюпорта списка
        // прячется ЗА ними (бабл шага «Покупай оборудование» исчезал в списке).
        // tutCam создаётся последней и рендерит ТОЛЬКО слои урока
        this.tutCam = this.cameras.add(0, 0, this.L.W, this.L.H, false, 'tutCam');
        this.tutCam.ignore(this.children.list.filter((o) => !tutLayers.includes(o)));
        this.cameras.main.ignore(tutLayers);
        this.tutPulse = this.tweens.add({
            targets: this.tutRing,
            alpha: { from: 1, to: 0.4 },
            duration: 700,
            yoyo: true,
            repeat: -1
        });
        this.tutBob = this.tweens.add({
            targets: this.tutArrow,
            y: { from: 0, to: 10 },
            duration: 650,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        this.layoutTutorial();
    },

    layoutTutorial() {
        this.tutRing.clear();
        this.tutArrow.clear();
        // Позиции — от ЖИВЫХ объектов (блок GameScene, вкладки): раскладка может
        // меняться (портрет/ландшафт), захардкоженные прямоугольники здесь недопустимы.
        const gs = this.scene.get('GameScene');
        const L = this.L;
        const s = this._adaptiveScale || 1;
        // Кегль бабла масштабируется с портретной сеткой: фикс 15px на телефоне
        // даёт ~8px на экране (FIT ~0.54) — подпись нечитаема (скриншот).
        // База 17 (не 15): бабл должен читаться КРУПНЕЕ описаний карточек
        const tutText = (txt) => this.tutText.setText(txt).setFontSize(Math.round(FONT_SIZE.button * Math.min(s, 1.5)));
        const ring = (x, y, w, h) => {
            this.tutRing.fillStyle(0xffd75e, 0.12);
            this.tutRing.fillRect(x, y, w, h);
            this.tutRing.lineStyle(3, 0xffd75e, 1);
            this.tutRing.strokeRect(x, y, w, h);
        };
        if (this.tutorialStep === 0) {
            // блок: подсветка + стрелка сверху + подпись
            const bx = gs.blockX,
                by = gs.blockY;
            ring(bx - 160, by - 160, 320, 320);
            if (L.portrait) {
                // Портрет: пузырь в зазор между HUD (низ barY+barH=122) и блоком
                // (верх by-141); на низкой сетке (H=1280, планшет) зазор мал —
                // клампим низ пузыря ниже кромки бара. Размер — от текста
                tutText('Кликай по кубику — добывай руду!');
                // Бабл: поля вокруг текста SPACE.lg с каждой стороны
                const bw0 = Math.min(this.tutText.width + SPACE.lg * 2, L.W - 20);
                fitFontSize(this.tutText, Math.round(FONT_SIZE.button * Math.min(s, 1.5)), bw0 - 28, 11);
                const bh0 = this.tutText.height + SPACE.lg;
                const by0 = Math.max(by - 185, L.hud.barY + L.hud.barH + SPACE.sm + Math.round(bh0 / 2));
                this.tutBubble.setPosition(bx, by0).setSize(bw0, bh0);
                this.tutText.setPosition(bx, by0);
                this.tutArrow.fillStyle(0xffd75e, 1);
                this.tutArrow.fillTriangle(bx - 14, by - 156, bx + 14, by - 156, bx, by - 146);
            } else {
                tutText('Кликай по кубику — добывай руду!');
                this.tutBubble
                    .setPosition(bx, by - 280)
                    .setSize(this.tutText.width + SPACE.lg * 2, this.tutText.height + SPACE.lg);
                this.tutText.setPosition(bx, by - 280);
                this.tutArrow.fillStyle(0xffd75e, 1);
                this.tutArrow.fillTriangle(bx - 14, by - 235, bx + 14, by - 235, bx, by - 195);
            }
        } else if (this.tutorialStep === 1 || this.tutorialStep === 2) {
            // вкладки: кольцо по живой позиции/размеру контейнера вкладки
            const t = this.tabBtns[this.tutorialStep - 1];
            const cx = t.c.x,
                cy = t.c.y;
            const tw = t.bg.displayWidth,
                th = t.bg.displayHeight;
            ring(cx - tw / 2 - 5, cy - th / 2 - 6, tw + 10, th + 12);
            if (L.tutorial.tabBubble === 'left') {
                // Ландшафт: подпись слева от вкладки, стрелка вправо
                if (this.tutorialStep === 1) {
                    this.tutBubble.setPosition(cx - 306, cy - 8).setSize(380, 66);
                    tutText('Покупай оборудование здесь —\nоно усиливает каждый клик');
                    this.tutText.setPosition(cx - 306, cy - 8);
                    this.tutArrow.fillTriangle(cx - 111, cy - 22, cx - 111, cy + 6, cx - 81, cy - 8);
                } else {
                    this.tutBubble.setPosition(cx - 157, cy - 78).setSize(360, 46);
                    tutText('А здесь — усиления: криты и жилы');
                    this.tutText.setPosition(cx - 157, cy - 78);
                    this.tutArrow.fillTriangle(cx, cy - 52, cx + 28, cy - 52, cx + 14, cy - 22);
                }
            } else {
                // Портрет: бабл ПОД вкладками (частично накрывает строку тира и
                // верх первой карточки — tutCam рендерит его ПОВЕРХ списка:
                // штатный модальный хинт на время шага), стрелка вниз от вкладки.
                // Кегль и размер — от масштаба: фикс 15px на телефоне давал
                // ~8px на экране (FIT ~0.54), подпись была нечитаема
                const txt =
                    this.tutorialStep === 1
                        ? 'Покупай оборудование\nздесь — оно усиливает\nкаждый клик'
                        : 'А здесь — усиления:\nкриты и жилы';
                tutText(txt);
                const bw = Math.min(this.tutText.width + SPACE.lg * 2, 2 * (cx - 5), 2 * (L.W - 5 - cx));
                // Текст ужинается под бабл: без этого длинная строка вылезала
                // за бабл и резалась краем экрана (зонд туториала)
                fitFontSize(this.tutText, Math.round(FONT_SIZE.body * Math.min(s, 1.5)), bw - 28, 11);
                const bh = this.tutText.height + 18;
                this.tutBubble.setPosition(cx, cy + 124).setSize(bw, bh);
                this.tutText.setPosition(cx, cy + 124);
                this.tutArrow.fillStyle(0xffd75e, 1);
                this.tutArrow.fillTriangle(cx - 10, cy + 26, cx + 10, cy + 26, cx, cy + 44);
            }
        }
    },

    stepTutorial() {
        if (!this.tutDim) {
            return;
        }

        const now = this.time.now;
        if (this.tutorialStep === 0 && gameState.clicks >= this.tutClickStart + 3) {
            this.tutorialStep = 1;
            this.tutShownAt = now;
            this.layoutTutorial();
        } else if (this.tutorialStep === 1 && (this.tutTabClicked === 0 || now - this.tutShownAt >= 6000)) {
            this.tutorialStep = 2;
            this.tutShownAt = now;
            this.layoutTutorial();
        } else if (this.tutorialStep === 2 && (this.tutTabClicked === 1 || now - this.tutShownAt >= 6000)) {
            this.showTutorialFinal();
        }
    },

    showTutorialFinal() {
        this.tutorialStep = 3;
        // Под модалкой/боем слои погашены (updateBlockLock): показ финала здесь
        // вылез бы призраком поверх затемнения — отложено до снятия гашения
        if (this._tutSuppressed) {
            return;
        }

        this.tutRing.clear().setVisible(false);
        this.tutArrow.clear().setVisible(false);
        this.tutBubble.setVisible(false);
        this.tutText.setVisible(false);
        this.tutFinal.setPosition(this.L.modal.cx, this.L.tutorial.finalY).setVisible(true);
        this.tutBtn.setPosition(this.L.modal.cx, this.L.tutorial.btnY).setVisible(true);
        // Ярлык переставляется ВМЕСТЕ с кнопкой: раньше он оставался на
        // ландшафтных координатах создания (640, 400) — в портрете улетал
        // вправо, кнопка оставалась пустой (скриншот игрока)
        this.tutBtnLbl.setPosition(this.L.modal.cx, this.L.tutorial.btnY).setVisible(true);
    },

    finishTutorial() {
        gameState.tutorialDone = true;
        saveGame();
        if (this.tutPulse) {
            this.tutPulse.stop();
        }

        if (this.tutBob) {
            this.tutBob.stop();
        }

        [
            this.tutDim,
            this.tutRing,
            this.tutArrow,
            this.tutBubble,
            this.tutText,
            this.tutFinal,
            this.tutBtn,
            this.tutBtnLbl
        ].forEach((o) => o.destroy());
        this.tutDim = null;
        if (this.tutCam) {
            this.cameras.remove(this.tutCam);
            this.tutCam = null;
        }
    },

    // «Полный сброс» возвращает tutorialDone=false, но учебные объекты строятся
    // единожды в create() — пересобираем в текущей сессии, иначе обучение
    // появилось бы только после перезагрузки страницы (CONTEXT: «Полный сброс
    // показывает обучение заново»). Идемпотентно по tutDim.
    maybeRebuildTutorial() {
        if (!gameState.tutorialDone && !this.tutDim) {
            this.buildTutorial();
        }
    }
};
