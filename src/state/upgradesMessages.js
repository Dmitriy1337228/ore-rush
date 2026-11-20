// Тексты списка улучшений (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, D4/2.1): единый источник
// для DOM-панели и Phaser-пути. Без импортов состояния — принимает готовые числа.
import { fmt } from './format.js';

export const upgradesTitle = 'Улучшения';

export const TABS = Object.freeze([
    { id: 'equipment', label: 'Оборудование' },
    { id: 'enhance', label: 'Усиления' }
]);

export const BUY_AMOUNTS = Object.freeze([1, 10, 100, 'max']);

export const bulkLabel = (amount) => (amount === 'max' ? 'МАКС' : `x${amount}`);

export const levelText = (level) => `ур. ${level}`;
export const buyLabel = 'Купить';
export const maxedLabel = 'макс';
export const lockedLabel = '—';

/** Гейт по глубине: улучшение ещё не открыто на текущем уровне шахты. */
export const lockTierText = (tierIndex) => `нужно: шахта ${tierIndex + 1}`;

/** Гейт по цепочке требований: «нужно: Кувалда 5». */
export const lockRequiresText = (name, level) => `нужно: ${name} ${level}`;

/** Цена строгого пакета: полный пакет либо «xN», если пакет ужался лимитом уровня. */
export function bulkPriceText({ total, n, amount }) {
    if (!(n > 0)) {
        return fmt(total || 0);
    }

    return n < amount ? `${fmt(total)} x${n}` : fmt(total);
}

/** Цена режима МАКС: сколько купится на текущую руду (число знает только state). */
export function maxPriceText({ total, n, fallback }) {
    if (!(n > 0)) {
        return fmt(fallback);
    }

    return n > 1 ? `${fmt(total)} x${n}` : fmt(total);
}
