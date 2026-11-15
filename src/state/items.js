// Активируемые предметы: использование (временные бафы), покупка за руду.

import { gameState } from './gameState.js';
import { ITEM_RESLOT_MS } from './catalog/meta.js';
import { getItemDef } from './catalog/lookup.js';
import { getEarningRate } from './income.js';
import { addOre, saveGame } from './ore.js';

// Слоты бафов: поле эффекта предмета -> поля состояния (until — окончание
// wall-clock, value — хранимое значение множителя/прибавки; null = у слота нет значения).
const BUFF_SLOTS = [
    { effect: 'miningMult', until: 'miningBuffUntil', value: 'miningBuffMult' },
    { effect: 'bossMult',    until: 'bossBuffUntil',   value: 'bossBuffMult' },
    { effect: 'veinForce',   until: 'itemVeinUntil',   value: null },
    { effect: 'autoMult',    until: 'rigBuffUntil',    value: 'rigBuffMult' },
    { effect: 'critAdd',     until: 'oilBuffUntil',    value: 'oilBuffAdd' }
];

// Активация предмета. Отказ: нет предмета; bossUse-предмет вне боя; тот же слот
// бафа активен с остатком больше ITEM_RESLOT_MS (меньше — догорание и перезарядка сверху).
export function useItem(id, inBoss = false) {
    const def = getItemDef(id);
    if (!def || (gameState.items[id] || 0) <= 0) return false;
    if (def.bossUse && !inBoss) return false;
    const eff = def.effect;
    const now = Date.now();
    const slots = BUFF_SLOTS.filter((slot) => eff[slot.effect]);
    if (slots.some((slot) => gameState[slot.until] - now > ITEM_RESLOT_MS)) return false;
    for (const slot of slots) {
        if (slot.value) gameState[slot.value] = eff[slot.effect];
        gameState[slot.until] = now + eff.durMs;
    }
    if (eff.instantSec) {
        addOre(eff.instantSec * getEarningRate());
    }
    gameState.items[id] -= 1;
    saveGame();
    return true;
}

// Покупка предмета за руду: цена — снапшот полного дохода на момент покупки
// (ceil(getEarningRate() * priceSeconds)), по прецеденту баунти босса —
// снаряжение остаётся значимым на всех тирах.
export function getItemPrice(id) {
    const def = getItemDef(id);
    if (!def) return 0;
    return Math.ceil(getEarningRate() * def.priceSeconds);
}

export function canBuyItem(id) {
    const def = getItemDef(id);
    if (!def) return false;
    return gameState.ore >= getItemPrice(id) && (gameState.items[id] || 0) < def.stackMax;
}

export function buyItem(id) {
    if (!canBuyItem(id)) return false;
    gameState.ore -= getItemPrice(id);
    gameState.items[id] = (gameState.items[id] || 0) + 1;
    saveGame();
    return true;
}
