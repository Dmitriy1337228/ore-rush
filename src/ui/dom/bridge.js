// Мост DOM ↔ игровое состояние (этап 2 пилота, шаг 2.1).
// Только ЧТЕНИЕ state.js: никаких мутаторов. Возвращает плоский снимок нужных
// полей, пригодный для отрисовки без знаний о бизнес-логике; тексты ошибок —
// из src/state/craftMessages.js (единый источник).
//
// Публикация: UIScene.update -> bridge.tick() не чаще PUBLISH_MS; подписчик
// получает снимок только если он изменился (сравнение строкой), поэтому DOM
// обновляет узлы по ключам, а не каждый кадр.

import {
    gameState,
    fmt,
    getItemPrice,
    canCraft,
    ITEMS,
    CRAFT_RECIPES,
    ARTIFACTS,
    COMPONENTS,
    BOSSES,
    TIERS,
    UPGRADES,
    getUpgradeDef,
    getUpgradeLevel,
    getUpgradeCost,
    getBulkCost,
    getAffordableBulk,
    isMaxed,
    isUpgradeAvailable,
    isUpgradeVisible,
    getOfflineRate,
    getOfflineCapSeconds,
    canPrestige,
    getStarsGain,
    getPrestigeMult,
    PRESTIGE_REQUIREMENT,
    DIAMOND_INDEX,
    DAILY_REWARDS,
    OFFLINE_CAP_HOURS,
    getOrePerSecond,
    fmtDuration
} from '../../state.js';
import { itemStockHint, recipeStatus } from '../../state/craftMessages.js';
import {
    bossRewardBounty,
    bossRewardSpeed,
    dailyDesc,
    dailyStreak,
    offlineBody,
    playerDownBody,
    statusButtons,
    statusTitles
} from '../../state/statusMessages.js';
import {
    BUY_AMOUNTS,
    TABS,
    bulkLabel,
    bulkPriceText,
    buyLabel,
    levelText,
    lockedLabel,
    lockRequiresText,
    lockTierText,
    maxedLabel,
    maxPriceText
} from '../../state/upgradesMessages.js';
import {
    musicLabel,
    prestigeIdle,
    prestigeInfo,
    resetIdle,
    settingsStats,
    soundLabel,
    volumeText
} from '../../state/settingsMessages.js';

export const PUBLISH_MS = 150; // 100–250 мс по плану

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const mins = (ms) => Math.round(ms / 60000);

const bossName = (id) => {
    const boss = BOSSES.find((b) => b.id === id);

    return boss ? boss.name : 'босс';
};

const artifactLine = (def) => {
    if (def.source && def.source.startsWith('boss_')) {
        return `Босс: ${bossName(def.source)}`;
    }

    return 'Скрафти: рецепт';
};

// Подсказка по тапу на артефакт (2 с): откуда взять.
const artifactHint = (def) => {
    if (def.source && def.source.startsWith('boss_')) {
        return `Получишь у босса: ${bossName(def.source)}`;
    }

    return 'Скрафти: рецепт';
};

export function snapshot({ bossActive = false, now = Date.now() } = {}) {
    const components = COMPONENTS.map((c) => {
        const count = gameState.components[c.id] || 0;

        return { id: c.id, icon: c.icon, count, text: fmt(count) };
    });

    const items = ITEMS.map((def) => {
        const stock = gameState.items[def.id] || 0;
        const price = getItemPrice(def.id);
        const eff = def.effect || {};
        let buffLeft = 0;
        let buffMult = 1;
        if (eff.bossMult) {
            buffLeft = gameState.bossBuffUntil - now;
            buffMult = gameState.bossBuffMult;
        } else if (eff.miningMult) {
            buffLeft = gameState.miningBuffUntil - now;
            buffMult = gameState.miningBuffMult;
        } else if (eff.veinForce) {
            buffLeft = gameState.itemVeinUntil - now;
        }

        const active = buffLeft > 0;
        const blocked = stock <= 0 || (def.bossUse && !bossActive) || (active && buffLeft > 30000);
        let hint = itemStockHint({ stock, bossUse: def.bossUse });
        let hintKind = stock <= 0 || def.bossUse ? 'warn' : 'gold';
        if (active) {
            const label = eff.bossMult ? 'бомба' : eff.veinForce ? 'жила' : `x${buffMult}`;
            hint = `в запасе: ${stock} · ${label} ${mmss(buffLeft)}`;
            hintKind = 'gold';
        }

        return {
            id: def.id,
            icon: def.id,
            name: def.name,
            desc: def.desc,
            stock,
            stackMax: def.stackMax,
            price,
            priceText: fmt(price),
            bossUse: !!def.bossUse,
            active,
            blocked,
            buyBlocked: gameState.ore < price || stock >= def.stackMax,
            hint,
            hintKind
        };
    });

    const busy = !!gameState.crafting;
    const craftLeft = busy ? gameState.crafting.endsAt - now : 0;
    const recipes = CRAFT_RECIPES.map((recipe) => {
        const mine = busy && gameState.crafting.recipeId === recipe.id;
        const ready = mine && now >= gameState.crafting.endsAt;
        const def =
            recipe.result.kind === 'item'
                ? ITEMS.find((i) => i.id === recipe.result.id)
                : ARTIFACTS.find((a) => a.id === recipe.result.id);
        const owned = recipe.result.kind === 'artifact' && gameState.artifacts.includes(recipe.result.id);
        const space = def && def.stackMax !== undefined ? def.stackMax - (gameState.items[def.id] || 0) : 0;
        const compsOk = Object.keys(recipe.cost).every((c) => (gameState.components[c] || 0) >= recipe.cost[c]);
        const status = recipeStatus({ mine, owned, busy, space, resultN: recipe.result.n, compsOk });
        const disabled = !mine && (owned || busy || !canCraft(recipe.id));
        let button;
        if (mine) {
            button = ready ? 'Забрать' : mmss(craftLeft);
        } else if (recipe.craftMs === 0) {
            button = 'Создать';
        } else {
            button = `Крафт ${mins(recipe.craftMs)} мин`;
        }

        return {
            id: recipe.id,
            icon: recipe.result.id,
            name: def ? def.name : recipe.id,
            resultText:
                recipe.result.kind === 'item'
                    ? `Получишь: ${recipe.result.n} шт.`
                    : `Получишь: ${def ? def.name : 'артефакт'}`,
            need: Object.keys(recipe.cost).map((c) => ({
                id: c,
                icon: `comp_${c}`,
                n: recipe.cost[c],
                enough: (gameState.components[c] || 0) >= recipe.cost[c]
            })),
            source: `дроп: ${recipe.result.kind === 'item' ? 'компоненты боссов' : 'крафт'}`,
            status,
            button,
            disabled,
            mine,
            ready,
            // Мгновенный рецепт: Phaser после startCraft сразу зовёт claimCraft()
            instant: recipe.craftMs === 0
        };
    });

    const artifacts = ARTIFACTS.map((def) => {
        const owned = gameState.artifacts.includes(def.id);

        return {
            id: def.id,
            icon: def.id,
            name: def.name,
            owned,
            line: owned ? def.desc : artifactLine(def),
            hint: artifactHint(def)
        };
    });

    return {
        ore: gameState.ore,
        oreText: fmt(gameState.ore),
        bossActive,
        components,
        items,
        recipes,
        artifacts,
        crafting: busy
            ? {
                  recipeId: gameState.crafting.recipeId,
                  leftMs: Math.max(0, craftLeft),
                  ready: now >= gameState.crafting.endsAt,
                  text: mmss(Math.max(0, craftLeft))
              }
            : null
    };
}

// Публикация снимков: throttle + диф строкой. Не трогает state.
export function createPublisher(emit, { intervalMs = PUBLISH_MS, getContext } = {}) {
    let last = null;
    let lastAt = 0;

    return {
        tick(now = Date.now()) {
            if (now - lastAt < intervalMs) {
                return false;
            }

            lastAt = now;
            const snap = snapshot((getContext && getContext()) || {});
            const key = JSON.stringify(snap);
            if (key === last) {
                return false;
            }

            last = key;
            emit(snap);

            return true;
        },
        reset() {
            last = null;
            lastAt = 0;
        }
    };
}

// ---------- Настройки (фаза 2, шаг 2.3): только чтение, тексты — из settingsMessages ----------
export function settingsSnapshot({ bossActive = false, portrait = false } = {}) {
    const tier = TIERS[gameState.tier];
    const mult = getPrestigeMult().toFixed(1);
    const can = canPrestige();
    const gain = getStarsGain();
    const have = gameState.tierEarned[DIAMOND_INDEX];
    const need = PRESTIGE_REQUIREMENT;
    const volume = gameState.musicVolume;
    const stats = settingsStats({
        tierIndex: gameState.tier,
        tierName: tier.name,
        stars: gameState.stars,
        mult,
        clicks: gameState.clicks,
        lifetime: gameState.lifetimeMined,
        ratePct: Math.round(getOfflineRate() * 100),
        capHours: getOfflineCapSeconds() / 3600
    });

    return {
        tierIndex: gameState.tier,
        tierName: tier.name,
        stars: gameState.stars,
        mult,
        clicks: gameState.clicks,
        lifetime: gameState.lifetimeMined,
        stats,
        soundOn: !!gameState.soundOn,
        musicOn: !!gameState.musicOn,
        musicVolume: volume,
        volumeText: volumeText(volume),
        labels: {
            sound: soundLabel(!!gameState.soundOn),
            music: musicLabel(!!gameState.musicOn),
            prestige: prestigeIdle,
            reset: resetIdle
        },
        canPrestige: can,
        gain,
        have,
        need,
        pct: Math.floor((have / need) * 100),
        prestigeLines: prestigeInfo({ can, gain, have, need, portrait }),
        bossLocked: !!bossActive
    };
}

// ---------- Статус-модалки (фаза 3, шаг 1.2): только чтение ----------
// Phaser-путь берёт те же числа и тексты из state/statusMessages: DOM не вычисляет
// награды, не пишет gameState — только раскладывает готовый снимок по узлам.
export function offlineSnapshot(info = {}) {
    const tier = TIERS[gameState.tier];
    const level = getUpgradeLevel('warehouse');
    const capHours = OFFLINE_CAP_HOURS[Math.min(level, OFFLINE_CAP_HOURS.length - 1)];

    return {
        kind: 'offline',
        title: statusTitles.offline,
        okLabel: statusButtons.offline,
        body: offlineBody({
            seconds: info.seconds || 0,
            reward: info.reward || 0,
            tierName: tier.name,
            ratePct: Math.round(getOfflineRate() * 100),
            orePerSec: getOrePerSecond(),
            capHours,
            counted: info.counted || 0
        })
    };
}

export function dailySnapshot(info = {}) {
    const streak = info.streak || 1;
    const idx = (streak - 1) % DAILY_REWARDS.length;
    const reward = DAILY_REWARDS[idx];

    return {
        kind: 'daily',
        title: statusTitles.daily,
        okLabel: statusButtons.daily,
        streakText: dailyStreak(streak),
        icon: reward.icon,
        name: reward.name,
        desc: dailyDesc(reward, info),
        slots: DAILY_REWARDS.map((r, i) => ({ icon: r.icon, active: i === idx }))
    };
}

export function bossRewardSnapshot(reward = {}) {
    const comps = Object.keys(reward.comps || {})
        .map((id) => {
            const def = COMPONENTS.find((c) => c.id === id);
            if (!def) {
                return null;
            }

            return { id, icon: def.icon, name: def.name, countText: `×${reward.comps[id]}` };
        })
        .filter(Boolean);
    const artDef = reward.artifactId ? ARTIFACTS.find((a) => a.id === reward.artifactId) : null;

    return {
        kind: 'boss-reward',
        title: statusTitles['boss-reward'],
        okLabel: statusButtons['boss-reward'],
        bountyText: bossRewardBounty(reward.bounty || 0),
        speedText: bossRewardSpeed(reward),
        comps,
        artifact: artDef ? { id: artDef.id, icon: artDef.id, name: artDef.name, desc: artDef.desc } : null
    };
}

export function playerDownSnapshot(info = {}) {
    return {
        kind: 'player-down',
        title: statusTitles['player-down'],
        okLabel: statusButtons['player-down'],
        body: playerDownBody({
            bossName: info.bossName || 'Босс',
            dmg: info.dmg || 0,
            maxPlayer: info.maxPlayer || 0
        })
    };
}

// ---------- Список улучшений (фаза 3, шаг 2.2): только чтение ----------
// Цены, пакеты и МАКС считает только state (getBulkCost/getAffordableBulk): DOM их
// не пересчитывает, а показывает готовые числа. Активная вкладка и выбранный пакет —
// представление (UI-состояние контроллера), бизнес-правил здесь нет.
const PICKAXE_ICONS = ['pickaxe_wooden', 'pickaxe_stone', 'pickaxe_iron', 'pickaxe_diamond'];

function upgradeIcon(def, level) {
    if (def.id === 'pickaxe') {
        return PICKAXE_ICONS[Math.min(Math.floor(level / 3), PICKAXE_ICONS.length - 1)];
    }

    return def.icon || 'gear_icon';
}

function upgradeRow(def, buyAmount) {
    const level = getUpgradeLevel(def.id);
    const maxed = isMaxed(def.id);
    const available = isUpgradeAvailable(def.id);
    const amount = buyAmount === 'max' ? 'max' : Number(buyAmount) || 1;
    const row = {
        id: def.id,
        icon: upgradeIcon(def, level),
        name: def.name,
        desc: def.effect,
        level,
        levelText: levelText(level),
        available,
        maxed,
        buttonLabel: buyLabel,
        buttonDim: true,
        priceText: '',
        priceKind: 'gold',
        lockText: '',
        visible: isUpgradeVisible(def.id)
    };

    if (!available) {
        row.buttonLabel = lockedLabel;
        row.lockText =
            def.tier !== undefined && gameState.tier < def.tier
                ? lockTierText(def.tier)
                : lockRequiresText(getUpgradeDef(def.requires.id).name, def.requires.level);

        return row;
    }

    if (maxed) {
        row.buttonLabel = maxedLabel;
        row.priceText = maxedLabel;
        row.priceKind = 'dim';

        return row;
    }

    if (amount === 'max') {
        const r = getAffordableBulk(def.id, Infinity);
        row.buttonDim = !(r.n > 0);
        row.priceText = maxPriceText({ total: r.total, n: r.n, fallback: getUpgradeCost(def.id) });
    } else {
        const b = getBulkCost(def.id, amount);
        const r = getAffordableBulk(def.id, amount);
        row.buttonDim = !(b.n > 0 && r.n === b.n);
        row.priceText = bulkPriceText({ total: b.total, n: b.n, amount });
    }

    return row;
}

export function upgradesSnapshot({ tab = 'equipment', buyAmount = 1, bossActive = false, portrait = false } = {}) {
    const active = TABS.some((t) => t.id === tab) ? tab : TABS[0].id;
    const amount = BUY_AMOUNTS.includes(buyAmount) ? buyAmount : 1;
    const rows = UPGRADES.filter((def) => def.tab === active).map((def) => upgradeRow(def, amount));

    return {
        tab: active,
        tabs: TABS.map((t) => ({ id: t.id, label: t.label, active: t.id === active })),
        buyAmount: amount,
        bulk: BUY_AMOUNTS.map((a) => ({ amount: a, label: bulkLabel(a), active: a === amount })),
        rows,
        bossActive: !!bossActive,
        portrait: !!portrait
    };
}
