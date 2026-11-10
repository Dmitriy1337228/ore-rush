// Заглушка Yandex SDK по образцу player.setStats / player.getStats.
// Работает через localStorage. При реальной интеграции (этап 2) содержимое
// заменяется на ysdk.player.setStats / ysdk.player.getStats без изменения игровой логики.

const MOCK_STATS_KEY = 'mockStats';

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
            const data = readAll();
            Object.assign(data, stats || {});
            localStorage.setItem(MOCK_STATS_KEY, JSON.stringify(data));
            return true;
        },
        getStats: async (keys) => {
            const data = readAll();
            if (!keys) return data;
            return Object.fromEntries(keys.map((k) => [k, data[k]]));
        }
    }
};
