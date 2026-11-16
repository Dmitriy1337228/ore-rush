// Стек/Ряд (docs/UI_LAYOUT_TODO.md, раздел 2, пункт 3): поток объектов по оси,
// шаг = размер ячейки (фактический замер или семантический размер иконки) +
// зазор. Ячейка сама расставляет свои объекты через place(coordinate) —
// получает свой левый/верхний край, поэтому смешанные блоки (иконка + текст
// со своими смещениями) не ломают поток. Зазоры — из шкалы SPACE, где значение
// в неё попадает; нестандартные — именованные константы вызова.

// Вертикальный стек: rows сверху вниз, place(top) получает верхний край ячейки.
// Возвращает нижний край стека (без хвостового зазора).
export function stackDown(rows, { top, gap = 0 }) {
    let cursor = top;
    let bottom = top;
    for (const row of rows) {
        row.place(cursor);
        bottom = cursor + row.h;
        cursor = bottom + (row.gapAfter !== undefined ? row.gapAfter : gap);
    }

    return bottom;
}

// Горизонтальный поток: items слева направо, place(left) получает левый край
// ячейки. Возвращает правый край потока (без хвостового зазора).
export function rowRight(items, { left, gap = 0 }) {
    let cursor = left;
    let right = left;
    for (const item of items) {
        item.place(cursor);
        right = cursor + item.w;
        cursor = right + (item.gapAfter !== undefined ? item.gapAfter : gap);
    }

    return right;
}
