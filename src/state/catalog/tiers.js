// Каталог тиров руды и экономические множители тира. Лист-модуль.

export const TIERS = [
    // Спуск стоит руду текущего тира; после спуска добывается только новая руда.
    // Цена спуска НЕ статична: она фиксируется при входе в тир как N секунд
    // текущего дохода (см. state/unlock.js) — статические кривые при внутренней
    // прокачке либо пролетаются (цены отстают от богатства), либо становятся
    // стеной (цены убегают).
    { key: 'coal',     name: 'Уголь',     gen: 'угля',       adj: 'угольным',      iconKey: 'coal_nugget',     blockPrefix: 'block',      floatColor: '#ffffff'  },
    { key: 'copper',   name: 'Медь',      gen: 'меди',       adj: 'медным',        iconKey: 'copper_nugget',   blockPrefix: 'copper',     floatColor: '#f0985e'  },
    { key: 'iron',     name: 'Железо',    gen: 'железа',     adj: 'железным',      iconKey: 'iron_nugget',     blockPrefix: 'iron',       floatColor: '#cfd8e3'  },
    { key: 'silver',   name: 'Серебро',   gen: 'серебра',    adj: 'серебряным',    iconKey: 'silver_nugget',   blockPrefix: 'silver',     floatColor: '#eeeded'  },
    { key: 'gold',     name: 'Золото',    gen: 'золота',     adj: 'золотым',       iconKey: 'gold_nugget',     blockPrefix: 'gold',       floatColor: '#ffd75e'  },
    { key: 'amethyst', name: 'Аметист',   gen: 'аметиста',   adj: 'аметистовым',   iconKey: 'amethyst_nugget', blockPrefix: 'amethyst',   floatColor: '#d9a2ff'  },
    { key: 'emerald',  name: 'Изумруд',   gen: 'изумруда',   adj: 'изумрудным',    iconKey: 'emerald_nugget',  blockPrefix: 'emerald',    floatColor: '#7ee787'  },
    { key: 'ruby',     name: 'Рубин',     gen: 'рубина',     adj: 'рубиновым',     iconKey: 'ruby_nugget',     blockPrefix: 'ruby',       floatColor: '#f0638c'  },
    { key: 'sapphire', name: 'Сапфир',    gen: 'сапфира',    adj: 'сапфировым',    iconKey: 'sapphire_nugget', blockPrefix: 'sapphire',   floatColor: '#63b4ff'  },
    { key: 'platinum', name: 'Платина',   gen: 'платины',    adj: 'платиновым',    iconKey: 'platinum_nugget', blockPrefix: 'platinum',   floatColor: '#eae6d9'  },
    { key: 'uranium',  name: 'Уранит',    gen: 'уранита',    adj: 'урановым',      iconKey: 'uranium_nugget',  blockPrefix: 'uranium',    floatColor: '#b7ff47'  },
    { key: 'diamond',  name: 'Алмаз',     gen: 'алмаза',     adj: 'алмазным',      iconKey: 'diamond_nugget',  blockPrefix: 'diamond',    floatColor: '#7ee7ff'  }
];

export const LAST_TIER_INDEX = TIERS.length - 1;

// Цены улучшений ×3 за тир (TIER_COST_MULT), доход ×3 (TIER_INCOME_MULT):
// окупаемость улучшений инвариантна тиру — покупки одинаково выгодны на всей
// лестнице; темп прогрессии задаёт рост требований спуска (UNLOCK_SECONDS_GROWTH).
export const TIER_STEP = {
    // cost = income (3.0): окупаемость улучшений инвариантна тиру. Раньше цены
    // росли медленнее дохода (2.5 vs 3) — на глубине всё становилось на 17x/тир
    // дешевле относительно дохода, и накопленный каталог взрывал внутр-тировой
    // разгон (блиц спуска даже с гейтами глубины).
    cost: 3.0,
    income: 3
};
export const TIER_COST_MULT = (tier) => Math.pow(TIER_STEP.cost, tier);
export const TIER_INCOME_MULT = (tier) => Math.pow(TIER_STEP.income, tier);

// Индекс алмазного тира (валюта престижа) — вычисляется, а не хардкодится,
// чтобы порядок руд можно было менять без правки логики.
export const DIAMOND_INDEX = TIERS.findIndex((t) => t.key === 'diamond');
