// Крафт: верстак с одним слотом (расходники мгновенно, артефакты с таймером).

import { gameState } from './gameState.js';
import { getItemDef, getRecipeDef } from './catalog/lookup.js';
import { saveGame } from './ore.js';

const ownedComponents = (compId) => gameState.components[compId] || 0;
const ownedItems = (itemId) => gameState.items[itemId] || 0;

// Крафт: верстак свободен, стоимость полностью оплачена и под результат item
// остаётся место в стаки (проверка ДО списания).
export function canCraft(recipeId) {
    const recipe = getRecipeDef(recipeId);
    if (!recipe || gameState.crafting !== null) {
        return false;
    }

    for (const compId of Object.keys(recipe.cost)) {
        if (ownedComponents(compId) < recipe.cost[compId]) {
            return false;
        }
    }

    if (recipe.result.kind === 'item') {
        const def = getItemDef(recipe.result.id);
        const space = def.stackMax - ownedItems(def.id);
        if (space < recipe.result.n) {
            return false;
        }
    }

    return true;
}

export function startCraft(recipeId) {
    if (!canCraft(recipeId)) {
        return false;
    }

    const recipe = getRecipeDef(recipeId);
    for (const compId of Object.keys(recipe.cost)) {
        gameState.components[compId] -= recipe.cost[compId];
    }

    gameState.crafting = { recipeId, endsAt: Date.now() + recipe.craftMs };
    saveGame();

    return true;
}

export function canClaimCraft() {
    return Boolean(gameState.crafting) && Date.now() >= gameState.crafting.endsAt;
}

export function claimCraft() {
    if (!canClaimCraft()) {
        return null;
    }

    const recipe = getRecipeDef(gameState.crafting.recipeId);
    gameState.crafting = null;
    if (recipe.result.kind === 'item') {
        gameState.items[recipe.result.id] = ownedItems(recipe.result.id) + recipe.result.n;
    } else if (recipe.result.kind === 'artifact') {
        if (!gameState.artifacts.includes(recipe.result.id)) {
            gameState.artifacts.push(recipe.result.id);
        }
    }

    saveGame();

    return recipe;
}
