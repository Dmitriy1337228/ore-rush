// Общая блокировка DOM-форм (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, шаг 1.8): единая точка
// выставления флагов `_xxxOpen` и пересчёта `registry blockLocked` — чтобы каждая
// форма не копировала логику мастерской.
export function setFormOpen(scene, flag, open) {
    if (!scene || !flag) {
        return false;
    }

    scene[flag] = !!open;
    scene.updateBlockLock?.();

    return scene[flag];
}

/** Пересчёт блокировки после изменения нескольких флагов (например, очередь модалок). */
export function syncBlockLock(scene) {
    scene?.updateBlockLock?.();
}
