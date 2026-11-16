// Единственный экземпляр игрового состояния и его фабрика.

import { SAVE_VERSION, DEFAULT_MUSIC_VOLUME } from './constants.js';
import { TIERS } from './catalog/tiers.js';
import { UPGRADES } from './catalog/upgrades.js';

export function createInitialState() {
    // Уровни собираются из каталога автоматически — новые улучшения не нужно
    // отдельно добавлять в состояние.
    const levels = {};
    for (const def of UPGRADES) {
        levels[def.id] = 0;
    }

    return {
        version: SAVE_VERSION,
        ore: 0,
        tier: 0,
        stars: 0,
        clicks: 0,
        lifetimeMined: 0,
        tierEarned: TIERS.map(() => 0),
        tierAnchorRate: 0, // доход при входе в тир; 0 = зафиксируется лениво
        tutorialDone: false,
        soundOn: true, // тумблер звука в настройках (эффекты)
        musicOn: true, // тумблер фоновой музыки
        musicVolume: DEFAULT_MUSIC_VOLUME, // громкость фоновой музыки 0..1
        dailyStreak: 0, // серия дней с наградой (пропуск дня — сброс)
        lastDailyDay: 0, // номер последнего дня с полученной наградой (Date.now()/DAY_MS)
        dailyBuffUntil: 0, // дневной баф множителя добычи (wall-clock ms)
        dailyBuffMult: 1,
        dailyCritUntil: 0, // баф «Критический импульс»
        dailyVeinUntil: 0, // баф «Золотая жила»
        components: {}, // компоненты боссов/крафта: {compId: количество}
        artifacts: [], // собранные артефакты (id из ARTIFACTS) — активны всегда
        items: {}, // активируемые предметы: {itemId: количество}
        crafting: null, // верстак (1 слот): {recipeId, endsAt} либо null
        bossesDefeated: {}, // побеждённые боссы: {bossId: true}
        bossFight: null, // незавершённый босс-бой: {bossId, hp, playerHp, elapsedMs} — переживает F5
        bestBossTimes: {}, // рекорды скорости: {bossId: секунды} — мета, переживает престиж (база будущих ачивок)
        miningBuffUntil: 0, // баф добычи от предметов (wall-clock ms, как dailyBuffUntil)
        miningBuffMult: 1,
        bossBuffUntil: 0, // баф урона боссу от предметов (wall-clock ms)
        bossBuffMult: 1,
        itemVeinUntil: 0, // «Стимулятор жилы»: форс жилы (wall-clock ms)
        rigBuffUntil: 0, // «Робо-рама»: множитель АВТО-урона в бою (wall-clock ms)
        rigBuffMult: 1,
        oilBuffUntil: 0, // «Точильный камень»: плоский +крит-шанс в бою (wall-clock ms)
        oilBuffAdd: 0,
        levels
    };
}

export const gameState = createInitialState();
