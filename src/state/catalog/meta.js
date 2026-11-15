// Каталоги боссов, компонентов, артефактов, предметов и рецептов крафта,
// мутации блока. Лист-модуль.

import { MINUTE_MS, SECOND_MS } from '../constants.js';

// ---------- Мутации блока ----------
// Временные события на блоке: триггер раз в MUTATION_CHECK_MS с шансом
// MUTATION_CHANCE, длительность ровно MUTATION_DURATION_MS. Единственный
// терминатор — таймер: мутация переживает разрушение блока и смену тира
// (новый блок наследует активную мутацию). Управление в GameScene.
// tints — палитра tint: 1 цвет = статичный tint, 2 цвета = пульс/мерцание, 6+ = перебор (радуга).
export const MUTATIONS = {
    rainbow:   { name: 'Радужный блок',    desc: 'доход за клик x10',               clickGainMult: 10,
                 tints: [0xff5050, 0xffa030, 0xffe840, 0x50e050, 0x40a0ff, 0xb050ff] },
    frozen:    { name: 'Замороженный блок', desc: 'x3 кликов, каждый удар — крит',   hitsPerStage: 3, forceCrit: true,
                 tints: [0xbfe8ff, 0x7fc4ff] },
    explosive: { name: 'Взрывной блок',    desc: 'x2 кликов, взрыв при разрушении', hitsPerStage: 2, breakBonusMult: 25,
                 tints: [0xffb060, 0xff5030] },
    charged:   { name: 'Заряженный блок',  desc: 'фоновая добыча x3',               passiveMult: 3,
                 tints: [0xd8a8ff, 0x9a50ff] }
};
export const MUTATION_DURATION_MS = 10000;
// Триггер: проверка раз в 5 мин, шанс 50% -> медиана первой мутации ~5 мин
// (было 30%: медиана ~12 мин при 10-секундном окне — игроки её не видели,
// фидбек 2026-11-13; механизм триггера проверен форсированным роллом — ок)
export const MUTATION_CHECK_MS = 300000;
export const MUTATION_CHANCE = 0.5;

// ---------- Боссы ----------
// Боссы — кликер-испытания (HP-объект вместо блока), награда: руда-баунти +
// компоненты + артефакт за первое убийство. hpMult — индивидуальная сила
// босса; HP растёт с тиром как x3^tier (income).
export const BOSS_HP_BASE = 25000;
export const BOSS_FIGHT_SECONDS = 60; // мёртвая константа (лимита нет), осталась от старой механики
export const BOSS_BOUNTY_SECONDS = 90; // баунти = 90 сек полного дохода на момент убийства

// Опасность босса: шахтёр имеет HP, босс бьёт каждые BOSS_ATTACK_PERIOD_MS
// с замахом BOSS_ATTACK_WINDUP_MS (телеграф удара — красный тинт и дрожь).
// Смерть = принудительный откат в шахту: босс сбрасывается, награды нет.
export const BOSS_ATTACK_PERIOD_MS = 2500;
export const BOSS_ATTACK_WINDUP_MS = 600;
// Сила удара = 0.4% от полного HP босса: базовый шахтёр (без каски) держится
// ~25 с, прокачанная каска растягивает живучесть линейно.
export const BOSS_ATTACK_HP_FRACTION = 0.004;

// Живучесть шахтёра: база 3000 + 2000 за уровень каски, всё x3^тир —
// пропорционально экономике тира, требуемый уровень каски не гуляет по тирам.
export const PLAYER_BASE_HP = 3000;
export const PLAYER_HP_PER_HELMET = 2000;

// Бонус за скорость убийства босса: баунти умножается по порогам времени
// (быстро = больше). Дроп компонентов и артефакт НЕ масштабируются — только руда.
export const BOSS_SPEED_TIERS = [
    [45, 1.5],   // ≤ 45 c — «быстрая победа»
    [90, 1.25],  // ≤ 90 c
    [180, 1.0]   // ≤ 180 c
];
export const BOSS_SPEED_SLOW = 0.75; // дольше 3 минут

// Рекорд скорости убийства: секунды 1..359999 («99:59»)
export const BOSS_RECORD_MIN_SEC = 1;
export const BOSS_RECORD_MAX_SEC = 359999;

export const BOSSES = [
    { id: 'boss_copper',   name: 'Медный страж',       tier: 1,  hpMult: 1.0, icon: 'boss_copper',   drops: { scrap: [2, 4] },                                          artifact: 'art_miner_totem' },
    { id: 'boss_silver',   name: 'Серебряный голем',   tier: 3,  hpMult: 1.3, icon: 'boss_silver',   drops: { scrap: [1, 3], crystal: [1, 2] },                          artifact: 'art_lantern_old' },
    { id: 'boss_amethyst', name: 'Аметистовый жнец',   tier: 5,  hpMult: 1.7, icon: 'boss_amethyst', drops: { crystal: [2, 3], core: [1, 1] },                           artifact: 'art_magnet_ring' },
    { id: 'boss_ruby',     name: 'Рубиновый басилиск', tier: 7,  hpMult: 2.2, icon: 'boss_ruby',     drops: { core: [1, 2], relic: [1, 1] },                             artifact: 'art_lucky_charm' },
    { id: 'boss_platinum', name: 'Платиновый титан',   tier: 9,  hpMult: 2.8, icon: 'boss_platinum', drops: { relic: [1, 2], essence: [1, 1] },                          artifact: 'art_glove' },
    { id: 'boss_diamond',  name: 'Алмазный владыка',   tier: 11, hpMult: 3.5, icon: 'boss_diamond',  drops: { essence: [1, 2], relic: [0, 1], core: [1, 1] },            artifact: 'art_deep_compass' }
];

export const COMPONENTS = [
    { id: 'scrap',   name: 'Ржавый лом',          icon: 'comp_scrap' },
    { id: 'crystal', name: 'Кристальный осколок', icon: 'comp_crystal' },
    { id: 'core',    name: 'Энергоядро',          icon: 'comp_core' },
    { id: 'relic',   name: 'Древняя реликвия',    icon: 'comp_relic' },
    { id: 'essence', name: 'Эссенция глубин',     icon: 'comp_essence' }
];

// ---------- Артефакты ----------
// Мульт-поля (ARTIFACT_MULT_FIELDS) перемножаются, плоские (critAdd/autoCpsAdd/
// offlineAdd/dropBonus) суммируются. Артефактные passiveMult/clickMult входят в
// якорь опосредованно — симметрично престижу (мультипликаторы в доходе),
// инвариант «цена = N сек якоря» сохраняется; balance-sim обязан подтвердить пейс.
export const ARTIFACT_MULT_FIELDS = ['passiveMult', 'clickMult', 'bossDamageMult'];

export const ARTIFACTS = [
    { id: 'art_miner_totem', name: 'Тотем шахтёра',    desc: 'пассивная добыча x1.1',       source: 'boss_copper',   bonuses: { passiveMult: 1.1 } },
    { id: 'art_lantern_old', name: 'Старый фонарь',    desc: '+5% к офлайн-доходу',         source: 'boss_silver',   bonuses: { offlineAdd: 0.05 } },
    { id: 'art_magnet_ring', name: 'Кольцо магнита',   desc: 'робо-рука +0.5 авто-клика/с', source: 'boss_amethyst', bonuses: { autoCpsAdd: 0.5 } },
    { id: 'art_lucky_charm', name: 'Талисман удачи',   desc: '+3% к шансу крита',           source: 'boss_ruby',     bonuses: { critAdd: 0.03 } },
    { id: 'art_glove',       name: 'Рукавица глубин',  desc: 'урон клика x1.1',             source: 'boss_platinum', bonuses: { clickMult: 1.1 } },
    { id: 'art_deep_compass',name: 'Компас глубин',    desc: '+15% к дропу компонентов',    source: 'boss_diamond',  bonuses: { dropBonus: 0.15 } },
    { id: 'art_hardpick',    name: 'Закалённый бур',   desc: 'урон боссам x1.25',           source: 'r_hardpick',    bonuses: { bossDamageMult: 1.25 } },
    { id: 'art_core_battery',name: 'Ядро-аккумулятор', desc: 'пассивная добыча x1.15',      source: 'r_battery',     bonuses: { passiveMult: 1.15 } },
    { id: 'art_ancient_pick',name: 'Древняя кирка',    desc: 'урон клика x1.15, урон боссам x1.1', source: 'r_ancient', bonuses: { clickMult: 1.15, bossDamageMult: 1.1 } }
];

// ---------- Предметы ----------
// Активируемые предметы: расходники с временными бафами (остаток дольше
// ITEM_RESLOT_MS блокирует повторную активацию того же слота). bossUse — только в бою.
export const ITEM_RESLOT_MS = 30 * SECOND_MS;

export const ITEMS = [
    { id: 'item_bomb',   name: 'Шахтёрская бомба',  desc: 'урон боссу x2 на 30 сек',    cost: { scrap: 4 },                effect: { bossMult: 2, durMs: 30 * SECOND_MS },    stackMax: 5,  bossUse: true, priceSeconds: 60 },
    { id: 'item_belt',   name: 'Динамитный пояс',   desc: 'добыча x3 на 3 минуты',      cost: { scrap: 6, crystal: 1 },    effect: { miningMult: 3, durMs: 3 * MINUTE_MS }, stackMax: 5, priceSeconds: 90 },
    { id: 'item_coffee', name: 'Кофе шахтёра',      desc: 'добыча x2 на 5 минут',       cost: { crystal: 2 },              effect: { miningMult: 2, durMs: 5 * MINUTE_MS }, stackMax: 8, priceSeconds: 45 },
    { id: 'item_ration', name: 'Сухпаёк',           desc: 'мгновенно 60 сек дохода',    cost: { scrap: 3 },                effect: { instantSec: 60 },              stackMax: 10, priceSeconds: 30 },
    { id: 'item_stim',   name: 'Стимулятор жилы',   desc: 'каждый удар — жила на 2 мин',cost: { core: 1, crystal: 2 },     effect: { veinForce: true, durMs: 2 * MINUTE_MS }, stackMax: 3, priceSeconds: 120 },
    // Боевые предметы №2-3: робо-рама усиливает АВТО-бой (робо-рука), точильный
    // камень — крит-шанс в бою. Эффекты применяются только пока идёт бой.
    { id: 'item_rig',    name: 'Робо-рама',         desc: 'урон робо-руки x3 на 30 сек',cost: { scrap: 4, crystal: 2 },    effect: { autoMult: 3, durMs: 30 * SECOND_MS },   stackMax: 5,  bossUse: true, priceSeconds: 75 },
    { id: 'item_oil',    name: 'Точильный камень',  desc: 'крит-шанс +25% на 60 сек',   cost: { essence: 2, scrap: 2 },    effect: { critAdd: 0.25, durMs: 60 * SECOND_MS },  stackMax: 5,  bossUse: true, priceSeconds: 50 }
];

// ---------- Крафт ----------
// result n — сколько единиц за крафт; craftMs=0 — мгновенный (расходник).
export const CRAFT_RECIPES = [
    { id: 'r_bomb',     result: { kind: 'item',     id: 'item_bomb',        n: 2 }, cost: { scrap: 4 },               craftMs: 0 },
    { id: 'r_belt',     result: { kind: 'item',     id: 'item_belt',        n: 1 }, cost: { scrap: 6, crystal: 1 },   craftMs: 0 },
    { id: 'r_coffee',   result: { kind: 'item',     id: 'item_coffee',      n: 1 }, cost: { crystal: 2 },             craftMs: 0 },
    { id: 'r_ration',   result: { kind: 'item',     id: 'item_ration',      n: 2 }, cost: { scrap: 3 },               craftMs: 0 },
    { id: 'r_stim',     result: { kind: 'item',     id: 'item_stim',        n: 1 }, cost: { core: 1, crystal: 2 },    craftMs: 0 },
    { id: 'r_rig',      result: { kind: 'item',     id: 'item_rig',         n: 1 }, cost: { scrap: 4, crystal: 2 },   craftMs: 0 },
    { id: 'r_oil',      result: { kind: 'item',     id: 'item_oil',         n: 1 }, cost: { essence: 2, scrap: 2 },   craftMs: 0 },
    { id: 'r_hardpick', result: { kind: 'artifact', id: 'art_hardpick',     n: 1 }, cost: { crystal: 3, core: 1 },    craftMs: 10 * MINUTE_MS },
    { id: 'r_battery',  result: { kind: 'artifact', id: 'art_core_battery', n: 1 }, cost: { core: 2, essence: 1 },    craftMs: 20 * MINUTE_MS },
    { id: 'r_ancient',  result: { kind: 'artifact', id: 'art_ancient_pick', n: 1 }, cost: { relic: 2, essence: 2 },   craftMs: 30 * MINUTE_MS }
];
