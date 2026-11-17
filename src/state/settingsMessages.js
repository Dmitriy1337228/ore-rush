// Тексты окна настроек (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, D4/2.2): единый источник для
// DOM-формы и Phaser-пути. Без импортов состояния — принимает готовые числа/флаги.
import { fmt } from './format.js';

export const settingsTitle = 'Настройки';

export const soundLabel = (on) => `Звук: ${on ? 'вкл' : 'выкл'}`;
export const musicLabel = (on) => `Музыка: ${on ? 'вкл' : 'выкл'}`;
export const volumeText = (v) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;

/** 5 строк статов (паритет с Phaser: без строки дневного бафа). */
export function settingsStats({ tierIndex, tierName, stars, mult, clicks, lifetime, ratePct, capHours }) {
    return [
        `Уровень шахты: ${tierIndex + 1} (${tierName})`,
        `Звёзды: ${stars} — множитель x${mult}`,
        `Кликов: ${fmt(clicks)}`,
        `Всего добыто: ${fmt(lifetime)}`,
        `Фоновая добыча: ${ratePct}% / ${capHours} ч`
    ];
}

/**
 * Инфо престижа. can=true — компактные 2 строки; can=false — «нужно добыть …» и процент.
 * portrait=true — короткая формулировка (историческая зона багов на телефонах).
 */
export function prestigeInfo({ can, gain, have, need, portrait = false }) {
    if (can) {
        return [`За текущий забег: +${gain} ★`, 'Сброс: руда, шахта и улучшения обнулятся.'];
    }

    const line = portrait
        ? `Нужно добыть ${fmt(need)} алмазов за забег.`
        : `Для rebirth нужно добыть ${fmt(need)} алмазов за забег.`;
    const pct = Math.floor((have / need) * 100);

    return [line, `У вас: ${fmt(have)} (${pct}%).`];
}

export const prestigeIdle = 'Сбросить шахту';
export const prestigeArmed = (gain) => `Точно? +${gain} ★`;
export const resetIdle = 'Сбросить весь прогресс';
export const resetArmed = 'Точно сбросить?';

export const resetSectionTitle = 'Сброс шахты (Rebirth)';
export const volumeLabel = 'Громкость:';
