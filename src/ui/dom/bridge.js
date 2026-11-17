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
    getOfflineRate,
    getOfflineCapSeconds,
    canPrestige,
    getStarsGain,
    getPrestigeMult,
    PRESTIGE_REQUIREMENT,
    DIAMOND_INDEX
} from '../../state.js';
import { itemStockHint, recipeStatus } from '../../state/craftMessages.js';
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
