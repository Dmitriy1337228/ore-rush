// Каталог ежедневных наград (7-дневный цикл). Лист-модуль.
// Модалка при первом заходе за день; день серии выбирает награду. Пропуск дня
// (lastDailyDay < вчера) обнуляет серию. Бафы — таймеры WALL-CLOCK (ms):
// переживают перезагрузку страницы, истекают сами. Якорь цены спуска
// (getExpectedClickGain) считается БЕЗ дневного бафа — баф временный и не
// должен сдвигать лестницу цен.

import { MINUTE_MS } from '../constants.js';

export const DAILY_CRIT_BONUS = 0.25; // «Критический импульс»: +25% к шансу крита
export const DAILY_CRIT_DURATION_MS = 5 * MINUTE_MS;
export const DAILY_INSTANT_SECONDS = 300; // «Накопитель»: 5 минут полного дохода сразу

export const DAILY_REWARDS = [
    {
        id: 'boost2',
        name: 'Ускорение',
        kind: 'mult',
        mult: 2,
        durMs: 10 * MINUTE_MS,
        icon: 'pickaxe_iron',
        desc: 'x2 к скорости добычи\nна 10 минут'
    },
    {
        id: 'stash',
        name: 'Накопитель',
        kind: 'instant',
        icon: 'gold_nugget',
        desc: 'мгновенно 5 минут\nполного дохода'
    },
    {
        id: 'crit',
        name: 'Критический импульс',
        kind: 'crit',
        icon: 'dynamite_bundle',
        desc: `+${Math.round(DAILY_CRIT_BONUS * 100)}% к шансу крита\nна 5 минут`
    },
    {
        id: 'upgrade',
        name: 'Бесплатное улучшение',
        kind: 'upgrade',
        icon: 'icon_hammer',
        desc: '+1 уровень лучшему\nдоступному улучшению'
    },
    {
        id: 'boost3',
        name: 'Мощное ускорение',
        kind: 'mult',
        mult: 3,
        durMs: 10 * MINUTE_MS,
        icon: 'pickaxe_diamond',
        desc: 'x3 к скорости добычи\nна 10 минут'
    },
    {
        id: 'boost10',
        name: 'Мощный буст',
        kind: 'mult',
        mult: 10,
        durMs: 2 * MINUTE_MS,
        icon: 'icon_dyson',
        desc: 'x10 к скорости добычи\nна 2 минуты'
    },
    {
        id: 'vein',
        name: 'Золотая жила',
        kind: 'vein',
        durMs: 2 * MINUTE_MS,
        icon: 'icon_vein',
        desc: 'каждый удар — жила\nна 2 минуты'
    }
];
