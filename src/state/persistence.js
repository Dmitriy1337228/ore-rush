// Загрузка сейва в gameState: валидация и приведение каждого поля, сброс игры.

import { gameState, createInitialState } from './gameState.js';
import {
    SAVE_VERSION,
    DEFAULT_MUSIC_VOLUME,
    BUFF_MULT_SAVE_CAP,
    RIG_MULT_SAVE_CAP,
    OIL_ADD_SAVE_CAP
} from './constants.js';
import { TIERS } from './catalog/tiers.js';
import { UPGRADES } from './catalog/upgrades.js';
import {
    BOSSES,
    COMPONENTS,
    ARTIFACTS,
    ITEMS,
    CRAFT_RECIPES,
    BOSS_RECORD_MIN_SEC,
    BOSS_RECORD_MAX_SEC
} from './catalog/meta.js';
import { getBossDef } from './catalog/lookup.js';
import { YandexSDKStub } from '../sdk-stub.js';
import { saveGame } from './ore.js';
import { bossHpFor, computePlayerMaxHp } from './boss.js';
import { applyLegacyV1, migrateSaveData } from './migrations.js';
import {
    nonNegative,
    nonNegativeInt,
    finitePositive,
    intInRange,
    futureTimestamp,
    multiplierOrOne,
    activeMultiplier,
    activeAddition,
    pickCatalogRecord
} from './sanitize.js';

// Прогресс забега: руда, тир, звёзды, добыча по тирам.
function applyProgress(data) {
    // Infinity (битый сейв «ore: 1e999») / NaN / отрицательное → 0: иначе МАКС-покупка
    // вечным циклом вешает вкладку (getAffordableBulk против Infinity не завершается)
    gameState.ore = finitePositive(data.ore);
    gameState.tier = Math.min(Math.max(0, Number(data.tier) || 0), TIERS.length - 1);
    gameState.stars = nonNegative(data.stars);
    gameState.clicks = nonNegative(data.clicks);
    gameState.lifetimeMined = nonNegative(data.lifetimeMined);
    gameState.tierEarned = TIERS.map((_, i) => nonNegative(data.tierEarned && data.tierEarned[i]));
    gameState.tierAnchorRate = nonNegative(data.tierAnchorRate);
}

// Настройки игрока: старые сейвы без флагов = обучение пропущено, звук/музыка включены.
function applyPreferences(data) {
    gameState.tutorialDone = data.tutorialDone !== false;
    gameState.soundOn = data.soundOn !== false;
    gameState.musicOn = data.musicOn !== false;
    const volume = Number(data.musicVolume); // 0 должен сохраняться как 0 — не через ||
    gameState.musicVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_MUSIC_VOLUME;
}

// Ежедневные награды: отсутствие полей в старых сейвах = чистая серия.
function applyDaily(data, now) {
    gameState.dailyStreak = nonNegativeInt(data.dailyStreak);
    gameState.lastDailyDay = Math.floor(finitePositive(data.lastDailyDay));
    gameState.dailyBuffUntil = futureTimestamp(data.dailyBuffUntil, now); // истёкший баф не resurrect
    gameState.dailyBuffMult = multiplierOrOne(data.dailyBuffMult, BUFF_MULT_SAVE_CAP);
    gameState.dailyCritUntil = futureTimestamp(data.dailyCritUntil, now);
    gameState.dailyVeinUntil = futureTimestamp(data.dailyVeinUntil, now);
}

// Незавершённый босс-бой: валиден только при живом боссе каталога и осмысленном
// HP (0 < hp <= максимум); иначе бой молча сбрасывается.
// playerHp клампится к текущей живучести шахтёра.
function restoreBossFight(raw, data) {
    if (!raw || typeof raw !== 'object') return null;
    const def = getBossDef(raw.bossId);
    const hp = Math.floor(Number(raw.hp));
    const playerHp = Math.floor(Number(raw.playerHp));
    const elapsedMs = nonNegativeInt(raw.elapsedMs);
    if (!def || !(hp > 0 && hp <= bossHpFor(def))) return null;
    const helmetLevel = Number(data.levels && data.levels.helmet) || 0;
    const maxPlayer = computePlayerMaxHp(helmetLevel, Number(data.tier) || 0);
    return {
        bossId: raw.bossId,
        hp,
        playerHp: Math.min(Math.max(1, playerHp), maxPlayer),
        elapsedMs
    };
}

// Верстак: валиден только с рецептом каталога и осмысленным временем окончания.
function restoreCrafting(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const endsAt = finitePositive(raw.endsAt);
    if (!endsAt || !CRAFT_RECIPES.some((r) => r.id === raw.recipeId)) return null;
    return { recipeId: raw.recipeId, endsAt };
}

// Мета-прогресс (карта/боссы/артефакты/крафт): счётчики целые >= 0, ключи
// только из каталогов; бафы предметов — wall-clock, истёкшие не resurrect.
function applyMeta(data) {
    gameState.components = pickCatalogRecord(data.components, COMPONENTS, nonNegativeInt);
    gameState.items = pickCatalogRecord(data.items, ITEMS, nonNegativeInt);
    gameState.artifacts = Array.isArray(data.artifacts)
        ? [...new Set(data.artifacts.filter((id) => ARTIFACTS.some((a) => a.id === id)))]
        : [];
    gameState.bossesDefeated = {};
    if (data.bossesDefeated && typeof data.bossesDefeated === 'object') {
        for (const def of BOSSES) {
            if (data.bossesDefeated[def.id]) gameState.bossesDefeated[def.id] = true;
        }
    }
    gameState.bossFight = restoreBossFight(data.bossFight, data);
    // Рекорды скорости убийства (мета для будущих достижений): ключи только из
    // каталога; мусор/чужие ключи отбрасываются.
    gameState.bestBossTimes = {};
    if (data.bestBossTimes && typeof data.bestBossTimes === 'object') {
        for (const def of BOSSES) {
            const v = intInRange(data.bestBossTimes[def.id], BOSS_RECORD_MIN_SEC, BOSS_RECORD_MAX_SEC);
            if (v !== null) gameState.bestBossTimes[def.id] = v;
        }
    }
    gameState.crafting = restoreCrafting(data.crafting);
}

// Бафы предметов. «Не resurrect»: истёкший баф сбрасывает и множитель
// (активный — только при живом until).
function applyItemBuffs(data, now) {
    gameState.miningBuffUntil = futureTimestamp(data.miningBuffUntil, now);
    gameState.miningBuffMult = activeMultiplier(gameState.miningBuffUntil, data.miningBuffMult, BUFF_MULT_SAVE_CAP);
    gameState.bossBuffUntil = futureTimestamp(data.bossBuffUntil, now);
    gameState.bossBuffMult = activeMultiplier(gameState.bossBuffUntil, data.bossBuffMult, BUFF_MULT_SAVE_CAP);
    gameState.itemVeinUntil = futureTimestamp(data.itemVeinUntil, now);
    // Боевые бафы (робо-рама / точильный камень) — тот же паттерн
    gameState.rigBuffUntil = futureTimestamp(data.rigBuffUntil, now);
    gameState.rigBuffMult = activeMultiplier(gameState.rigBuffUntil, data.rigBuffMult, RIG_MULT_SAVE_CAP);
    gameState.oilBuffUntil = futureTimestamp(data.oilBuffUntil, now);
    gameState.oilBuffAdd = activeAddition(gameState.oilBuffUntil, data.oilBuffAdd, OIL_ADD_SAVE_CAP);
}

function applyLevels(data) {
    gameState.levels = { ...createInitialState().levels };
    if (data.levels && typeof data.levels === 'object') {
        for (const def of UPGRADES) {
            const n = nonNegative(data.levels[def.id]);
            // верхний кламп до капа: сейв с levels.pickaxe=99999 иначе проходит как есть
            gameState.levels[def.id] = def.maxLevel === null ? n : Math.min(n, def.maxLevel);
        }
    }
}

export function applySave(data) {
    if (!data || typeof data !== 'object') return;

    if (data.version === 1) {
        applyLegacyV1(data);
        return;
    }

    data = migrateSaveData(data);
    if (data.version !== SAVE_VERSION) return;

    const now = Date.now();
    applyProgress(data);
    applyPreferences(data);
    applyDaily(data, now);
    applyMeta(data);
    applyItemBuffs(data, now);
    applyLevels(data);
    gameState.version = SAVE_VERSION;
}

export async function loadGame() {
    const data = await YandexSDKStub.player.getData();
    if (data) {
        try {
            applySave(data);
        } catch (err) {
            console.warn('Повреждённое сохранение, старт с нуля:', err);
        }
    }
}

export function resetGame() {
    // Настройки звука/музыки — выбор игрока, сброс прогресса их не трогает
    const prefs = {
        soundOn: gameState.soundOn,
        musicOn: gameState.musicOn,
        musicVolume: gameState.musicVolume
    };
    Object.assign(gameState, createInitialState());
    Object.assign(gameState, prefs);
    saveGame();
}
