// Минимальный tagged-template слой DOM (вариант D1: vanilla без фреймворка).
// Возвращает безопасную HTML-строку (значения экранируются, вложенный html`` — нет),
// поэтому вставка идёт одним innerHTML на панель, а точечные обновления — по ссылкам
// на элементы (диф по ключам для списков: patchKeyed ниже).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

export class SafeHtml {
    constructor(value) {
        this.value = value;
    }
    toString() {
        return this.value;
    }
}

function render(value) {
    if (value == null || value === false) return '';
    if (value instanceof SafeHtml) return value.value;
    if (Array.isArray(value)) return value.map(render).join('');
    return escapeHtml(value);
}

export function html(strings, ...values) {
    let out = '';
    for (let i = 0; i < strings.length; i++) {
        out += strings[i];
        if (i < values.length) out += render(values[i]);
    }
    return new SafeHtml(out);
}

export function setHtml(el, safe) {
    el.innerHTML = String(safe);
    return el;
}

// HTML-строка -> узел (первый элемент).
export function toNode(safe) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(safe).trim();
    return tpl.content.firstElementChild;
}

// Отрисовка списка: пересоздаём ТОЛЬКО ряды, чьи данные изменились (сигнатура),
// сохраняя порядок и остальные узлы. Для экранов без локального состояния
// (мастерская: ряд целиком зависит от снимка) это дешевле точечных сеттеров.
export function renderKeyed(container, items, { keyOf, sigOf, create }) {
    const existing = new Map(Array.from(container.children, (el) => [el.dataset.key, el]));
    const keep = new Set();
    items.forEach((item, index) => {
        const key = keyOf(item);
        keep.add(key);
        const sig = sigOf ? sigOf(item) : JSON.stringify(item);
        let el = existing.get(key);
        if (!el || el.dataset.sig !== sig) {
            const built = create(item);
            const next = built instanceof Element ? built : toNode(built);
            next.dataset.key = key;
            next.dataset.sig = sig;
            if (el) el.replaceWith(next);
            el = next;
        }
        const at = container.children[index];
        if (at !== el) container.insertBefore(el, at || null);
    });
    for (const [key, el] of existing) {
        if (!keep.has(key)) el.remove();
    }
}

// Диф списка по ключам: существующие элементы переиспользуются, новые создаются,
// лишние удаляются; порядок приводится к порядку items. Обновление элемента —
// только если сигнатура (sig) изменилась.
export function patchKeyed(container, items, { keyOf, sigOf, create, update }) {
    const existing = new Map();
    for (const el of Array.from(container.children)) existing.set(el.dataset.key, { el, sig: el.dataset.sig });
    const keep = new Set();
    let cursor = container.firstElementChild;
    for (const item of items) {
        const key = keyOf(item);
        const sig = sigOf ? sigOf(item) : '';
        keep.add(key);
        const found = existing.get(key);
        if (found) {
            if (found.sig !== sig && update) {
                update(found.el, item);
                found.el.dataset.sig = sig;
            }
            if (cursor === found.el) cursor = cursor.nextElementSibling;
            else container.insertBefore(found.el, cursor);
        } else {
            const el = create(item);
            el.dataset.key = key;
            el.dataset.sig = sig;
            container.insertBefore(el, cursor);
        }
    }
    for (const [key, rec] of existing) {
        if (!keep.has(key)) rec.el.remove();
    }
}
