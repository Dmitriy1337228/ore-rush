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
