// Поиск записей каталогов по id. Единое место вместо разбросанных .find().

import { UPGRADES } from './upgrades.js';
import { BOSSES, ITEMS, CRAFT_RECIPES } from './meta.js';

export const getUpgradeDef = (id) => UPGRADES.find((u) => u.id === id);
export const getBossDef = (id) => BOSSES.find((b) => b.id === id);
export const getItemDef = (id) => ITEMS.find((i) => i.id === id);
export const getRecipeDef = (id) => CRAFT_RECIPES.find((r) => r.id === id);
