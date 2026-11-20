// Тексты статус-модалок (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, D4/1.1): единый источник
// для DOM-модалок и Phaser-пути. Без импортов состояния — принимает готовые числа/флаги.
import { fmt, fmtDuration } from './format.js';

export const statusTitles = {
    offline: 'С возвращением!',
    daily: 'Ежедневная награда',
    'boss-reward': 'Босс повержен!',
    'player-down': 'Ты вырубился!'
};

export const statusButtons = {
    offline: 'Забрать',
    daily: 'Отлично!',
    'boss-reward': 'Забрать',
    'player-down': 'В шахту'
};

/** Тело офлайн-окна: 5 строк с интервалом, как в Phaser (пустая строка между блоками). */
export function offlineBody({ seconds, reward, tierName, ratePct, orePerSec, capHours, counted }) {
    return [
        `Пока вас не было (${fmtDuration(seconds)}),`,
        `шахтёры добыли ${fmt(reward)} ${String(tierName).toLowerCase()}`,
        '',
        `фоновая добыча: ${ratePct}% · ${fmt(orePerSec)} руды/сек`,
        `лимит склада: ${capHours} ч · учтено ${fmtDuration(counted)}`
    ].join('\n');
}

/** «Серия: N день / дня / дней» — склонение по числу. */
export function dailyStreak(streak) {
    const word = streak === 1 ? 'день' : streak < 5 ? 'дня' : 'дней';

    return `Серия: ${streak} ${word}`;
}

/** Описание дня: текст награды + конкретика (руда «Накопителя» или имя улучшения). */
export function dailyDesc(reward, info = {}) {
    let desc = reward.desc;
    if (info.extra && typeof info.extra === 'number') {
        desc += `\n+${fmt(info.extra)} руды`;
    } else if (info.extra && info.extra.name) {
        desc += `\nулучшение: ${info.extra.name}`;
    }

    return desc;
}

export const bossRewardBounty = (bounty) => `Баунти: +${fmt(bounty)} руды`;

/** Строка бонуса за скорость; null — время не передано (строка скрыта). */
export function bossRewardSpeed({ elapsedSec, speedMult } = {}) {
    if (!elapsedSec) {
        return null;
    }

    const mm = Math.floor(elapsedSec / 60);
    const ss = String(elapsedSec % 60).padStart(2, '0');
    const mult = speedMult ? `x${speedMult.toFixed(2).replace(/\.?0+$/, '')}` : 'x1';

    return `Время: ${mm}:${ss} · бонус ${mult}`;
}

/** Тело окна «Ты вырубился!»: 5 строк как в Phaser. */
export function playerDownBody({ bossName, dmg, maxPlayer }) {
    return [
        `${bossName} отбросил тебя в шахту.`,
        '',
        `Удар босса: ${fmt(dmg)} · живучесть: ${fmt(maxPlayer)}`,
        'Копи руду, прокачай «Каску» (+HP) и снаряжение,',
        'докупи бомбы — и возвращайся.'
    ].join('\n');
}
