// Настройки игрока: звук, музыка, громкость (docs/dom-phase2/UI_DOM_PHASE2_PLAN.md, D2/2.1).
// Единственное место записи этих полей; DOM и Phaser-путь вызывают только эти функции.
// Сохранение: тумблеры — сразу, громкость — по окончании жеста (commitSettings).
import { gameState } from './gameState.js';
import { saveGame } from './ore.js';

const clamp01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
        return 0;
    }

    return Math.min(1, Math.max(0, n));
};

export function setSoundOn(on) {
    gameState.soundOn = !!on;
    saveGame();

    return gameState.soundOn;
}

export function setMusicOn(on) {
    gameState.musicOn = !!on;
    saveGame();

    return gameState.musicOn;
}

export function setMusicVolume(v) {
    gameState.musicVolume = clamp01(v);

    return gameState.musicVolume;
}

/** Фиксация громкости после жеста (в Phaser — pointerup, в DOM — change/pointerup). */
export function commitSettings() {
    saveGame();
}
