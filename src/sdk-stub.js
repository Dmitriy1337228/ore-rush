// Заглушка Yandex SDK по образцу контракта ysdk.player + sdk.features.GameplayAPI:
//   player.setStats / player.getStats — метаданные (lastExit), localStorage-mock
//   player.setData / player.getData — основной слот сейва
//   player.gameplayStart / player.gameplayStop — GameplayAPI (модерация Яндекса)
// Работает через localStorage. При реальной интеграции (этап 2) содержимое
// заменяется на вызовы ysdk.player.* / sdk.features.GameplayAPI — сигнатуры и
// семантика совпадают, игровой код не меняется.

export const MOCK_STATS_KEY = 'mockStats';
export const SAVE_STORAGE_KEY = 'ore-rush-save';
// Переименование игры (2026-11-13, «Minecraft Clicker» -> «Рудная лихорадка»):
// сейвы игроков переезжают со старого ключа — читаем его как фолбэк и зеркалим
// в новый (старый оставляем как бэкап, не удаляем).
export const LEGACY_SAVE_KEY = 'minecraft-clicker-save';

function readAll() {
    try {
        return JSON.parse(localStorage.getItem(MOCK_STATS_KEY) || '{}');
    } catch (err) {
        return {};
    }
}

export const YandexSDKStub = {
    player: {
        setStats: async (stats) => {
            // try обязателен: в приватном режиме / при переполнении квоты setItem
            // бросает — необработанный rejection на каждый hidden/beforeunload
            try {
                const data = readAll();
                Object.assign(data, stats || {});
                localStorage.setItem(MOCK_STATS_KEY, JSON.stringify(data));
            } catch (err) { /* тихо */ }
            return true;
        },
        getStats: async (keys) => {
            const data = readAll();
            if (!keys) return data;
            return Object.fromEntries(keys.map((k) => [k, data[k]]));
        },
        // Основной слот сейва. Принимает JSON-строку или объект; хранит payload
        // под прежним ключом в прежнем формате (JSON-строка состояния) — живые
        // сейвы и сиды тестов совместимы. Реальный SDK: player.setData(data).
        setData: (data) => {
            try {
                const payload = typeof data === 'string' ? data : JSON.stringify(data);
                localStorage.setItem(SAVE_STORAGE_KEY, payload);
                return true;
            } catch (err) {
                return false;
            }
        },
        getData: () => {
            try {
                let raw = localStorage.getItem(SAVE_STORAGE_KEY);
                if (!raw) {
                    raw = localStorage.getItem(LEGACY_SAVE_KEY);
                    if (raw) {
                        // миграция сейва под новым ключом; старый остаётся бэкапом
                        try { localStorage.setItem(SAVE_STORAGE_KEY, raw); } catch (err) { /* читаем как есть */ }
                    }
                }
                if (!raw) return null;
                return JSON.parse(raw);
            } catch (err) {
                return null;
            }
        },
        // GameplayAPI Яндекса: start — игрок активен, stop — вкладка свёрнута.
        // Стаб — no-op; вызовы в GameScene (create / visibilitychange).
        gameplayStart() {},
        gameplayStop() {}
    }
};
