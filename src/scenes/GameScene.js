import Phaser from 'phaser';
import {
    gameState, TIERS, rollClickGain, addOre, getOrePerSecond, getAutoClicksPerSecond,
    saveGame, loadGame, saveLastExit, readLastExit, computeOfflineReward, fmt,
    MUTATIONS, MUTATION_DURATION_MS, MUTATION_CHECK_MS, MUTATION_CHANCE, getMutationBreakBonus,
    canClaimDaily, claimDailyReward
} from '../state.js';
import { YandexSDKStub } from '../sdk-stub.js';
import { computeLayout } from '../layout.js';
import { playSfx } from '../sfx.js';

const FONT = '"Monocraft", "Inter", "Consolas", monospace';

const BLOCK_STAGES = [1, 2, 3, 4];

// Фоны локаций (пиксель-арт конверсия voxel-рендеров ComfyUI): один фон на тир руды.
// При смене тира — плавный кроссфейд; фон обязан закрыть видимую зону (ландшафт —
// весь экран, портрет — полоса до верхней кромки панели) с запасом 8% (страховка
// от тряски камеры при крите).
const BG_KEYS = ['bg_01_coal', 'bg_02_copper', 'bg_03_iron', 'bg_04_silver', 'bg_05_gold', 'bg_06_amethyst', 'bg_07_emerald', 'bg_08_ruby', 'bg_09_sapphire', 'bg_10_platinum', 'bg_11_uranium', 'bg_12_diamond'];
const BG_FADE_MS = 800;
const BG_SHADE_ALPHA = 0.32;
const BG_OVERSIZE = 1.08;

function tierBgKey(tier) {
    return BG_KEYS[Math.min(tier, BG_KEYS.length - 1)];
}

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
        this.mutation = null;  // { id, endsAt } — активная мутация блока (Этап 3); единственный терминатор — таймер
        this.mutationUi = null;
        this.hitProgress = 0;  // удары, накопленные на текущей стадии (для hitsPerStage > 1)
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
        this.startBgm();
        this.setGameplay(true);
        this.refreshTick();
        this.claimDaily();
        this.hidePageLoader();
    }

    // HTML-лоадер из index.html гасится, когда мир уже отрисован первым кадром —
    // до этого он закрывал «серый фон» страницы на медленных соединениях
    hidePageLoader() {
        const el = document.getElementById('loader');
        if (el) {
            el.classList.add('hidden');
            setTimeout(() => el.remove(), 500);
        }
    }

    // Ежедневная награда при первом заходе за день: выдаётся сразу (state.js),
    // UIScene показывает модалку (registry 'dailyInfo' при загрузке или событие
    // 'daily-claimed' из DevPanel — оба пути в одну очередь).
    claimDaily() {
        if (!canClaimDaily()) return;
        const info = claimDailyReward();
        if (!info) return;
        this.registry.set('dailyInfo', info);
        this.game.events.emit('daily-claimed', info);
    }

    // GameplayAPI Яндекса (стаб — no-op): start — игрок активен, stop — свёрнута.
    setGameplay(active) {
        const p = YandexSDKStub.player;
        if (!p || !p.gameplayStart) return;
        if (active && !this._gameplayActive) {
            this._gameplayActive = true;
            p.gameplayStart();
        } else if (!active && this._gameplayActive) {
            this._gameplayActive = false;
            p.gameplayStop();
        }
    }

    // ---------- Мир ----------

    buildWorld() {
        this.applyLayout();

        // Стартовый градиент остаётся подложкой под фоном (страховка на случай,
        // если текстура фона ещё не готова) — ОБЯЗАТЕЛЬНО ниже bgCurrent/bgNext,
        // иначе непрозрачный градиент закроет фон целиком.
        this.bgBase = this.add.graphics().setDepth(-4);
        this.drawBase();

        // Слой фона локации: bgCurrent (видимый) + bgNext (невидимый верхний для кроссфейда).
        // Позиция/размер — по раскладке (positionBg): cover видимой зоны + 8% оверсайз.
        // bgShade — лёгкое затемнение поверх фона: контент фона не спорит с блоком и HUD.
        this.bgCurrent = this.add.image(0, 0, tierBgKey(gameState.tier))
            .setOrigin(0.5).setDepth(-3);
        this.bgNext = this.add.image(0, 0, tierBgKey(gameState.tier))
            .setOrigin(0.5).setDepth(-2).setAlpha(0).setVisible(false);
        this.bgShade = this.add.rectangle(0, 0, 10, 10, 0x000000, BG_SHADE_ALPHA)
            .setDepth(-1);
        // Тень над панелью (портрет): плавный градиент прячет нижнюю кромку фото
        // (при зуме читается как серая полоса) — контент «уходит» под лист
        this.bgFade = this.add.graphics().setDepth(-1);
        this.drawFade();
        this.positionBg();

        this.buildEmitters(TIERS[gameState.tier].iconKey);
    }

    // ---------- Адаптивная раскладка (см. src/layout.js) ----------

    applyLayout() {
        const L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        this.L = L;
        if (this.bgBase) this.drawBase();
        this.positionBg();
        const bx = L.block.x, by = L.block.y;
        const moved = this.blockX !== bx || this.blockY !== by;
        this.blockX = bx;
        this.blockY = by;
        if (this.block && moved) {
            this.block.setPosition(bx, by);
            if (this.mutationUi) {
                // Подпись мутации привязана к блоку — перезапускаем боб-твин от новой точки
                this.tweens.killTweensOf(this.mutationUi);
                this.mutationUi.setPosition(bx, by - 200);
                this.tweens.add({ targets: this.mutationUi, y: by - 208, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            }
        }
    }

    drawBase() {
        const g = this.bgBase;
        g.clear();
        g.fillGradientStyle(0x3a3f44, 0x3a3f44, 0x1c1e22, 0x1c1e22, 1);
        g.fillRect(-80, -80, this.L.W + 160, this.L.H + 160);
    }

    positionBg() {
        if (!this.bgCurrent || !this.L) return;
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
        const cy = this.L.portrait
            ? coverDeep - dh / 2 + 2
            : this.L.H / 2;
        this.bgCurrent.setPosition(cx, cy).setDisplaySize(dw, dh);
        this.bgNext.setPosition(cx, cy).setDisplaySize(dw, dh);
        this.bgShade.setPosition(this.L.W / 2, this.L.H / 2).setSize(this.L.W, this.L.H);
        this.drawFade();
    }

    // Тень над панелью (только портрет): 12 полос с нарастающим альфакрашиванием
    // от прозрачного к чёрному — нижняя кромка фото «тонет» в тени перед листом.
    drawFade() {
        if (!this.bgFade || !this.L) return;
        const g = this.bgFade;
        g.clear();
        if (!this.L.portrait) return;
        const FH = 260;
        const top = this.L.bgCoverToY - FH;
        const steps = 16;
        for (let i = 0; i < steps; i++) {
            g.fillStyle(0x000000, Math.pow((i + 1) / steps, 1.7) * 0.88);
            g.fillRect(0, Math.floor(top + (FH * i) / steps), this.L.W, Math.ceil(FH / steps) + 1);
        }
    }

    // Плавная смена фона при переходе на новый тир (или «Полный сброс» на тир 1).
    // ВСТРЕЧНЫЙ кроссфейд: старый фон гаснет (1->0), новый проявляется (0->1) —
    // переход читается одинаково в обе стороны (на светлый и на тёмный фон):
    // чистое fade-in поверх тёмного старого «не видно» в ранних кадрах, если новый фон светлее.
    swapBg() {
        const key = tierBgKey(gameState.tier);
        const cur = this.bgCurrent, nxt = this.bgNext;
        if (!nxt.visible && cur.texture.key === key) return;

        // Незавершённый кроссфейд мгновенно доводим до конца: частично проявленный
        // новый фон становится текущим, иначе новая смена стартует «с прыжка»
        this.tweens.killTweensOf([cur, nxt]);
        if (nxt.visible) {
            cur.setTexture(nxt.texture.key).setAlpha(1).setVisible(true);
            nxt.setVisible(false).setAlpha(0);
            if (cur.texture.key === key) return;
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
        // Ссылки сохраняются — shutdown обязан снять их с game.events (иначе
        // рестарт сцены навесит дубликаты и замкнёт уничтоженные объекты)
        this._onTierChanged = () => {
            // Кроссфейд стартует первым — до пересборки блока/эмиттеров,
            // чтобы смена фона не ждала тяжёлый кадр
            this.swapBg();
            this.buildEmitters(TIERS[gameState.tier].iconKey);
            this.buildBlock();
            this.refreshTick();
            // «Полный сброс» DevPanel тоже приходит сюда — синхронизируем mute BGM
            this.syncBgm();
        };
        this.game.events.on('tier-changed', this._onTierChanged);

        this._onOfflineApplied = (info) => {
            const float = makeLabel(this, this.blockX, this.blockY - 140, `Шахтёры добыли: +${fmt(info.reward)}`, 26, '#ffe9b0');
            float.setOrigin(0.5).setDepth(20);
            this.tweens.add({ targets: float, y: float.y - 50, alpha: 0, duration: 1100, onComplete: () => float.destroy() });
        };
        this.game.events.on('offline-applied', this._onOfflineApplied);

        // Тумблер «Музыка: вкл/выкл» и слайдер громкости (UIScene) — mute и volume BGM
        this._onMusicChanged = () => this.syncBgm();
        this.game.events.on('music-changed', this._onMusicChanged);

        // Смена ориентации/размера окна (main.js) — перечитываем раскладку
        this._onLayoutChanged = () => this.applyLayout();
        this.game.events.on('layout-changed', this._onLayoutChanged);
    }

    // ---------- Фоновая музыка ----------

    startBgm() {
        if (!this.cache.audio.exists('bgm')) return;
        this.bgm = this.sound.add('bgm', { loop: true, volume: gameState.musicVolume });
        this.bgm.setMute(!gameState.musicOn);
        // Автоплей-политика: до первого взаимодействия браузер блокирует звук —
        // Phaser снимет lock при первом клике/клавише, тогда и стартуем
        if (this.sound.locked) {
            this.sound.once('unlocked', () => this.bgm.play());
        } else {
            this.bgm.play();
        }
    }

    syncBgm() {
        if (!this.bgm) return;
        this.bgm.setMute(!gameState.musicOn);
        this.bgm.setVolume(gameState.musicVolume);
    }

    setupTimers() {
        // Пассивный доход — раз в секунду (заряженная мутация умножает ставку)
        this.gpsTimer = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                const gps = getOrePerSecond();
                if (gps > 0) {
                    const mut = this.mutation ? MUTATIONS[this.mutation.id] : null;
                    const mult = mut && mut.passiveMult ? mut.passiveMult : 1;
                    addOre(gps * mult);
                    const float = makeLabel(this, this.blockX + 150, this.blockY - 90, `+${fmt(gps * mult)}`, 16, TIERS[gameState.tier].floatColor);
                    float.setOrigin(0.5).setDepth(20).setAlpha(0.85);
                    this.tweens.add({ targets: float, y: float.y - 30, alpha: 0, duration: 900, onComplete: () => float.destroy() });
                    this.refreshTick();
                }
            }
        });

        // Мутации блока (Этап 3): раз в 5 минут шанс 30% — случайная мутация на 10с.
        // Пока мутация активна, триггер ждёт; единственный терминатор — таймер.
        this.mutationTimer = this.time.addEvent({
            delay: MUTATION_CHECK_MS,
            loop: true,
            callback: () => {
                if (this.mutation || this.registry.get('blockLocked')) return;
                if (Math.random() >= MUTATION_CHANCE) return;
                const types = Object.keys(MUTATIONS);
                this.startMutation(types[Math.floor(Math.random() * types.length)]);
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
                // Кап бюджета: под модалкой (blockLocked) клики не списываются —
                // без капа копился бы залп на всё время простоя (фризы и волна
                // частиц после закрытия); короткая анимация разрушения это не ломает
                if (this.autoBudget > 20) this.autoBudget = 20;
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
                this.setGameplay(false);
                saveGame();
                saveLastExit();
            } else {
                // Возврат во вкладку: если отсутствовали дольше 5 минут — начисляем офлайн.
                // СНАЧАЛА читаем время выхода, записанное при hidden: перезапись «сейчас»
                // до чтения затирает период отсутствия и делает начисление невозможным
                // (мобильный вебвью Яндекса сворачивается без перезагрузки страницы).
                readLastExit().then((lastExit) => {
                    if (!lastExit) {
                        saveLastExit(); // первый отсчёт
                        return;
                    }
                    const info = computeOfflineReward(lastExit);
                    if (info) {
                        addOre(info.reward);
                        this.registry.set('offlineInfo', info);
                        saveLastExit(); // начинаем новый отсчёт
                        this.game.events.emit('offline-applied', info);
                    } else {
                        // меньше порога / нет пассива — перезапускаем отсчёт
                        saveLastExit();
                    }
                });
                this.setGameplay(true);
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
            this.game.events.off('tier-changed', this._onTierChanged);
            this.game.events.off('offline-applied', this._onOfflineApplied);
            this.game.events.off('music-changed', this._onMusicChanged);
            this.game.events.off('layout-changed', this._onLayoutChanged);
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

        const mut = this.mutation ? MUTATIONS[this.mutation.id] : null;
        // ключ мутации = this.mutation.id (сеется из ключа MUTATIONS в startMutation)
        const { gain, crit, lucky } = rollClickGain(this.mutation ? this.mutation.id : null);
        addOre(gain);
        if (!isAuto) gameState.clicks += 1;

        // Звуки добычи — только ручные клики: авто-клики робо-руки работают в фоне
        // и звучали бы какофонией; разрушение блока — исключение (звучит всегда)
        if (!isAuto) {
            playSfx(this, 'pickaxe');
            if (crit || lucky) playSfx(this, 'crit');
        }

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
        if (this.streakTimer) this.streakTimer.remove();
        this.streakTimer = this.time.delayedCall(healMs, () => {
            if (!this.blockBusy) {
                this.blockStage = 0;
                this.hitProgress = 0;
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
        playSfx(this, 'break');
        const mut = this.mutation ? MUTATIONS[this.mutation.id] : null;

        // Взрывная мутация: бонус руды при разрушении блока + усиленный взрыв частиц
        if (mut && mut.breakBonusMult) {
            const bonus = getMutationBreakBonus(this.mutation.id);
            addOre(bonus);
            const boomFloat = makeLabel(this, this.blockX, this.blockY - 80, `ВЗРЫВ! +${fmt(bonus)}`, 30, '#ff9040');
            boomFloat.setOrigin(0.5).setDepth(25);
            this.tweens.add({
                targets: boomFloat,
                y: boomFloat.y - 60,
                alpha: 0,
                duration: 1100,
                ease: 'Cubic.easeOut',
                onComplete: () => boomFloat.destroy()
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
                const gen = this.blockGen; // поколение блока на момент разрушения
                this.time.delayedCall(120, () => {
                    // блок пересоздан (смена тира / полный сброс) — зомби-цепочка отменена:
                    // buildBlock уже снял blockBusy и собрал новый блок с дыханием
                    if (gen !== this.blockGen) return;
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

    // ---------- Мутации блока (Этап 3) ----------

    // Активирует мутацию на 10с (или указанную длительность — DevPanel/тесты).
    // Единственный терминатор — таймер: мутация переживает разрушение блока и смену тира.
    startMutation(typeId, duration = MUTATION_DURATION_MS) {
        const def = MUTATIONS[typeId];
        if (!def) return;
        if (this.mutation) this.clearMutation(false);
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
        this.registry.set('passiveMult', def.passiveMult || 1);
        playSfx(this, 'mutation');

        // Подпись + таймер над блоком (парят)
        this.mutationUi = this.add.container(this.blockX, this.blockY - 200).setDepth(25);
        this.mutationName = makeLabel(this, 0, 0, def.name, 22, '#ffffff').setOrigin(0.5);
        this.mutationTime = makeLabel(this, 0, 28, `${Math.ceil(duration / 1000)}с`, 16, '#ffe9b0').setOrigin(0.5);
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
        const float = makeLabel(this, this.blockX, this.blockY - 120, `Мутация: ${def.name}!`, 26, '#ffe9b0', { fontStyle: 'bold' });
        float.setOrigin(0.5).setDepth(25);
        this.tweens.add({ targets: float, y: float.y - 55, alpha: 0, duration: 1200, ease: 'Cubic.easeOut', onComplete: () => float.destroy() });

        this.refreshTick();
    }

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
        this.registry.set('passiveMult', 1);
        this.block.clearTint();
        if (restoreTexture && !this.blockBusy) {
            this.block.setTexture(blockStageKey(gameState.tier, Math.min(this.blockStage + 1, 4)));
        }
        this.refreshTick();
    }

    update() {
        if (!this.mutation) return;
        const remaining = this.mutation.endsAt - this.time.now;
        if (remaining <= 0) {
            this.clearMutation(true);
            return;
        }
        if (this.mutationTime) this.mutationTime.setText(`${Math.ceil(remaining / 1000)}с`);

        const palette = this.mutation.tints;
        if (palette.length > 2) {
            // Радуга: перебор цветов
            this.block.setTint(palette[Math.floor(this.time.now / 120) % palette.length]);
        } else {
            // Пульс/мерцание между двумя цветами палитры (числа, без аллокаций)
            const m = this.mutation;
            const speed = this.mutation.id === 'explosive' ? 180 : 260;
            const t = 0.5 + 0.5 * Math.sin(this.time.now / speed);
            this.block.setTint(Phaser.Display.Color.GetColor(
                Math.round(m.c1.r + (m.c2.r - m.c1.r) * t),
                Math.round(m.c1.g + (m.c2.g - m.c1.g) * t),
                Math.round(m.c1.b + (m.c2.b - m.c1.b) * t)
            ));
        }
    }

    refreshTick() {
        // UIScene сама опрашивает состояние в update(); событие — для мгновенных реакций
        this.game.events.emit('ui-refresh');
    }
}
