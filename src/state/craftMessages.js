// Единый источник текстов мастерской (этап 2 пилота DOM, шаг 2.2).
// Ими пользуются и Phaser-экран (src/scenes/ui/craftScreen.js), и DOM-слой
// (src/dom/*). Строки не дублируются: grep по сообщениям должен находить только
// этот модуль и тесты (DoD этапа 2).

export const MSG = {
    stackFull: 'стак полон',
    noOre: 'не хватает руды',
    noItem: 'нет предмета',
    bossOnly: 'только в бою',
    buffActive: 'баф ещё активен',
    owned: 'уже в коллекции',
    benchBusy: 'верстак занят',
    noComponents: 'не хватает компонентов',
    cancelWarning: 'крафт нельзя отменить'
};

// Ошибка покупки предмета за руду (кнопка «Купить»).
export function buyError({ stock, stackMax }) {
    return stock >= stackMax ? MSG.stackFull : MSG.noOre;
}

// Ошибка активации предмета (кнопка «Активировать») после отказа useItem.
export function activateError({ stock, bossUse }) {
    if (stock <= 0) return MSG.noItem;
    return bossUse ? MSG.bossOnly : MSG.buffActive;
}

// Строка запаса под предметом: «в запасе: N» или «в запасе: N · только в бою».
export function itemStockHint({ stock, bossUse }) {
    if (stock <= 0) return MSG.noItem;
    return bossUse ? `в запасе: ${stock} · ${MSG.bossOnly}` : `в запасе: ${stock}`;
}

// Статус рецепта под карточкой (пустая строка — статуса нет).
// mine — крафт этого рецепта уже идёт; ready — его можно забрать.
export function recipeStatus({ mine, owned, busy, space, resultN, compsOk }) {
    if (mine) return '';
    if (owned) return MSG.owned;
    if (busy) return MSG.benchBusy;
    if (space < resultN && compsOk) return MSG.stackFull;
    return '';
}
