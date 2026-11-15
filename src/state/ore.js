// Руда и сохранение: примитивы, от которых зависят остальные модули состояния.

import { gameState } from './gameState.js';
import { YandexSDKStub } from '../sdk-stub.js';

export function addOre(amount) {
    gameState.ore += amount;
    gameState.tierEarned[gameState.tier] += amount;
    gameState.lifetimeMined += amount;
}

export function saveGame() {
    // Основной слот сейва — через стаб: на этапе 2 заменяется содержимое
    // sdk-stub.js (player.setData реального SDK), игровой код не меняется.
    // Стаб пишет синхронно в localStorage под прежним ключом/форматом.
    YandexSDKStub.player.setData(JSON.stringify(gameState));
}
