// Каталог улучшений. tier — минимальный уровень шахты для покупки (гейт глубины).
// Глубокие машины и множители открываются по мере спуска: каждый тир даёт
// следующую ступень машинной цепочки, внутри-тировой разгон дохода ограничен
// (~десятки раз), поэтому цена спуска может быть чистым снапшотом — без догона
// и без заморозки. Лист-модуль.

export const UPGRADE_TABS = Object.freeze({
    EQUIPMENT: 'equipment',
    ENHANCE: 'enhance'
});

export const UPGRADES = [
    // --- ОБОРУДОВАНИЕ (Оборудование): урон клика ---
    // Капы на кликовой цепочке: ко-петля «кирка (+1 flat) ↔ множители» без капов
    // даёт бесконечный ROI на любом тире (накопленная кирка умножается всей
    // цепочкой) и взрывает внутр-тировой разгон. Конечный потолок клика ->
    // поздняя игра опирается на машины. Гейты tier размазаны по лестнице:
    // каждый спуск открывает ступень машин и/или звено цепочки — сопоставимый
    // прирост инструмента на каждом тире (без «тонких» тиров-стен).
    {
        id: 'pickaxe',
        name: 'Кирка',
        icon: null,
        tab: 'equipment',
        baseCost: 15,
        growth: 2.0,
        maxLevel: 30,
        effect: '+1 руда за клик'
    },
    {
        id: 'sledge',
        name: 'Кувалда',
        icon: 'icon_hammer',
        tab: 'equipment',
        baseCost: 500,
        growth: 2.5,
        maxLevel: 10,
        effect: 'урон клика x1.5'
    },
    {
        id: 'hydraulic',
        name: 'Гидропресс',
        icon: 'icon_hydraulic',
        tab: 'equipment',
        baseCost: 8000,
        growth: 3.5,
        maxLevel: 8,
        tier: 2,
        requires: { id: 'sledge', level: 5 },
        effect: 'урон клика x1.6'
    },
    {
        id: 'plasma',
        name: 'Плазменный резак',
        icon: 'icon_plasma',
        tab: 'equipment',
        baseCost: 120000,
        growth: 4.5,
        maxLevel: 6,
        tier: 6,
        requires: { id: 'hydraulic', level: 5 },
        effect: 'урон клика x1.7'
    },
    {
        id: 'disintegrator',
        name: 'Расщепитель',
        icon: 'icon_disintegrator',
        tab: 'equipment',
        baseCost: 1.5e6,
        growth: 5.5,
        maxLevel: 5,
        tier: 8,
        requires: { id: 'plasma', level: 5 },
        effect: 'урон клика x1.8'
    },

    // --- ОБОРУДОВАНИЕ (Оборудование): пассивная добыча ---
    {
        id: 'miner',
        name: 'Шахтёр',
        icon: 'miner_portrait',
        tab: 'equipment',
        baseCost: 60,
        growth: 2.0,
        maxLevel: null,
        effect: '+1 руда/сек'
    },
    {
        id: 'robotarm',
        name: 'Робо-рука',
        icon: 'icon_robot_arm',
        tab: 'equipment',
        baseCost: 5000,
        growth: 1.8,
        maxLevel: null,
        effect: 'Авто-клик: 0.5/сек'
    },
    {
        id: 'drill',
        name: 'Бур',
        icon: 'icon_drill',
        tab: 'equipment',
        baseCost: 600,
        growth: 1.6,
        maxLevel: null,
        tier: 1,
        requires: { id: 'miner', level: 5 },
        effect: '+10 руды/сек'
    },
    {
        id: 'excavator',
        name: 'Экскаватор',
        icon: 'icon_excavator',
        tab: 'equipment',
        baseCost: 6000,
        growth: 1.7,
        maxLevel: null,
        tier: 2,
        requires: { id: 'drill', level: 5 },
        effect: '+100 руды/сек'
    },
    {
        id: 'factory',
        name: 'Фабрика',
        icon: 'icon_factory',
        tab: 'equipment',
        baseCost: 60000,
        growth: 1.8,
        maxLevel: null,
        tier: 3,
        requires: { id: 'excavator', level: 5 },
        effect: '+1000 руды/сек'
    },
    {
        id: 'quarry',
        name: 'Карьер',
        icon: 'icon_quarry',
        tab: 'equipment',
        baseCost: 6e5,
        growth: 1.85,
        maxLevel: null,
        tier: 4,
        requires: { id: 'factory', level: 5 },
        effect: '+10K руды/сек'
    },
    {
        id: 'megafactory',
        name: 'Мега-фабрика',
        icon: 'icon_megafactory',
        tab: 'equipment',
        baseCost: 6e6,
        growth: 1.9,
        maxLevel: null,
        tier: 5,
        requires: { id: 'quarry', level: 5 },
        effect: '+100K руды/сек'
    },
    {
        id: 'orbital',
        name: 'Орбитальная станция',
        icon: 'icon_orbital',
        tab: 'equipment',
        baseCost: 6e7,
        growth: 1.95,
        maxLevel: null,
        tier: 6,
        requires: { id: 'megafactory', level: 5 },
        effect: '+1M руды/сек'
    },
    {
        id: 'quantumlab',
        name: 'Квантовая лаборатория',
        icon: 'icon_quantumlab',
        tab: 'equipment',
        baseCost: 6e8,
        growth: 2.0,
        maxLevel: null,
        tier: 7,
        requires: { id: 'orbital', level: 5 },
        effect: '+10M руды/сек'
    },
    {
        id: 'wormhole',
        name: 'Червоточина',
        icon: 'icon_wormhole',
        tab: 'equipment',
        baseCost: 6e9,
        growth: 2.1,
        maxLevel: null,
        tier: 8,
        requires: { id: 'quantumlab', level: 5 },
        effect: '+100M руды/сек'
    },
    {
        id: 'singularity',
        name: 'Гравитационный резак',
        icon: 'icon_singularity',
        tab: 'equipment',
        baseCost: 6e10,
        growth: 2.2,
        maxLevel: null,
        tier: 9,
        requires: { id: 'wormhole', level: 5 },
        effect: '+1B руды/сек'
    },
    {
        id: 'dyson',
        name: 'Сфера Дайсона',
        icon: 'icon_dyson',
        tab: 'equipment',
        baseCost: 6e11,
        growth: 2.3,
        maxLevel: null,
        tier: 10,
        requires: { id: 'singularity', level: 5 },
        effect: '+10B руды/сек'
    },
    {
        id: 'tech',
        name: 'Техника',
        icon: 'gear_icon',
        tab: 'equipment',
        baseCost: 8000,
        growth: 5,
        maxLevel: null,
        effect: 'пассив x1.25'
    },
    {
        id: 'aicore',
        name: 'ИИ-ядро',
        icon: 'icon_aicore',
        tab: 'equipment',
        baseCost: 5e5,
        growth: 7,
        maxLevel: null,
        tier: 5,
        requires: { id: 'tech', level: 5 },
        effect: 'пассив x1.3'
    },
    // «Каска» — НЕ доход, а живучесть: +2000 HP в босс-бое за уровень (x3^тир).
    // Гейт боссов: без каски босс вырубает шахтёра за ~25 с — копи руду и
    // прокачивай защиту, чтобы дожить до победы.
    {
        id: 'helmet',
        name: 'Каска',
        icon: 'icon_helmet',
        tab: 'equipment',
        baseCost: 800,
        growth: 2.2,
        maxLevel: 25,
        effect: '+2000 HP в бою'
    },

    // --- УСИЛЕНИЯ (Усиления) ---
    {
        id: 'dynamite',
        name: 'Динамит',
        icon: 'dynamite_bundle',
        tab: 'enhance',
        baseCost: 100,
        growth: 2.2,
        maxLevel: 23,
        effect: '+3% крит x5 (до 74%)'
    },
    {
        id: 'lucky',
        name: 'Золотая жила',
        icon: 'icon_vein',
        tab: 'enhance',
        baseCost: 1500,
        growth: 3,
        maxLevel: 25,
        effect: '+2% шанс x10 (до 50%)'
    },
    {
        id: 'resonance',
        name: 'Синергия',
        icon: 'hand_cursor',
        tab: 'enhance',
        baseCost: 2500,
        growth: 2,
        maxLevel: 25,
        effect: 'клик +1% от пассива'
    },
    {
        id: 'focuslens',
        name: 'Фокус-линза',
        icon: 'icon_focuslens',
        tab: 'enhance',
        baseCost: 50000,
        growth: 4,
        maxLevel: 10,
        tier: 3,
        requires: { id: 'dynamite', level: 15 },
        effect: '+0.5 к силе крита'
    },
    {
        id: 'magnet',
        name: 'Рудный магнит',
        icon: 'icon_magnet',
        tab: 'enhance',
        baseCost: 150000,
        growth: 4,
        maxLevel: 5,
        tier: 4,
        requires: { id: 'lucky', level: 15 },
        effect: '+1 к множителю жилы'
    },
    {
        id: 'lantern',
        name: 'Фонарь',
        icon: 'icon_lantern',
        tab: 'enhance',
        baseCost: 300,
        growth: 2.5,
        maxLevel: 10,
        effect: '+8% фонового дохода'
    },
    {
        id: 'warehouse',
        name: 'Склад',
        icon: 'icon_warehouse',
        tab: 'enhance',
        baseCost: 1000,
        growth: 10,
        maxLevel: 3,
        effect: 'запас: до 24 ч'
    }
];
