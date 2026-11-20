// Хелперы флага-отката для проверочных скриптов (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, D5).
// Старые скрипты, написанные под Phaser-путь, открывают игру с этим параметром.
export const LEGACY_FORMS_QUERY = 'phaserForms=settings,status,upgrades';

/** URL игры с флагом отката (по умолчанию — все формы на Phaser-путь). */
export function withLegacy(url, list = 'settings,status,upgrades') {
    const u = new URL(url);
    u.searchParams.set('phaserForms', list);

    return u.toString();
}
