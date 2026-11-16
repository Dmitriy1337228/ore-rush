// Форматирование чисел и длительностей для UI.

import { SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from './constants.js';

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
const SHORT_FORM_LIMIT = 10000; // до этого порога число печатается целым без суффикса
const DECIMALS_FREE_FROM = 100; // от 100 дробная часть суффиксного числа не нужна
const THOUSAND_EXPONENT = 3; // суффиксы сменяются каждые 10^3

export function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + fmt(-n);
    if (n < SHORT_FORM_LIMIT) {
        const r = Math.floor(n);
        return String(r);
    }
    const idx = Math.floor(Math.log10(n) / THOUSAND_EXPONENT);
    if (idx >= SUFFIXES.length) return n.toExponential(1).replace('e+', 'e');
    const scaled = n / Math.pow(1000, idx);
    const str = scaled >= DECIMALS_FREE_FROM ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
    return str + SUFFIXES[idx];
}

export function fmtDuration(seconds) {
    const h = Math.floor(seconds / SECONDS_PER_HOUR);
    const m = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    if (h > 0 && m > 0) return `${h} ч ${m} мин`;
    if (h > 0) return `${h} ч`;
    return `${m} мин`;
}
