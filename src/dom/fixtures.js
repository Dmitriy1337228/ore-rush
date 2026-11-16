// Фикстуры мастерской для урезанного пилота DOM (этап 1).
// Это СТАТИЧЕСКИЕ данные, а не бизнес-логика: state.js не подключается (этап 2),
// значения скопированы из каталогов для реалистичных текстов (S-сценарии — этап 3).
// assetUrl: в dev и prod ассеты лежат по относительному пути assets/ui/<key>.png.

export const assetUrl = (key) => `assets/ui/${key}.png`;

export const FIXTURES = {
    components: [
        { id: 'scrap', icon: 'comp_scrap', count: 100 },
        { id: 'crystal', icon: 'comp_crystal', count: 100 },
        { id: 'core', icon: 'comp_core', count: 100 },
        { id: 'relic', icon: 'comp_relic', count: 100 },
        { id: 'essence', icon: 'comp_essence', count: 100 }
    ],
    items: [
        {
            id: 'item_bomb', icon: 'item_bomb', name: 'Шахтёрская бомба',
            desc: 'урон боссу ×2 на 30 сек', stock: 2, price: '43.8К',
            error: 'только в бою', action: 'Активировать'
        },
        {
            id: 'item_belt', icon: 'item_belt', name: 'Динамитный пояс',
            desc: 'добыча ×3 на 3 минуты', stock: 2, price: '65.6К',
            error: '', action: 'Активировать'
        },
        {
            id: 'item_coffee', icon: 'item_coffee', name: 'Кофе шахтёра',
            desc: 'добыча ×2 на 5 минут', stock: 2, price: '32.9К',
            error: '', action: 'Активировать'
        },
        {
            id: 'item_ration', icon: 'item_ration', name: 'Сухпаёк',
            desc: 'мгновенно 60 сек дохода', stock: 10, price: '21.9К',
            error: 'стак полон', action: 'Активировать'
        }
    ],
    recipes: [
        {
            id: 'r_bomb', name: 'Шахтёрская бомба', icon: 'item_bomb',
            desc: 'Получишь: 2 шт.', need: [['scrap', 4]], source: 'дроп: Медный страж',
            button: 'Создать', status: ''
        },
        {
            id: 'r_belt', name: 'Динамитный пояс', icon: 'item_belt',
            desc: 'Получишь: 1 шт.', need: [['scrap', 6], ['crystal', 1]], source: 'дроп: Серебряный голем',
            button: 'Создать', status: ''
        },
        {
            id: 'r_hardpick', name: 'Закалённый бур', icon: 'art_hardpick',
            desc: 'Получишь: урон боссам ×1.25', need: [['crystal', 3], ['core', 1]],
            source: 'крафт', button: 'Крафт 10 мин', status: '', countdownSec: 192
        },
        {
            id: 'r_battery', name: 'Ядро-аккумулятор', icon: 'art_core_battery',
            desc: 'Получишь: пассивная добыча ×1.15', need: [['core', 2], ['essence', 1]],
            source: 'крафт', button: 'Крафт 20 мин', status: 'не хватает компонентов'
        },
        {
            id: 'r_ancient', name: 'Древняя кирка', icon: 'art_ancient_pick',
            desc: 'Получишь: урон клика ×1.15, боссам ×1.1', need: [['relic', 2], ['essence', 2]],
            source: 'крафт', button: 'Крафт 30 мин', status: ''
        }
    ],
    artifacts: [
        { id: 'art_miner_totem', icon: 'art_miner_totem', name: 'Тотем шахтёра', owned: true, line: 'пассивная добыча ×1.1' },
        { id: 'art_lantern_old', icon: 'art_lantern_old', name: 'Старый фонарь', owned: true, line: '+5% к офлайн-доходу' },
        { id: 'art_magnet_ring', icon: 'art_magnet_ring', name: 'Кольцо магнита', owned: false, line: 'Босс: Аметистовый жнец' },
        { id: 'art_hardpick', icon: 'art_hardpick', name: 'Закалённый бур', owned: false, line: 'Скрафти: рецепт' },
        { id: 'art_core_battery', icon: 'art_core_battery', name: 'Ядро-аккумулятор', owned: false, line: 'Скрафти: рецепт' }
    ]
};
