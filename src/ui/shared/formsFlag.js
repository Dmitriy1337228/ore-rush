// Флаг-откат форм на Phaser-путь (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, D5).
// По умолчанию обе формы (settings, status) — на DOM. Список DEFAULT_PHASER_FORMS
// пополняется автоматически при провале R-критерия формы (раздел 10.4).
// Включить откат вручную: ?phaserForms=settings,status или localStorage.phaserForms.
const NAMES = new Set(['settings', 'status']);

export const DEFAULT_PHASER_FORMS = [];

function parseList(raw) {
    return String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => NAMES.has(s));
}

/** Набор форм, откатанных на Phaser-путь (query + localStorage + автооткат). */
export function phaserForms() {
    const set = new Set(DEFAULT_PHASER_FORMS);
    if (typeof window === 'undefined') {
        return set;
    }

    try {
        const q = new URLSearchParams(window.location.search).get('phaserForms');
        for (const id of parseList(q)) {
            set.add(id);
        }

        for (const id of parseList(window.localStorage.getItem('phaserForms'))) {
            set.add(id);
        }
    } catch (e) {
        // приватный режим/битое хранилище — остаёмся на дефолтах
    }

    return set;
}

export function isPhaserForm(id) {
    return phaserForms().has(id);
}
