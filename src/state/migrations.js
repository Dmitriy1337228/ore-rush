// Миграции сейвов старых версий до текущей SAVE_VERSION.

import { gameState, createInitialState } from './gameState.js';
import { SAVE_VERSION, DEFAULT_MUSIC_VOLUME } from './constants.js';
import { TIERS } from './catalog/tiers.js';
import { UPGRADES } from './catalog/upgrades.js';
import { nonNegative } from './sanitize.js';

// Порядок руд версии 2 (5 тиров) — для перевода индексов в текущую лестницу из 12.
const LEGACY_V2_TIER_KEYS = ['coal', 'iron', 'gold', 'emerald', 'diamond'];
// Улучшения, существовавшие в версии 1
const LEGACY_V1_UPGRADES = ['pickaxe', 'dynamite', 'miner'];

// Версия 1 (уголь, 3 улучшения) полностью переписывает состояние сама:
// формат слишком далёк от текущего, чтобы вести его по общей цепочке.
export function applyLegacyV1(data) {
    const init = createInitialState();
    gameState.ore = Number(data.coal) || 0;
    gameState.tier = 0;
    gameState.stars = 0;
    gameState.clicks = Number(data.clicks) || 0;
    gameState.lifetimeMined = Number(data.totalMined) || 0;
    gameState.tierEarned[0] = gameState.lifetimeMined;
    gameState.levels = { ...init.levels };
    for (const id of LEGACY_V1_UPGRADES) {
        gameState.levels[id] = nonNegative(data.levels && data.levels[id]);
    }
    // верхний кламп до капов — как в основной ветке applySave
    for (const def of UPGRADES) {
        if (def.maxLevel === null) continue;
        gameState.levels[def.id] = Math.min(gameState.levels[def.id], def.maxLevel);
    }
    gameState.version = SAVE_VERSION;
    gameState.tutorialDone = true; // старые игроки — обучение не показываем
    gameState.soundOn = true;
    gameState.musicOn = true;
    gameState.musicVolume = DEFAULT_MUSIC_VOLUME;
}

// Версия 2 (5 тиров: уголь/железо/золото/изумруд/алмаз) -> 12 тиров:
// порядок руд изменился, старый индекс тира переводится по ключу руды,
// баланс руды и уровни улучшений сохраняются; добыча по тирам переносится так же.
function migrateV2(data) {
    const oldTier = Math.min(Math.max(0, Number(data.tier) || 0), LEGACY_V2_TIER_KEYS.length - 1);
    const legacyEarned = Array.isArray(data.tierEarned) ? data.tierEarned : [];
    const mappedTier = Math.max(
        0,
        TIERS.findIndex((t) => t.key === LEGACY_V2_TIER_KEYS[oldTier])
    );
    const mappedEarned = TIERS.map(() => 0);
    LEGACY_V2_TIER_KEYS.forEach((key, i) => {
        const idx = TIERS.findIndex((t) => t.key === key);
        if (idx >= 0) mappedEarned[idx] = nonNegative(legacyEarned[i]);
    });
    return { ...data, version: SAVE_VERSION, tier: mappedTier, tierEarned: mappedEarned };
}

// Версии 3-4 отличаются от текущей только отсутствующими полями:
//  v3 -> v4: якорь дохода тира (tierAnchorRate) — фиксируется лениво от текущего дохода;
//  v4 -> v5: карта/боссы/артефакты/крафт — остаются с дефолтами createInitialState.
// Данные принимаются как есть, меняется только номер версии.
const bumpVersion = (data) => ({ ...data, version: SAVE_VERSION });

// Приводит данные версий 2..4 к текущей; остальные версии возвращает как есть.
export function migrateSaveData(data) {
    switch (data.version) {
        case 2:
            return migrateV2(data);
        case 3:
        case 4:
            return bumpVersion(data);
        default:
            return data;
    }
}
