// Настройки (docs/UI_DOM_PHASE2_PLAN.md, шаг 2.1): границы громкости, 0 сохраняется как 0,
// тумблеры звука/музыки пишутся в state и сохраняются сразу.
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importState } from './helpers/globals.mjs';

const S = await importState();

beforeEach(() => {
    S.resetGame();
    localStorage.clear();
});

describe('state/settings: запись настроек', () => {
    it('setSoundOn выставляет флаг и сохраняет сейв', () => {
        S.setSoundOn(false);
        assert.equal(S.gameState.soundOn, false);
        const save = JSON.parse(localStorage.getItem(S.SAVE_KEY));
        assert.equal(save.soundOn, false);
        S.setSoundOn(true);
        assert.equal(S.gameState.soundOn, true);
    });

    it('setMusicOn выставляет флаг и сохраняет сейв', () => {
        S.setMusicOn(false);
        assert.equal(S.gameState.musicOn, false);
        assert.equal(JSON.parse(localStorage.getItem(S.SAVE_KEY)).musicOn, false);
    });

    it('setMusicVolume зажимает в 0..1 и не сохраняет до commitSettings', () => {
        S.gameState.musicVolume = 0.5;
        assert.equal(S.setMusicVolume(1.7), 1);
        assert.equal(S.setMusicVolume(-2), 0);
        assert.equal(S.setMusicVolume('0.42'), 0.42);
        assert.equal(JSON.parse(localStorage.getItem(S.SAVE_KEY) || '{}').musicVolume, undefined);
        S.commitSettings();
        assert.equal(JSON.parse(localStorage.getItem(S.SAVE_KEY)).musicVolume, 0.42);
    });

    it('0 громкости сохраняется как 0, а не как дефолт', () => {
        S.setMusicVolume(0);
        S.commitSettings();
        const save = JSON.parse(localStorage.getItem(S.SAVE_KEY));
        assert.equal(save.musicVolume, 0);
        assert.equal(typeof save.musicVolume, 'number');
    });
});
