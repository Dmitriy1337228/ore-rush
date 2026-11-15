// Боссы: HP и урон, живучесть шахтёра, удар по боссу, персист боя, награда.

import { gameState } from './gameState.js';
import { TIER_INCOME_MULT } from './catalog/tiers.js';
import {
    BOSSES, BOSS_HP_BASE, BOSS_BOUNTY_SECONDS, BOSS_ATTACK_HP_FRACTION, BOSS_SPEED_TIERS, BOSS_SPEED_SLOW,
    BOSS_RECORD_MIN_SEC, BOSS_RECORD_MAX_SEC, PLAYER_BASE_HP, PLAYER_HP_PER_HELMET
} from './catalog/meta.js';
import { getBossDef } from './catalog/lookup.js';
import { SECOND_MS } from './constants.js';
import { getEarningRate } from './income.js';
import { getArtifactBonus, getOilBuffAdd, getBossDamageMult } from './buffs.js';
import { rollClickGain } from './click.js';
import { addOre, saveGame } from './ore.js';

export const bossHpFor = (def) => Math.ceil(BOSS_HP_BASE * TIER_INCOME_MULT(def.tier) * def.hpMult);

// Сила удара = доля полного HP босса (см. BOSS_ATTACK_HP_FRACTION).
export const bossAttackPower = (def) => Math.ceil(bossHpFor(def) * BOSS_ATTACK_HP_FRACTION);

// Живучесть шахтёра при уровне каски и тире (отдельно от gameState — нужна и при загрузке сейва).
export const computePlayerMaxHp = (helmetLevel, tier) =>
    Math.ceil((PLAYER_BASE_HP + PLAYER_HP_PER_HELMET * helmetLevel) * TIER_INCOME_MULT(tier));

export const getPlayerMaxHp = () => computePlayerMaxHp(gameState.levels.helmet || 0, gameState.tier);

// Удар по боссу = ролл клика без мутации блока (мутационные множители НЕ применяются,
// дневные крит/жила и бафы предметов внутри) x артефактный/предметный урон боссу.
// Крит-шанс в бою усилен «Точильным камнем» (oilBuffAdd).
export function rollBossHit() {
    const r = rollClickGain(null, getOilBuffAdd());
    return { gain: r.gain * getBossDamageMult(), crit: r.crit, lucky: r.lucky };
}

// Персист незавершённого боя: HP и накопленное время пишутся в состояние, чтобы
// перезагрузка страницы (F5) не была бесплатным отступлением — бой продолжается.
export function updateBossFight(hp, elapsedMs, playerHp) {
    if (!gameState.bossFight) return;
    gameState.bossFight.hp = Math.max(0, Math.ceil(hp));
    gameState.bossFight.elapsedMs = Math.max(0, Math.floor(elapsedMs));
    if (playerHp !== undefined) {
        const max = getPlayerMaxHp();
        gameState.bossFight.playerHp = Math.min(Math.max(0, Math.ceil(playerHp)), max);
    }
}

export function clearBossFight() {
    gameState.bossFight = null;
}

const toSeconds = (ms) => Math.max(1, Math.round(ms / SECOND_MS));

export function bossSpeedMult(elapsedMs) {
    const sec = toSeconds(elapsedMs);
    for (const [limit, mult] of BOSS_SPEED_TIERS) {
        if (sec <= limit) return mult;
    }
    return BOSS_SPEED_SLOW;
}

// Рекорд скорости: пишется только улучшение (меньше секунды). Возвращает true,
// если рекорд обновлён. Хранится в мете — база будущих достижений.
export function updateBossRecord(bossId, elapsedSec) {
    if (!BOSSES.some((b) => b.id === bossId)) return false;
    const sec = Math.min(Math.max(BOSS_RECORD_MIN_SEC, Math.floor(elapsedSec)), BOSS_RECORD_MAX_SEC);
    const cur = gameState.bestBossTimes[bossId];
    if (cur === undefined || sec < cur) {
        gameState.bestBossTimes[bossId] = sec;
        return true;
    }
    return false;
}

export function getBossRecord(bossId) {
    const v = gameState.bestBossTimes[bossId];
    return typeof v === 'number' && v > 0 ? v : null;
}

// Бросок дропа одного компонента: [min, max] x(1 + dropBonus артефакта), округление вниз.
function rollDrop([min, max]) {
    return Math.floor((min + Math.floor(Math.random() * (max - min + 1))) * (1 + getArtifactBonus('dropBonus')));
}

// Награда за убийство босса: баунти (90 сек полного дохода на момент убийства
// x бонус за скорость), дроп компонентов (ролл таблицы x(1+dropBonus) артефакта)
// и артефакт за первый раз. Рекорд времени пишется всегда.
export function grantBossKill(bossId, elapsedMs = 0) {
    const def = getBossDef(bossId);
    if (!def) return null;
    const elapsedSec = toSeconds(elapsedMs);
    const speedMult = bossSpeedMult(elapsedMs);
    const bounty = Math.ceil(BOSS_BOUNTY_SECONDS * getEarningRate() * speedMult);
    addOre(bounty);
    const comps = {};
    for (const compId of Object.keys(def.drops)) {
        const n = rollDrop(def.drops[compId]);
        if (n > 0) {
            comps[compId] = n;
            gameState.components[compId] = (gameState.components[compId] || 0) + n;
        }
    }
    gameState.bossesDefeated[bossId] = true;
    updateBossRecord(bossId, elapsedSec);
    let artifactId = null;
    if (def.artifact && !gameState.artifacts.includes(def.artifact)) {
        gameState.artifacts.push(def.artifact);
        artifactId = def.artifact;
    }
    saveGame();
    return { bounty, comps, artifactId, elapsedSec, speedMult };
}
