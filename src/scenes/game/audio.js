import { gameState } from '../../state.js';

export const audioMethods = {
    startBgm() {
        if (!this.cache.audio.exists('bgm')) {
            return;
        }

        this.bgm = this.sound.add('bgm', { loop: true, volume: gameState.musicVolume });
        this.bgm.setMute(!gameState.musicOn);
        // Автоплей-политика: до первого взаимодействия браузер блокирует звук —
        // Phaser снимет lock при первом клике/клавише, тогда и стартуем
        if (this.sound.locked) {
            this.sound.once('unlocked', () => this.bgm.play());
        } else {
            this.bgm.play();
        }
    },

    syncBgm() {
        if (!this.bgm) {
            return;
        }

        this.bgm.setMute(!gameState.musicOn);
        this.bgm.setVolume(gameState.musicVolume);
    },

    // Босс-тема на время боя: текущий BGM останавливается и возвращается по
    // завершении боя (killBoss/retreatBoss/shutdown). Настройки музыки поверх боя
    // (R2) работают через syncBgm с активной темой — mute/volume применяются к ней.
    startBossBgm() {
        if (!this.cache.audio.exists('boss_theme')) {
            return;
        }

        this._preBossBgm = this.bgm;
        if (this.bgm) {
            this.bgm.stop();
        }

        this.bgm = this.sound.add('boss_theme', { loop: true, volume: gameState.musicVolume });
        this.bgm.setMute(!gameState.musicOn);
        this.bgm.play();
    },

    stopBossBgm() {
        // Возврат только если свап состоялся (boss_theme мог не загрузиться —
        // тогда this.bgm остался обычным BGM и трогать его нельзя)
        if (!this.bgm || this.bgm.key !== 'boss_theme') {
            return;
        }

        this.bgm.stop();
        this.bgm.destroy();
        this.bgm = this._preBossBgm;
        this._preBossBgm = null;
        this.syncBgm();
        if (this.bgm && !this.bgm.isPlaying) {
            this.bgm.play();
        }
    }
};
