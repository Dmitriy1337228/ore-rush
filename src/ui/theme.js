// Общий словарь UI/сцен: цвета текста, слои (depth), события и ключи registry.
// События и ключи registry — контракт между GameScene, UIScene, DevPanel и main.js:
// строковые литералы в разных файлах расходились бы молча, константы — нет.

// ---------- Цвета текста (CSS) ----------
export const TEXT = {
    white:  '#ffffff',
    gold:   '#ffd75e', // акценты, цены, звёзды
    cream:  '#ffe9b0', // заголовки панелей и модалок
    muted:  '#b0b0b0', // неактивные/выключенные подписи
    soft:   '#c8c8c8', // вторичный текст
    dim:    '#9a9a9a', // приглушённые подсказки
    pale:   '#d8d8d8', // основной текст в модалках
    bright: '#e8e8e8',
    good:   '#9ad29a', // положительные статусы
    income: '#8fd18f', // ставка дохода
    bad:    '#e09090', // блокировки и ошибки
    warn:   '#ff9d9d'
};

// ---------- Слои отрисовки UIScene ----------
export const DEPTH = {
    panel:         10, // фоны панели/HUD
    ui:            11, // контент HUD/панели
    uiAbove:       12,
    uiIcon:        13,
    unlockButton:  15,
    unlockText:    16,
    floatText:     30, // всплывающие подписи
    tutorialDim:   38, // обучение: затемнение
    tutorial:      39, // обучение: подсказки поверх затемнения
    screenDim:     40, // полноэкранные окна (настройки/карта/мастерская): затемнение
    screen:        41, // панель окна
    screenContent: 42, // прокручиваемое содержимое окна
    screenFloat:   45, // подписи поверх окна
    alertDim:      50, // модальные уведомления (офлайн/награда/босс): затемнение
    alert:         51  // и сама панель
};

// ---------- Текстуры UI, которые используются в нескольких местах ----------
export const TEX = {
    button: 'buy_button_normal',
    buttonHover: 'buy_button_hover',
    buttonDisabled: 'buy_button_disabled_gray',
    modalPanel: 'modal_panel_metal',
    closeButton: 'close_button_square'
};

// ---------- Размеры кадров текстур для hit-area (координаты кадра, не отображаемый размер) ----------
export const HIT = {
    button: [267, 133],
    closeSquare: [196, 191],
    rowCard: [835, 218]
};

// ---------- События game.events ----------
export const EVENTS = {
    layoutChanged: 'layout-changed',
    uiRefresh: 'ui-refresh',
    tierChanged: 'tier-changed',
    musicChanged: 'music-changed',
    bossChanged: 'boss-changed',
    bossDefeated: 'boss-defeated',
    playerDown: 'player-down',
    offlineApplied: 'offline-applied',
    dailyClaimed: 'daily-claimed'
};

// ---------- Ключи scene.registry ----------
export const REG = {
    bossActive: 'bossActive',
    blockLocked: 'blockLocked',
    dailyInfo: 'dailyInfo',
    offlineInfo: 'offlineInfo',
    passiveMult: 'passiveMult'
};
