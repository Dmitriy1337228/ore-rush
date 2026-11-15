// Офлайн-доход и время выхода игрока.

import { SECOND_MS, SECONDS_PER_HOUR, LAST_EXIT_KEY, LEGACY_LAST_EXIT_KEY } from './constants.js';
import { YandexSDKStub } from '../sdk-stub.js';
import { getUpgradeLevel } from './upgrades.js';
import { getOrePerSecond } from './income.js';
import { getArtifactBonus } from './buffs.js';

export const OFFLINE_CAP_HOURS = [4, 8, 12, 24];
export const OFFLINE_BASE_RATE = 0.2;
export const OFFLINE_RATE_PER_LANTERN = 0.08;
export const OFFLINE_MIN_SECONDS = 300; // меньше 5 минут — не показываем окно

export function getOfflineRate() {
    return OFFLINE_BASE_RATE + OFFLINE_RATE_PER_LANTERN * getUpgradeLevel('lantern') + getArtifactBonus('offlineAdd');
}

export function getOfflineCapSeconds() {
    return OFFLINE_CAP_HOURS[Math.min(getUpgradeLevel('warehouse'), OFFLINE_CAP_HOURS.length - 1)] * SECONDS_PER_HOUR;
}

// Возвращает {seconds, reward} или null (мало времени / нет пассивного дохода)
export function computeOfflineReward(lastExitMs, nowMs = Date.now()) {
    const diffSec = (nowMs - lastExitMs) / SECOND_MS;
    if (!isFinite(diffSec) || diffSec < OFFLINE_MIN_SECONDS) return null;
    const gps = getOrePerSecond();
    if (gps <= 0) return null;
    const counted = Math.min(diffSec, getOfflineCapSeconds());
    const reward = counted * gps * getOfflineRate();
    if (reward <= 0) return null;
    return { seconds: diffSec, counted, reward };
}

export function saveLastExit(nowMs = Date.now()) {
    try {
        localStorage.setItem(LAST_EXIT_KEY, String(nowMs));
    } catch (err) { /* приватный режим и т.п. */ }
    YandexSDKStub.player.setStats({ lastExit: nowMs });
}

// Читает метку времени выхода из localStorage; мусор/отрицательное → null
// (как в getStats-пути: не должно превращаться в кап-начисление).
function readStoredExit(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) return n;
        }
    } catch (err) { /* ignore */ }
    return null;
}

export async function readLastExit() {
    // try вокруг getStats обязателен: на этапе 2 реальный SDK отклоняет промис
    // при сетевой ошибке / неавторизованном игроке — без отката к фолбэку
    // обрывался бы loadSaveThenStart (чёрный экран) или терялось начисление
    try {
        const stats = await YandexSDKStub.player.getStats(['lastExit']);
        if (typeof stats?.lastExit === 'number' && stats.lastExit > 0) return stats.lastExit;
    } catch (err) { /* идём к фолбэку */ }
    return readStoredExit(LAST_EXIT_KEY) ?? readStoredExit(LEGACY_LAST_EXIT_KEY);
}
