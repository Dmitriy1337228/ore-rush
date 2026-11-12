// Звуки игры: 2 кандидата на звук, выбор случайный + лёгкая вариация тона,
// чтобы повторяющиеся хиты не звучали роботизированно. Тихо выходим, если звук
// выключен (gameState.soundOn) или ключ не загружен.
// Троттлинг per-ключ: при темпе 5-10 кликов/сек не наслаиваем десятки одинаковых голосов.
import { gameState } from './state.js';

const MIN_INTERVAL_MS = 70;
const lastPlayed = new Map();

export function playSfx(scene, base, variants = 2, rate = 1) {
    if (!gameState.soundOn) return;
    if (!scene.cache?.audio?.exists(`${base}_1`)) return;
    const now = performance.now();
    const prev = lastPlayed.get(base) || 0;
    if (now - prev < MIN_INTERVAL_MS) return;
    lastPlayed.set(base, now);
    const key = `${base}_${Math.floor(Math.random() * variants) + 1}`;
    scene.sound.play(key, { rate: rate * (0.94 + Math.random() * 0.12), volume: 0.8 });
}
