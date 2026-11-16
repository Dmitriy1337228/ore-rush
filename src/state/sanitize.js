// Санитайзеры значений из сейва: любое поле приходит из недоверенного JSON,
// поэтому приводится к допустимому диапазону. Чистые функции без состояния.

// Неотрицательное число, мусор/NaN → 0
export const nonNegative = (v) => Math.max(0, Number(v) || 0);

// Неотрицательное целое, мусор/NaN → 0
export const nonNegativeInt = (v) => Math.max(0, Math.floor(Number(v) || 0));

// Конечное положительное число, иначе 0 (Infinity/NaN/отрицательное отбрасываются)
export function finitePositive(v) {
    const n = Number(v);

    return Number.isFinite(n) && n > 0 ? n : 0;
}

// Целое число >= min и <= max, иначе null
export function intInRange(v, min, max) {
    const n = Math.floor(Number(v));

    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// Метка окончания бафа: только будущая (истёкший баф не resurrect), иначе 0
export function futureTimestamp(v, now = Date.now()) {
    const n = Number(v);

    return Number.isFinite(n) && n > now ? n : 0;
}

// Множитель бафа >= 1 с потолком, иначе 1
export function multiplierOrOne(v, cap) {
    const n = Number(v);

    return Number.isFinite(n) && n >= 1 ? Math.min(n, cap) : 1;
}

// Множитель, живой только при активном баф-таймере (until != 0), иначе 1
export const activeMultiplier = (until, v, cap) => (until ? multiplierOrOne(v, cap) : 1);

// Положительная прибавка с потолком, живая только при активном таймере, иначе 0
export function activeAddition(until, v, cap) {
    const n = Number(v);

    return until && Number.isFinite(n) && n > 0 ? Math.min(n, cap) : 0;
}

// Объект-словарь из каталога: ключи только из каталога, значения приводит convert
export function pickCatalogRecord(raw, catalog, convert) {
    const out = {};
    if (raw && typeof raw === 'object') {
        for (const def of catalog) {
            out[def.id] = convert(raw[def.id], def);
        }
    }

    return out;
}
