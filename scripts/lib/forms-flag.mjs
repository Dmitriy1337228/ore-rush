// Хелперы флага-отката для проверочных скриптов (docs/UI_DOM_PHASE2_PLAN.md, D5).
// Старые скрипты, написанные под Phaser-путь, открывают игру с этим параметром.
export const LEGACY_FORMS_QUERY = 'phaserForms=settings,status';

/** URL игры с флагом отката (по умолчанию — обе формы на Phaser-путь). */
export function withLegacy(url, list = 'settings,status') {
    const u = new URL(url);
    u.searchParams.set('phaserForms', list);

    return u.toString();
}
