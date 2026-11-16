import {
    gameState,
    saveGame,
    fmt,
    SECOND_MS,
    BOSSES,
    ITEMS,
    BOSS_FIGHT_SECONDS,
    bossHpFor,
    rollBossHit,
    grantBossKill,
    useItem,
    getItemPrice,
    buyItem,
    updateBossFight,
    clearBossFight,
    getRigBuffMult,
    getPlayerMaxHp,
    bossAttackPower,
    BOSS_ATTACK_PERIOD_MS,
    BOSS_ATTACK_WINDUP_MS
} from '../../state.js';
import { computeLayout } from '../../layout.js';
import { playSfx } from '../../sfx.js';
import { makeLabel, setHitWorld, fitFontSize } from '../../ui/uiKit.js';
import { floatText, showHitFeedback } from './effects.js';
import { TEXT, TEX, EVENTS, REG, TOUCH_MIN } from '../../ui/theme.js';
import { GAME_DEPTH, BOSS_ITEM_BUFF_FIELD } from './constants.js';
import {
    BOSS_UI,
    BOSS_BAR,
    PLAYER_TEXT_COLOR,
    BOSS_HP_STROKE,
    BOSS_SPRITE_PULSE,
    bossFontSize,
    bossHealthColor,
    SLOT_LABEL_PADDING,
    MIN_SLOT_FONT,
    BOSS_WINDUP_TINT,
    BOSS_WINDUP_SHAKE_PX,
    BOSS_WINDUP_SHAKE_STEP_MS,
    BOSS_STRIKE_FLASH,
    BOSS_DEFEAT_MS,
    BOSS_SAVE_THROTTLE_MS
} from './bossLayout.js';

// Сколько секунд осталось у боевого бафа предмета (0 — баф не активен)
function buffSecondsLeft(itemId) {
    const until = gameState[BOSS_ITEM_BUFF_FIELD[itemId]] || 0;
    return Math.max(0, Math.ceil((until - Date.now()) / SECOND_MS));
}

// Слот предмета в бою: зона нажатия не ниже TOUCH_MIN по высоте (кнопка 44-60px
// даёт 24-33 CSS px на телефоне); ширина — как у картинки; вызывать после
// каждой смены размера кнопки
function touchHit(btn) {
    setHitWorld(btn, btn.displayWidth, Math.max(btn.displayHeight, TOUCH_MIN));
}

export const bossMethods = {
    // Бой: блок прячется (стадия сохраняется для возврата), на его месте босс с HP.
    // Лимита времени и ретрита нет — бой до победы ИЛИ до вырубания шахтёра:
    // босс бьёт каждые BOSS_ATTACK_PERIOD_MS (замах BOSS_ATTACK_WINDUP_MS —
    // телеграф), смерть = принудительный откат в шахту без награды, босс
    // сбрасывается. Готовность к бою: каска (HP) и снаряжение (убить быстрее).
    // HP босса/шахтёра и время персистятся в сейве (bossFight): F5 продолжает бой.
    startBossFight(bossId, restore = null) {
        if (this.boss || this.registry.get(REG.blockLocked)) return;
        const def = BOSSES.find((b) => b.id === bossId);
        if (!def) return;
        const maxHp = bossHpFor(def);
        const hp = restore ? Math.min(Math.max(1, Math.ceil(restore.hp)), maxHp) : maxHp;
        const elapsedMs = restore ? Math.max(0, Math.floor(restore.elapsedMs) || 0) : 0;
        // Живучесть шахтёра: полная при входе, из сейва при продолжении (F5)
        const maxPlayer = getPlayerMaxHp();
        const playerHp = restore
            ? Math.min(Math.max(1, Math.ceil(restore.playerHp) || maxPlayer), maxPlayer)
            : maxPlayer;
        this.boss = {
            def,
            hp,
            maxHp,
            busy: false,
            startedAt: this.time.now - elapsedMs,
            endsAt: this.time.now + BOSS_FIGHT_SECONDS * SECOND_MS,
            playerHp,
            maxPlayer,
            nextAttackAt: this.time.now + BOSS_ATTACK_PERIOD_MS,
            attacking: false
        };
        gameState.bossFight = { bossId: def.id, hp: Math.ceil(hp), playerHp, elapsedMs };
        // Зомби-цепочки разрушения гасим так же, как buildBlock: снятие твинов и
        // таймера заживления + смена поколения блока (иначе отложенный delayedCall
        // восстановил бы busy/текстуру уже под боссом)
        if (this.streakTimer) {
            this.streakTimer.remove();
            this.streakTimer = null;
        }
        this.tweens.killTweensOf(this.block);
        this.block.setVisible(false).disableInteractive();
        this.blockGen = (this.blockGen || 0) + 1;
        this.blockBusy = false;
        this.registry.set(REG.bossActive, true);
        this.buildBossOverlay();
        this.startBossBgm();
        // Персист сразу: F5 сразу после входа в бой продолжает его с полного HP
        saveGame();
        // UIScene перестраивает панель (секция «Снаряжение») и портретную сетку
        this.game.events.emit(EVENTS.bossChanged);
        this.refreshTick();
    },

    buildBossOverlay() {
        const bx = this.blockX;
        // Оверлей босса — от ОДНОГО источника геометрии: L.fight.by (спека
        // мобильного редизайна; ландшафтная ветка не тронута)
        const L = computeLayout(this.scale.gameSize.width, this.scale.gameSize.height);
        const isPortrait = L.portrait;
        const ui = isPortrait ? BOSS_UI.portrait : BOSS_UI.landscape;
        const by = isPortrait ? L.fight.by : this.blockY;
        this._bossBy = by;
        this.bossUi = this.add.container(0, 0).setDepth(GAME_DEPTH.bossOverlay);
        const uiScene = this.scene.get('UIScene');
        const ps = (uiScene && uiScene._adaptiveScale) || 1;

        const sprite = this.add
            .image(bx, by + ui.sprite.dy, this.boss.def.icon)
            .setDisplaySize(ui.sprite.size, ui.sprite.size);
        sprite.setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (pointer) => this.performBossHit(pointer.worldX, pointer.worldY, false));
        this.bossSprite = sprite;

        this.bossBar = this.add.graphics();
        // Полоса живучести шахтёра — под баром босса (цвет другой, чтобы читались
        // обе: босс зелёно-красный, шахтёр оранжевый)
        this.playerBar = this.add.graphics();
        this.playerHpText = makeLabel(
            this,
            bx,
            by + ui.playerText.dy,
            '',
            bossFontSize(ui.playerText, ps),
            PLAYER_TEXT_COLOR
        ).setOrigin(0.5);
        this.bossName = makeLabel(
            this,
            bx,
            by + ui.name.dy,
            this.boss.def.name,
            bossFontSize(ui.name, ps),
            TEXT.gold
        ).setOrigin(0.5);
        this.bossHpText = makeLabel(this, bx, by + ui.hpText.dy, '', bossFontSize(ui.hpText, ps), TEXT.white).setOrigin(
            0.5
        );
        if (ui.hpText.stroke) this.bossHpText.setStroke(BOSS_HP_STROKE.color, BOSS_HP_STROKE.width);
        this.bossTime = makeLabel(
            this,
            bx + ui.time.dx,
            by + ui.time.dy,
            '0:00',
            bossFontSize(ui.time, ps),
            TEXT.cream
        ).setOrigin(ui.time.originX, 0.5);

        this.bossUi.add([
            sprite,
            this.bossBar,
            this.playerBar,
            this.playerHpText,
            this.bossName,
            this.bossHpText,
            this.bossTime
        ]);

        this.bossItems = [];
        const usable = ITEMS.filter((it) => it.bossUse);
        const slot = ui.slot;
        usable.forEach((it, i) => {
            const cx = bx + (i - (usable.length - 1) / 2) * slot.step;
            const slotY = by + slot.dy;
            const btn = this.add.image(cx, slotY, TEX.button).setDisplaySize(slot.activeW, slot.h);
            touchHit(btn);
            const icon = this.add.image(cx + slot.iconDx, slotY, it.id).setDisplaySize(slot.iconSize, slot.iconSize);
            const cnt = makeLabel(this, cx + slot.cntDx, slotY, '', bossFontSize(slot.cnt, ps), TEXT.white).setOrigin(
                0.5
            );
            const buyLbl = makeLabel(this, cx, slotY, '', bossFontSize(slot.buy, ps), TEXT.white).setOrigin(0.5);
            btn.on('pointerdown', () => {
                if (!this.boss || this.boss.busy) return;
                if (Date.now() < gameState.bossBuffUntil) return; // баф уже активен — покупка впустую
                const stock = gameState.items[it.id] || 0;
                if (stock > 0) {
                    if (useItem(it.id, true)) playSfx(this, 'purchase');
                } else if (buyItem(it.id)) {
                    playSfx(this, 'purchase');
                    useItem(it.id, true);
                }
                this.refreshBossItems();
                this.refreshTick();
            });
            this.bossUi.add([btn, icon, cnt, buyLbl]);
            this.bossItems.push({ id: it.id, def: it, btn, icon, cnt, buyLbl });
        });
        this.refreshBossItems();

        // Подсказка эффектов под слотами: только в ландшафте — в портрете
        // описания читаются в панели «Снаряжение» (спека редизайна)
        if (ui.hint) {
            this.bossHint = makeLabel(
                this,
                bx,
                by + ui.hint.dy,
                usable.map((it) => it.desc).join(' · '),
                ui.hint.size,
                TEXT.soft
            ).setOrigin(0.5);
            this.bossUi.add(this.bossHint);
        }

        this.tweens.add({
            targets: sprite,
            scaleX: sprite.scaleX + BOSS_SPRITE_PULSE,
            scaleY: sprite.scaleY + BOSS_SPRITE_PULSE,
            duration: 1400,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        this.drawBossBar();
    },

    // Геометрия оверлея по текущей ориентации экрана
    bossUiSpec() {
        const portrait = this.scale.gameSize.height > this.scale.gameSize.width;
        return portrait ? BOSS_UI.portrait : BOSS_UI.landscape;
    },

    // Рамка + заливка полосы: x,y,w,h — внешний прямоугольник
    drawBar(g, x, y, w, h, frac, fillColor) {
        g.clear();
        g.fillStyle(BOSS_BAR.background, 1);
        g.fillRect(x, y, w, h);
        g.fillStyle(fillColor, 1);
        g.fillRect(
            x + BOSS_BAR.border,
            y + BOSS_BAR.border,
            Math.max(0, (w - 2 * BOSS_BAR.border) * frac),
            h - 2 * BOSS_BAR.border
        );
    },

    drawBossBar() {
        if (!this.boss || !this.bossBar) return;
        // Портрет (спека): бар 380x24 в стэке над слотами; ландшафт — 340x20
        const bar = this.bossUiSpec().hpBar;
        const x = this.blockX - bar.w / 2,
            y = (this._bossBy || this.blockY) + bar.dy;
        const frac = Math.max(0, Math.min(1, this.boss.hp / this.boss.maxHp));
        this.drawBar(this.bossBar, x, y, bar.w, bar.h, frac, bossHealthColor(frac));
        this.bossHpText.setText(`${fmt(Math.max(0, Math.ceil(this.boss.hp)))} / ${fmt(this.boss.maxHp)}`);
        this.drawPlayerBar();
    },

    // Полоса живучести шахтёра: оранжевая, под баром босса; подпись HP справа
    drawPlayerBar() {
        if (!this.boss || !this.playerBar) return;
        const bar = this.bossUiSpec().playerBar;
        const x = this.blockX - bar.w / 2,
            y = (this._bossBy || this.blockY) + bar.dy;
        const frac = Math.max(0, Math.min(1, this.boss.playerHp / this.boss.maxPlayer));
        this.drawBar(this.playerBar, x, y, bar.w, bar.h, frac, BOSS_BAR.playerColor);
        this.playerHpText.setText(
            `ты: ${fmt(Math.max(0, Math.ceil(this.boss.playerHp)))} / ${fmt(this.boss.maxPlayer)} · удар босса ${fmt(bossAttackPower(this.boss.def))}`
        );
    },
    // Удар босса по шахтёру: смена цвета спрайта и дрожь уже отыграны замахом.
    // Урон фиксированный (bossAttackPower), красная вспышка + тряска камеры,
    // флоат у полосы шахтёра. HP <= 0 -> bossDown.
    bossStrike() {
        const b = this.boss;
        if (!b || b.busy) return;
        const dmg = bossAttackPower(b.def);
        b.playerHp = Math.max(0, b.playerHp - dmg);
        this.cancelBossWindup();
        this.bossSprite.clearTint();
        this.bossSprite.x = this.blockX;
        this.boss.nextAttackAt += BOSS_ATTACK_PERIOD_MS;
        b.attacking = false;
        playSfx(this, 'boss_hit', 3, 1, 0.55);
        this.cameras.main.shake(180, 0.006);
        const flash = this.add
            .rectangle(this.blockX, this._bossBy || this.blockY, 1280, 720, BOSS_STRIKE_FLASH.color, 0)
            .setDepth(GAME_DEPTH.bossFlash);
        this.tweens.add({
            targets: flash,
            alpha: { from: BOSS_STRIKE_FLASH.alpha, to: 0 },
            duration: BOSS_STRIKE_FLASH.durationMs,
            onComplete: () => flash.destroy()
        });
        floatText(this, this.blockX, (this._bossBy || this.blockY) - 120, `-${fmt(dmg)}`, 24, '#ff7a6a', {
            depth: GAME_DEPTH.bossFloat,
            rise: 45,
            duration: 700,
            ease: 'Cubic.easeOut'
        });
        this.drawPlayerBar();
        if (b.playerHp <= 0) this.bossDown(b);
    },

    // Шахтёр вырублен: принудительный откат в шахту. Босс сбрасывается,
    // награды нет, боевые бафы гасятся — смысл: копи руду, прокачай каску и
    // снаряжение, возвращайся сильнее.
    bossDown(b) {
        if (!b) return;
        b.busy = true;
        clearBossFight();
        this.leaveBossFight();
        // Боевые бафы не живут вне боя (смерть — это конец боя)
        gameState.bossBuffUntil = 0;
        gameState.rigBuffUntil = 0;
        gameState.oilBuffUntil = 0;
        this.game.events.emit(EVENTS.bossChanged);
        this.game.events.emit(EVENTS.playerDown, {
            bossName: b.def.name,
            dmg: bossAttackPower(b.def),
            maxPlayer: getPlayerMaxHp()
        });
        saveGame();
    },

    // Слоты предметов в бою, три состояния: активный баф (иконка + таймер —
    // иначе иконка «пропадала» сразу после активации, замечание игрока),
    // запас («x N») и пустой («купить N» с динамической ценой; покупка сразу
    // кладёт предмет в стак и активирует). Кеш-ключ на слот: performBossHit
    // зовёт это на каждый удар; таймер бафа тикает из update().
    refreshBossItems() {
        if (!this.bossItems) return;
        // Своё состояние бафа у каждого предмета: бомба -> bossBuff, рама ->
        // rigBuff, точило -> oilBuff (общий bossBuffUntil для всех слотов —
        // прежний баг: слоты рамы/точила показывали чужой таймер).
        // Размеры слотов — от ориентации (портрет: 120x60/132x60, спека редизайна)
        const spec = this.bossUiSpec().slot;
        const ui = this.scene.get('UIScene');
        const ps = (ui && ui._adaptiveScale) || 1;
        for (const slot of this.bossItems) {
            const stock = gameState.items[slot.id] || 0;
            const buffLeft = buffSecondsLeft(slot.id);
            if (buffLeft > 0) {
                const key = `a${buffLeft}`;
                if (slot._key === key) continue;
                slot._key = key;
                this.showFilledSlot(
                    slot,
                    spec,
                    `${Math.floor(buffLeft / 60)}:${String(buffLeft % 60).padStart(2, '0')}`
                );
            } else if (stock > 0) {
                const key = `x${stock}`;
                if (slot._key === key) continue;
                slot._key = key;
                this.showFilledSlot(slot, spec, `x${stock}`);
            } else {
                const price = getItemPrice(slot.id);
                const affordable = gameState.ore >= price;
                const key = `b${price}|${affordable ? 'n' : 'g'}`;
                if (slot._key === key) continue;
                slot._key = key;
                slot.btn
                    .setDisplaySize(spec.emptyW, spec.h)
                    .setTexture(affordable ? TEX.button : TEX.buttonDisabled)
                    .setAlpha(1);
                touchHit(slot.btn);
                slot.icon.setVisible(false);
                slot.cnt.setVisible(false);
                slot.buyLbl.setVisible(true).setText(`Купить ${fmt(price)}`);
                fitFontSize(slot.buyLbl, bossFontSize(spec.buy, ps), spec.emptyW - SLOT_LABEL_PADDING, MIN_SLOT_FONT);
            }
        }
    },

    // Слот с активным бафом или запасом: иконка + подпись (таймер либо «xN»)
    showFilledSlot(slot, spec, caption) {
        slot.btn.setDisplaySize(spec.activeW, spec.h).setTexture(TEX.button).setAlpha(1);
        touchHit(slot.btn);
        slot.icon
            .setVisible(true)
            .setPosition(slot.btn.x + spec.iconDx, slot.btn.y)
            .setDisplaySize(spec.iconSize, spec.iconSize);
        slot.cnt.setVisible(true).setText(caption);
        slot.buyLbl.setVisible(false);
    },
    // Удар по боссу: флоат/частицы/звук по образцу performMine, но без addOre —
    // урон идёт в HP босса, награда только за убийство (grantBossKill).
    performBossHit(px, py, isAuto) {
        if (!this.boss || this.boss.busy) return;
        const { gain, crit, lucky } = rollBossHit();
        // «Робо-рама»: множитель только для АВТО-ударов (робо-рука)
        const total = isAuto ? gain * getRigBuffMult() : gain;
        this.boss.hp -= total;
        if (!isAuto) {
            // Удар по боссу звучит заметно тише рудных кликов: тяжёлый удар
            // на каждый клик на полной громкости утомлял (замечание игрока)
            playSfx(this, 'boss_hit', 3, 1, 0.4);
            if (crit || lucky) playSfx(this, 'crit');
            if (crit || lucky) this.cameras.main.shake(120, 0.004);
        }
        showHitFeedback(this, px, py, total, { crit, lucky, isAuto }, GAME_DEPTH.bossFloat);
        this.drawBossBar();
        this.refreshBossItems();
        if (this.boss.hp <= 0) this.killBoss();
        this.refreshTick();
    },

    killBoss() {
        const b = this.boss;
        if (!b || b.busy) return;
        b.busy = true;
        this.tweens.killTweensOf(this.bossSprite);
        this.debrisEmitter.explode(40, this.blockX, this._bossBy || this.blockY);
        this.tweens.add({
            targets: this.bossSprite,
            scale: 0,
            alpha: 0,
            duration: BOSS_DEFEAT_MS,
            ease: 'Quad.easeIn',
            onComplete: () => {
                // Бой завершён — персист-запись гасится до сейва награды,
                // иначе перезагрузка в окне анимации возобновила бы мёртвый бой
                clearBossFight();
                // Время боя определяет бонус за скорость (×0.75..×1.5 к баунти)
                const reward = grantBossKill(b.def.id, this.time.now - b.startedAt);
                this.leaveBossFight();
                this.game.events.emit(EVENTS.bossChanged);
                if (reward) this.game.events.emit(EVENTS.bossDefeated, { bossId: b.def.id, ...reward });
            }
        });
    },

    // Отступление: награды нет, запись боя из сейва стирается. Игроку недоступно
    // (крестика и лимита времени больше нет, F5 продолжает бой) — путь остался
    // для shutdown/DevPanel.
    retreatBoss() {
        const b = this.boss;
        if (!b || b.busy) return;
        b.busy = true;
        this.cancelBossWindup();
        this.bossSprite.clearTint();
        clearBossFight();
        this.leaveBossFight();
        saveGame();
        this.game.events.emit(EVENTS.bossChanged);
        floatText(this, this.blockX, this.blockY - 120, 'Босс восстановился', 22, TEXT.soft, {
            depth: GAME_DEPTH.bossFloat,
            rise: 50,
            duration: 1100
        });
    },

    // Общий выход из боя (победа / вырубание / отступление): оверлей снят, блок
    // возвращён, босс-тема остановлена. Событие boss-changed шлёт вызывающий —
    // порядок относительно других событий зависит от сценария.
    leaveBossFight() {
        this.destroyBossOverlay();
        this.boss = null;
        this.registry.set(REG.bossActive, false);
        this.stopBossBgm();
        this.block.setVisible(true).setInteractive({ useHandCursor: true });
    },

    // Дрожь спрайта перед ударом (телеграф) — остановка твина
    cancelBossWindup() {
        if (this._windupTween) {
            this._windupTween.stop();
            this._windupTween = null;
        }
    },

    destroyBossOverlay() {
        if (!this.bossUi) return;
        for (const ch of this.bossUi.list.slice()) this.tweens.killTweensOf(ch);
        this.bossUi.destroy();
        this.bossUi = null;
        this.bossSprite = null;
        this.bossBar = null;
        this.bossName = null;
        this.bossHpText = null;
        this.bossTime = null;
        this.bossItems = null;
    },

    // Тик боя: таймер, персист, бафы слотов, цикл атак босса
    tickBoss() {
        if (!(this.boss && this.bossTime)) return;
        const elapsedMs = this.time.now - this.boss.startedAt;
        const secs = Math.max(0, Math.floor(elapsedMs / SECOND_MS));
        this.bossTime.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
        // Персист боя: HP босса/шахтёра и время в состоянии; сейв не чаще раза в
        // BOSS_SAVE_THROTTLE_MS (клики по боссу частые — localStorage на каждый удар недопустим)
        updateBossFight(this.boss.hp, elapsedMs, this.boss.playerHp);
        if (this.time.now >= this._bossSaveAt) {
            this._bossSaveAt = this.time.now + BOSS_SAVE_THROTTLE_MS;
            saveGame();
        }
        // Таймеры боевых слотов тикают и без кликов игрока (любой из бафов)
        const now = Date.now();
        if (Object.values(BOSS_ITEM_BUFF_FIELD).some((field) => now < gameState[field])) this.refreshBossItems();
        this.tickBossAttack();
    },

    // Цикл атак босса: замах (телеграф) -> удар по шахтёру. Смерть шахтёра =
    // принудительный откат в шахту (bossDown) — смысл готовиться к бою.
    tickBossAttack() {
        const now = this.time.now;
        const b = this.boss;
        if (b.busy) return;
        if (!b.attacking && now >= b.nextAttackAt - BOSS_ATTACK_WINDUP_MS) {
            b.attacking = true;
            // Телеграф: красный тинт + горизонтальная дрожь спрайта
            this.bossSprite.setTint(BOSS_WINDUP_TINT);
            this._windupTween = this.tweens.add({
                targets: this.bossSprite,
                x: this.blockX - BOSS_WINDUP_SHAKE_PX,
                duration: BOSS_WINDUP_SHAKE_STEP_MS,
                yoyo: true,
                repeat: Math.ceil(BOSS_ATTACK_WINDUP_MS / BOSS_WINDUP_SHAKE_STEP_MS) - 1
            });
        }
        if (b.attacking && now >= b.nextAttackAt) {
            this.bossStrike();
        }
    }
};
