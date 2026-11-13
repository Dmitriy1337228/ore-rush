// Заглушка SDK Яндекс.Игр (этап 2).
// Реальный вызов появится после раскомментирования <script src="https://yandex.ru/games/sdk/v2"> в index.html.
// Все методы безопасны в офлайне: пока SDK не подключён, они являются no-op.

export const YandexSDK = {
    available: false,
    sdk: null,
    player: null,

    async init() {
        try {
            if (typeof window === 'undefined' || !window.YaGames) {
                console.info('[YandexSDK] SDK не обнаружен — работа в standalone-режиме (localStorage).');
                return false;
            }
            this.sdk = await window.YaGames.init();
            this.player = await this.sdk.getPlayer({ scopes: false });
            this.available = true;
            console.info('[YandexSDK] Инициализация выполнена.');
            return true;
        } catch (err) {
            console.warn('[YandexSDK] Инициализация не удалась:', err);
            return false;
        }
    },

    async save(data) {
        if (!this.available || !this.player) return false;
        try {
            await this.player.setData({ oreRushSave: data });
            return true;
        } catch (err) {
            console.warn('[YandexSDK] save не удался:', err);
            return false;
        }
    },

    async load() {
        if (!this.available || !this.player) return null;
        try {
            const data = await this.player.getData(['oreRushSave']);
            return data && data.oreRushSave ? data.oreRushSave : null;
        } catch (err) {
            console.warn('[YandexSDK] load не удался:', err);
            return null;
        }
    },

    gameplayStart() {
        if (this.available && this.sdk && this.sdk.features && this.sdk.features.GameplayAPI) {
            this.sdk.features.GameplayAPI.start();
        }
    },

    gameplayStop() {
        if (this.available && this.sdk && this.sdk.features && this.sdk.features.GameplayAPI) {
            this.sdk.features.GameplayAPI.stop();
        }
    },

    // callbacks: { onClose(wasShown), onError(err), onOpen() }.
    // Реальный SDK при неудаче загрузки рекламы зовёт onError, а onClose не
    // вызывается — без проброса onError ждущий код зависнет навсегда.
    showFullscreenAdv(callbacks = {}) {
        if (!this.available || !this.sdk || !this.sdk.adv) {
            if (callbacks.onClose) callbacks.onClose(false);
            return;
        }
        this.sdk.adv.showFullscreenAdv({ callbacks: {
            onOpen: () => callbacks.onOpen && callbacks.onOpen(),
            onClose: (wasShown) => callbacks.onClose && callbacks.onClose(wasShown),
            onError: (err) => callbacks.onError && callbacks.onError(err)
        } });
    }
};
