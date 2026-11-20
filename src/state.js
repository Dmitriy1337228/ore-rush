// Игровое состояние — публичный фасад. Реализация разложена по модулям src/state/*:
//   catalog/*    — статические каталоги и настройки баланса (лист-модули);
//   gameState    — единственный экземпляр состояния и его фабрика;
//   upgrades     — уровни, цены, покупка, видимость;  income — формулы дохода;
//   unlock       — цена спуска и переходы по тирам;    click — ролл клика и мутации;
//   boss/items/craft/daily/prestige/offline — игровые подсистемы;
//   persistence  — загрузка сейва (+ migrations/sanitize), ore — addOre/saveGame.
// Сохранение — через YandexSDKStub.player.setData/getData (физически localStorage
// 'ore-rush-save', миграция со старого ключа — в стабе), время выхода — через
// YandexSDKStub (player.setStats/getStats, localStorage-mock) + ключ 'ore-rush-lastExit'.
// Потребители импортируют всё отсюда — контракт модуля не менялся.

export * from './state/constants.js';
export * from './state/catalog/tiers.js';
export * from './state/catalog/upgrades.js';
export * from './state/catalog/balance.js';
export * from './state/catalog/meta.js';
export * from './state/catalog/daily.js';
export * from './state/catalog/lookup.js';
export * from './state/gameState.js';
export * from './state/format.js';
export * from './state/upgrades.js';
export * from './state/buffs.js';
export * from './state/income.js';
export * from './state/click.js';
export * from './state/unlock.js';
export * from './state/upgradeRoi.js';
export * from './state/ore.js';
export * from './state/boss.js';
export * from './state/items.js';
export * from './state/craft.js';
export * from './state/daily.js';
export * from './state/prestige.js';
export * from './state/offline.js';
export * from './state/persistence.js';
export * from './state/settings.js';
export * from './state/upgradesMessages.js';
