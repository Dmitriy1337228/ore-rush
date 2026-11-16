import Phaser from 'phaser';
import { gameState, TIERS, BOSSES, getBossRecord } from '../../state.js';
import {
    addImgC,
    makeLabel,
    fitFontSize,
    addScreenDim,
    DIM_ALPHA,
    addModalContainer,
    tapSlopPx
} from '../../ui/uiKit.js';
import { MAP_NODE_H, MAP_HEAD, MAP_TAIL, MAP_R_TIER, MAP_R_BOSS } from '../../ui/listGeometry.js';
import { createPanel } from '../../ui/panel.js';
import { TEXT, DEPTH, REG, FONT_SIZE, SPACE } from '../../ui/theme.js';

export const mapScreenMethods = {
    buildMapScreen() {
        this.mapDim = addScreenDim(this, DIM_ALPHA.screen).setDepth(DEPTH.screenDim).setVisible(false).setInteractive();
        // Тап по карте приходит ИМЕННО сюда: stopPropagation dim'а гасит и
        // scene-level pointerdown, поэтому старт драга (и skip анимации) — здесь
        this.mapDim.on('pointerdown', (pointer, lx, ly, event) => {
            this.startMapDrag(pointer);
            event.stopPropagation();
        });

        this.mapRoot = addModalContainer(this).setDepth(DEPTH.screen).setVisible(false);
        this.mapWin = createPanel(this, {
            w: 760,
            h: 620,
            title: 'Карта шахты',
            titleY: -246,
            titleSize: FONT_SIZE.display,
            close: { x: 320, y: -238, onClose: () => this.closeMap() }
        });
        this.mapPanel = this.mapWin.panel;
        this.mapTitle = this.mapWin.title;
        this.mapClose = this.mapWin.close;
        // Фон-доска на внутренней зоне панели (растягивается в applyLayout):
        // ребёнок mapRoot сразу после панели — над металлом, под заголовком/
        // крестиком; узлы рисует mapCam ПОВЕРХ (камеры рендерятся после main)
        this.mapBoard = addImgC(this, 0, 0, 'map_board', 680, 464);
        this.mapBoard.setAlpha(0.9);
        this.mapRoot.add([this.mapPanel, this.mapBoard, this.mapTitle, this.mapClose]);

        // Контент — top-level контейнер (как listContent): вложенный в mapRoot
        // ребёнок рендерился бы только через родителя, а mapCam его игнорирует.
        // Depth 42 — чтобы тапы по кружкам боссов приходили раньше dim (depth 40).
        this.mapContent = this.add.container(0, 0).setDepth(DEPTH.screenContent).setVisible(false);
        this.cameras.main.ignore(this.mapContent);

        // Тропа (пунктир + шевроны) — первый ребёнок mapContent: под кружками;
        // перерисовывается в refreshMapNodes при смене статусов узлов
        this.mapTrail = this.add.graphics();
        this.mapContent.add(this.mapTrail);

        this.buildMapNodes();

        this.mapMiner = this.add.image(0, 0, 'miner_portrait');
        this.placeIcon(this.mapMiner, 'miner_portrait', 190, MAP_HEAD, 36);
        this.mapContent.add(this.mapMiner);

        this.mapCam = this.cameras.add(300, 146, 680, 464, false, 'mapCam');
        this.mapCam.setRoundPixels(true);
        const others = this.children.list.filter((o) => o !== this.mapContent);
        this.mapCam.ignore(others);
        this.mapCam.setVisible(false);
        this._mapView = { x: 300, y: 146, w: 680, h: 464 };
        this._mapHalfH = 310;
        this._mapMaxScroll = Math.max(0, this._mapContentH - 464);
        this._nodeCX = 340;

        this.input.on('wheel', (pointer, over, dx, dy) => {
            if (!this._mapOpen) return;
            const v = this._mapView;
            if (
                pointer.x >= v.x - 10 &&
                pointer.x <= v.x + v.w + 10 &&
                pointer.y >= v.y - 10 &&
                pointer.y <= v.y + v.h + 10
            ) {
                this.mapCam.scrollY = Phaser.Math.Clamp(this.mapCam.scrollY + dy * 0.5, 0, this._mapMaxScroll);
            }
        });
        this.setupMapDrag();
    },

    // Узлы карты: кружок (Graphics) по центру колонки, иконка внутри, тексты
    // под кружком; позиции и кегли по портретному масштабу; пересоздаются
    // при смене s (applyLayout), статусы (обводка/пульс) обновляет refreshMapNodes
    buildMapNodes() {
        const s = this._adaptiveScale || 1;
        for (const node of this.mapNodes || []) {
            if (node.pulse) {
                node.pulse.stop();
                node.pulse = null;
            }
            if (node.ringPulse) {
                node.ringPulse.stop();
                node.ringPulse = null;
            }
            node.root.destroy();
        }
        this.mapNodes = [];
        let idx = 0;
        for (let t = 0; t < TIERS.length; t++) {
            this.mapNodes.push(this.buildMapTierNode(t, idx++));
            const boss = BOSSES.find((b) => b.tier === t);
            if (boss) this.mapNodes.push(this.buildMapBossNode(boss, idx++));
        }
        this._mapContentH = Math.round((MAP_HEAD + this.mapNodes.length * MAP_NODE_H + MAP_TAIL) * s);
        if (this.mapTrail) this.mapTrail.clear();
    },

    buildMapTierNode(t, idx) {
        const s = this._adaptiveScale || 1;
        const r = Math.round(MAP_R_TIER * s);
        const root = this.add.container(340, Math.round((MAP_HEAD + idx * MAP_NODE_H) * s));
        const ring = this.add.graphics().setPosition(0, r);
        const ringLine = this.add.graphics().setPosition(0, r);
        const icon = this.add.image(0, r, TIERS[t].iconKey);
        this.placeIcon(icon, TIERS[t].iconKey, 0, r, Math.round(30 * Math.min(s, 1.6)));
        const nameY = r * 2 + Math.round(8 * s);
        const name = makeLabel(this, 0, nameY, `${t + 1}. ${TIERS[t].name}`, FONT_SIZE.captionLg, TEXT.white).setOrigin(
            0.5,
            0
        );
        fitFontSize(name, FONT_SIZE.captionLg * s, (this._mapView ? this._mapView.w : 680) - 24, 10);
        // Портрет: обводка — серое по камню на телефоне читалось плохо (ревью)
        if (this.L.portrait) name.setStroke('#14161a', 4);
        root.add([ring, ringLine, icon, name]);
        this.mapContent.add(root);
        return {
            kind: 'tier',
            tier: t,
            root,
            ring,
            ringLine,
            icon,
            name,
            pulse: null,
            ringPulse: null,
            _state: null,
            _r: r
        };
    },

    buildMapBossNode(boss, idx) {
        const s = this._adaptiveScale || 1;
        const r = Math.round(MAP_R_BOSS * s);
        const root = this.add.container(340, Math.round((MAP_HEAD + idx * MAP_NODE_H) * s));
        const ring = this.add.graphics().setPosition(0, r);
        const ringLine = this.add.graphics().setPosition(0, r);
        ring.setInteractive(new Phaser.Geom.Circle(0, 0, r), Phaser.Geom.Circle.Contains);
        const icon = this.add.image(0, r, boss.icon);
        this.placeIcon(icon, boss.icon, 0, r, Math.round(40 * Math.min(s, 1.6)));
        const nameY = r * 2 + Math.round(7 * s);
        const maxW = (this._mapView ? this._mapView.w : 680) - 24;
        const name = makeLabel(this, 0, nameY, boss.name, FONT_SIZE.label, TEXT.white).setOrigin(0.5, 0);
        fitFontSize(name, FONT_SIZE.label * s, maxW, 10);
        const status = makeLabel(this, 0, nameY + Math.round(18 * s), '', FONT_SIZE.caption, TEXT.dim).setOrigin(
            0.5,
            0
        );
        fitFontSize(status, FONT_SIZE.caption * s, maxW, 10);
        if (this.L.portrait) {
            name.setStroke('#14161a', 4);
            status.setStroke('#14161a', 4);
        }
        root.add([ring, ringLine, icon, name, status]);
        this.mapContent.add(root);
        const node = {
            kind: 'boss',
            boss,
            root,
            ring,
            ringLine,
            icon,
            name,
            status,
            pulse: null,
            ringPulse: null,
            _state: null,
            _r: r
        };
        // Кружок перехватывает тап у dim (mapCam выше в hit-test) — драг стартуем
        // и с него, иначе жест, начатый на кружке, не скроллит
        ring.on('pointerdown', (p) => this.startMapDrag(p));
        ring.on('pointerup', () => {
            if (this._mapDragging) return;
            // Ключ состояния включает рекорд («available|45») — сравниваем префикс
            if (!node._state || !node._state.startsWith('available')) return;
            this._onBossNodeTap(boss.id);
        });
        return node;
    },

    _onBossNodeTap(bossId) {
        if (this.registry.get(REG.bossActive)) return;
        this.closeMap();
        // registry 'blockLocked' обновляется в refreshUi следующего кадра — пересчитываем
        // сразу, иначе guard startBossFight увидит устаревший lock от открытой карты
        this.updateBlockLock();
        const gs = this.scene.get('GameScene');
        if (gs) gs.startBossFight(bossId);
    },

    refreshMapNodes() {
        if (!this.mapNodes) return;
        let changed = false;
        for (const node of this.mapNodes) {
            if (node.kind === 'tier') {
                const key = gameState.tier > node.tier ? 'passed' : gameState.tier === node.tier ? 'current' : 'future';
                if (node._state === key) continue;
                node._state = key;
                changed = true;
                // future-узлы читаемее прежнего: tint 0x505050 / кольцо 0x3a3d40
                // на сером камне доски были почти невидимы — низ карты выглядел
                // пустой (скриншот портрета); иерархия «тусклее current» сохранена
                this._drawMapRing(node, key === 'passed' ? 0x6a6a6a : key === 'future' ? 0x565a60 : 0xffd75e);
                node.icon.setTint(key === 'passed' ? 0x909090 : key === 'future' ? 0x787878 : 0xffffff);
                node.name.setColor(key === 'passed' ? TEXT.dim : key === 'future' ? TEXT.dim : TEXT.white);
                if (key === 'current' && !node.pulse) {
                    node.pulse = this.tweens.add({
                        targets: node.root,
                        alpha: { from: 1, to: 0.55 },
                        duration: 500,
                        yoyo: true,
                        repeat: -1
                    });
                } else if (key !== 'current' && node.pulse) {
                    node.pulse.stop();
                    node.pulse = null;
                    node.root.setAlpha(1);
                }
            } else {
                const b = node.boss;
                const defeated = !!gameState.bossesDefeated[b.id];
                // Рекорд в ключе диффа: новый рекорд перерисовывает подпись и при
                // неизменном статусе «побеждён»
                const rec = getBossRecord(b.id);
                const recTxt = rec ? ` · ${Math.floor(rec / 60)}:${String(rec % 60).padStart(2, '0')}` : '';
                const key = `${defeated ? 'defeated' : gameState.tier >= b.tier ? 'available' : 'locked'}|${rec ?? 'x'}`;
                if (node._state === key) continue;
                node._state = key;
                changed = true;
                if (key.startsWith('defeated')) {
                    node.status.setText(`побеждён${recTxt}`).setColor('#7ee787');
                } else if (key.startsWith('available')) {
                    node.status.setText(`Сразиться!${recTxt}`).setColor(TEXT.gold);
                } else {
                    node.status.setText(`нужен: шахта ${b.tier + 1}`).setColor(TEXT.dim);
                }
                const ringColor = key.startsWith('defeated')
                    ? 0x7ee787
                    : key.startsWith('available')
                      ? 0xffd75e
                      : 0x6a6a6a;
                this._drawMapRing(node, ringColor);
                node.icon.setTint(key.startsWith('locked') ? 0x787878 : 0xffffff);
                node.name.setColor(key.startsWith('locked') ? TEXT.dim : TEXT.white);
                if (key.startsWith('available') && !node.pulse) {
                    node.pulse = this.tweens.add({
                        targets: node.status,
                        alpha: { from: 1, to: 0.45 },
                        duration: 450,
                        yoyo: true,
                        repeat: -1
                    });
                    node.ringPulse = this.tweens.add({
                        targets: node.ringLine,
                        alpha: { from: 1, to: 0.45 },
                        duration: 450,
                        yoyo: true,
                        repeat: -1
                    });
                } else if (!key.startsWith('available') && node.pulse) {
                    node.pulse.stop();
                    node.pulse = null;
                    node.status.setAlpha(1);
                    if (node.ringPulse) {
                        node.ringPulse.stop();
                        node.ringPulse = null;
                        node.ringLine.setAlpha(1);
                    }
                }
            }
        }
        if (changed) this._redrawMapTrail();
    },

    // Кружок узла: тёмная заливка (ring) + цветная обводка отдельным Graphics
    // (ringLine — по ней пульсирует доступный босс), перерисовка только при
    // смене состояния — вызовы из refreshMapNodes по диффу
    _drawMapRing(node, color) {
        node.ring.clear();
        node.ring.fillStyle(0x2a2d31, 1);
        node.ring.fillCircle(0, 0, node._r);
        node.ringLine.clear();
        node.ringLine.lineStyle(Math.max(2, Math.round(3 * Math.min(this._adaptiveScale || 1, 1.6))), color, 1);
        node.ringLine.strokeCircle(0, 0, node._r);
        node._ringColor = color;
    },

    // Тропа между последовательными кружками: пунктир 6/6 по оси колонки
    // (от подписи узла до шеврона у вершины следующего кружка). Пройденные
    // отрезки — золото, будущие — тусклые. Перерисовка при смене статусов узлов.
    _redrawMapTrail() {
        if (!this.mapTrail || !this.mapNodes || this.mapNodes.length < 2) return;
        const g = this.mapTrail;
        g.clear();
        const s = this._adaptiveScale || 1;
        const cx = this._nodeCX;
        this._trailCX = cx;
        const curIdx = this._findNodeIndex(gameState.tier);
        const dashW = Math.max(2, Math.round(2 * Math.min(s, 1.6)));
        for (let k = 0; k < this.mapNodes.length - 1; k++) {
            const a = this.mapNodes[k];
            const b = this.mapNodes[k + 1];
            const passed = curIdx >= k + 1;
            const color = passed ? 0xc9a55a : 0x9a8a60;
            const alpha = passed ? 0.9 : 0.5;
            const lbl = a.kind === 'tier' ? a.name : a.status;
            const from = a.root.y + lbl.y + lbl.height + Math.round(4 * s);
            const to = b.root.y - Math.round(9 * s);
            g.fillStyle(color, alpha);
            for (let y = from; y + 6 <= to; y += 12) {
                g.fillRect(cx - dashW / 2, y, dashW, 6);
            }
            g.fillTriangle(cx - Math.round(5 * s), to, cx + Math.round(5 * s), to, cx, b.root.y + Math.round(2 * s));
        }
    },

    _findNodeIndex(tier) {
        return this.mapNodes.findIndex((n) => n.kind === 'tier' && n.tier === tier);
    },

    // Y центра кружка узла (root.y — верх контейнера, кружок сдвинут на _r вниз):
    // скролл-цель и шахтёр должны смотреть на центр, а не на макушку кружка
    _mapNodeY(idx) {
        const s = this._adaptiveScale || 1;
        const node = this.mapNodes && this.mapNodes[idx];
        const r = node ? node._r : Math.round(MAP_R_TIER * s);
        return Math.round((MAP_HEAD + idx * MAP_NODE_H) * s) + r;
    },

    _mapScrollTarget(idx) {
        // -10*s: центрирование кружка current-тира ставило подпись предыдущего
        // узла в 4px от верхней кромки вьюпорта — впритык, выглядит срезанной
        // (скриншот карты). Камера чуть выше центра даёт подписи воздух
        return Phaser.Math.Clamp(
            this._mapNodeY(idx) - this._mapView.h / 2 - Math.round(10 * (this._adaptiveScale || 1)),
            0,
            this._mapMaxScroll
        );
    },

    _placeMapMiner(idx) {
        this.placeIcon(
            this.mapMiner,
            'miner_portrait',
            this._nodeCX + Math.round(-150 * (this._adaptiveScale || 1)),
            this._mapNodeY(idx),
            36
        );
        this.mapMiner.setVisible(true);
    },

    openMap({ animate = false } = {}) {
        if (this._mapOpen) return;
        if (this.registry.get(REG.blockLocked)) return;
        this._mapOpen = true;
        this.mapDim.setVisible(true);
        this.mapRoot.setVisible(true);
        this.mapCam.setVisible(true);
        this.refreshMapNodes();
        const curIdx = this._findNodeIndex(gameState.tier);
        if (animate) {
            const prevIdx = Math.max(0, this._findNodeIndex(Math.max(0, gameState.tier - 1)));
            const fromScroll = this._mapScrollTarget(prevIdx);
            const toScroll = this._mapScrollTarget(curIdx);
            const fromY = this._mapNodeY(prevIdx);
            const toY = this._mapNodeY(curIdx);
            this.mapCam.scrollY = fromScroll;
            this._placeMapMiner(prevIdx);
            const proxy = { p: 0 };
            this._mapAnim = this.tweens.add({
                targets: proxy,
                p: 1,
                duration: 1400,
                ease: 'Sine.easeInOut',
                onUpdate: () => {
                    this.mapCam.scrollY = fromScroll + (toScroll - fromScroll) * proxy.p;
                    this.mapMiner.y = fromY + (toY - fromY) * proxy.p;
                },
                onComplete: () => {
                    this._mapAnim = null;
                    this._placeMapMiner(curIdx);
                    this._arriveFx(gameState.tier);
                }
            });
        } else {
            this.mapCam.scrollY = this._mapScrollTarget(curIdx);
            this._placeMapMiner(curIdx);
        }
    },

    skipMapAnim() {
        if (!this._mapAnim) return;
        this._mapAnim.stop();
        this._mapAnim = null;
        const curIdx = this._findNodeIndex(gameState.tier);
        this.mapCam.scrollY = this._mapScrollTarget(curIdx);
        this._placeMapMiner(curIdx);
        this._arriveFx(gameState.tier);
    },

    _arriveFx(tierIndex) {
        this.mapCam.flash(250, 255, 255, 255);
        // Баннер в КОНТЕНТЕ карты, в зазоре «подпись предыдущего узла — кружок
        // текущего»: экранноприбитый баннер печатался поверх подписи верхнего
        // узла (жёлтое на жёлтом, скриншот карты). Плашка делает его читаемым
        // над тропой; зазор гарантирован шагом узлов (132) — баннер не наезжает
        const idx = this._findNodeIndex(tierIndex);
        const node = this.mapNodes && this.mapNodes[idx];
        const k = Math.min(this._adaptiveScale || 1, 1.6);
        const cy = node ? node.root.y - Math.round(20 * k) : -this._mapHalfH + 118;
        const plate = this.add
            .rectangle(this._nodeCX || 340, cy, 10, Math.round(34 * k), 0x1c1620, 0.85)
            .setStrokeStyle(1, 0x555860, 1);
        const banner = makeLabel(
            this,
            this._nodeCX || 340,
            cy,
            `Уровень ${tierIndex + 1}: ${TIERS[tierIndex].name}!`,
            Math.round(FONT_SIZE.cardTitle * k),
            TEXT.cream,
            { align: 'center' }
        ).setOrigin(0.5);
        plate.setSize(banner.width + 36, Math.round(34 * k));
        plate.setAlpha(0);
        banner.setAlpha(0);
        this.mapContent.add([plate, banner]);
        this.tweens.add({
            targets: [plate, banner],
            alpha: { from: 0, to: 1 },
            duration: 250,
            yoyo: true,
            hold: 1100,
            onComplete: () => {
                plate.destroy();
                banner.destroy();
            }
        });
    },

    closeMap() {
        if (this._mapAnim) {
            this._mapAnim.stop();
            this._mapAnim = null;
        }
        this.mapDim.setVisible(false);
        this.mapRoot.setVisible(false);
        this.mapCam.setVisible(false);
        this._mapOpen = false;
        this.tryShowDailyModal(); // награда могла ждать очереди под картой
    },

    setupMapDrag() {
        const inMapZone = (p) => {
            const v = this._mapView;
            return p.x >= v.x - 6 && p.x <= v.x + v.w + 6 && p.y >= v.y - 6 && p.y <= v.y + v.h + 6;
        };
        // Вызывается из хендлеров dim и слотов боссов (dim гасит scene-level down).
        // Тап/драг по слоту во время анимации спуска тоже завершает её (skip)
        this.startMapDrag = (p) => {
            if (this._mapAnim) this.skipMapAnim();
            if (!this._mapOpen || !inMapZone(p)) return;
            this._mapDragId = p.id;
            this._mapDragStartY = p.y;
            this._mapDragStartScroll = this.mapCam.scrollY;
            this._mapDragging = false;
            this._mapTapSlop = tapSlopPx(this, this.L.W);
        };
        this.input.on('pointermove', (p) => {
            if (p.id !== this._mapDragId || !p.isDown) return;
            const delta = this._mapDragStartY - p.y;
            if (!this._mapDragging && Math.abs(delta) > this._mapTapSlop) this._mapDragging = true;
            if (this._mapDragging) {
                this.mapCam.scrollY = Phaser.Math.Clamp(this._mapDragStartScroll + delta, 0, this._mapMaxScroll);
            }
        });
        const endDrag = (p) => {
            if (p && p.id !== this._mapDragId) return;
            this._mapDragId = null;
            this.time.delayedCall(0, () => {
                this._mapDragging = false;
            });
        };
        this.input.on('pointerup', endDrag);
        this.input.on('pointerupoutside', endDrag);
    },

    // Экран карты
    applyMapLayout(L, s) {
        // Экран карты: ландшафт 760x620 в L.modal; портрет — на всю свободную
        // зону (zoneTop..zoneBot), узлы и скролл не меняются
        let mpw, mph, mcy;
        if (L.portrait) {
            mpw = L.W - 24;
            mph = Math.min(L.H - 184, 1500);
            mcy = L.modal.zoneTop + Math.round(mph / 2);
        } else {
            mpw = 760;
            mph = 620;
            mcy = L.modal.cy;
        }
        this.mapRoot.setPosition(L.modal.cx, mcy);
        this.mapPanel.setDisplaySize(mpw, mph);
        this.mapTitle.setPosition(0, -mph / 2 + 64);
        this.mapTitle.setFontSize(L.portrait ? FONT_SIZE.title : FONT_SIZE.display);
        // Крестик: центр на 72 ниже верха панели (прежняя геометрия), 48 от правого края
        const closeSize = L.portrait ? 64 : 44;
        const closeCY = 72;
        this.mapClose.setPosition(mpw / 2 - 48, -mph / 2 + closeCY);
        this.mapClose.setDisplaySize(closeSize, closeSize);
        // Внутренняя область врезки (contentRect): поля 40 по бокам, 60 снизу,
        // сверху — 96 (ландшафт) или низ крестика + SPACE.sm (портрет: крестик 64
        // заходил на доску на 8px) — в контейнерных координатах, в мир переводит
        // сдвиг на центр
        const boardTop = L.portrait ? closeCY + closeSize / 2 + SPACE.sm : 96;
        const board = this.mapWin.contentRect({ left: 40, right: 40, top: boardTop, bottom: 60 });
        const mvx = L.modal.cx + board.x;
        const mvy = mcy + board.y;
        this.mapCam.setViewport(mvx, mvy, board.w, board.h);
        this._mapView = { x: mvx, y: mvy, w: board.w, h: board.h };
        this.mapBoard.setPosition(board.x + board.w / 2, board.y + board.h / 2);
        this.mapBoard.setDisplaySize(board.w, board.h);
        if (this.mapNodes && this._mapS !== s) {
            this._mapS = s;
            if (this._mapAnim) this.skipMapAnim();
            this.buildMapNodes();
        }
        this._mapHalfH = mph / 2;
        this._mapMaxScroll = Math.max(0, this._mapContentH - board.h);
        this.mapCam.scrollY = Phaser.Math.Clamp(this.mapCam.scrollY, 0, this._mapMaxScroll);
        this._nodeCX = board.w / 2;
        for (const node of this.mapNodes) node.root.x = this._nodeCX;
        if (this.mapMiner) this.mapMiner.x = this._nodeCX + Math.round(-150 * s);
        // Смена ориентации без смены s (s=1.0): узлы не пересобираются, но cx
        // меняется — тропа осталась бы на старой колонке; сдвигаем вслед за узлами
        if (this._trailCX !== undefined && this._trailCX !== this._nodeCX) this._redrawMapTrail();
    }
};
