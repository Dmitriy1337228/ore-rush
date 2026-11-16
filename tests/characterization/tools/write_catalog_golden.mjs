// Записывает golden/state_catalog.json — снапшот каталогов src/state.js
// (запускается ТОЛЬКО при намеренном изменении поведения; см. README.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        get length() {
            return store.size;
        }
    };
}

const S = await import('../../../src/state.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'golden', 'state_catalog.json');

const golden = {
    tiers: S.TIERS,
    upgrades: S.UPGRADES,
    artifacts: S.ARTIFACTS,
    items: S.ITEMS,
    craftRecipes: S.CRAFT_RECIPES,
    dailyRewards: S.DAILY_REWARDS,
    bosses: S.BOSSES,
    components: S.COMPONENTS,
    mutations: S.MUTATIONS,
    constants: {
        SAVE_VERSION: S.SAVE_VERSION,
        TIER_STEP: S.TIER_STEP,
        UNLOCK_BASE_SECONDS: S.UNLOCK_BASE_SECONDS,
        UNLOCK_SECONDS_GROWTH: S.UNLOCK_SECONDS_GROWTH,
        UNLOCK_FLOOR: S.UNLOCK_FLOOR,
        MANUAL_CPS_ASSUME: S.MANUAL_CPS_ASSUME,
        OFFLINE_CAP_HOURS: S.OFFLINE_CAP_HOURS,
        OFFLINE_BASE_RATE: S.OFFLINE_BASE_RATE,
        OFFLINE_RATE_PER_LANTERN: S.OFFLINE_RATE_PER_LANTERN,
        OFFLINE_MIN_SECONDS: S.OFFLINE_MIN_SECONDS,
        PRESTIGE_REQUIREMENT: S.PRESTIGE_REQUIREMENT,
        STAR_BONUS: S.STAR_BONUS,
        DIAMOND_INDEX: S.DIAMOND_INDEX,
        MUTATION_DURATION_MS: S.MUTATION_DURATION_MS,
        MUTATION_CHECK_MS: S.MUTATION_CHECK_MS,
        MUTATION_CHANCE: S.MUTATION_CHANCE,
        BOSS_HP_BASE: S.BOSS_HP_BASE,
        BOSS_FIGHT_SECONDS: S.BOSS_FIGHT_SECONDS,
        BOSS_BOUNTY_SECONDS: S.BOSS_BOUNTY_SECONDS,
        BOSS_ATTACK_PERIOD_MS: S.BOSS_ATTACK_PERIOD_MS,
        BOSS_ATTACK_WINDUP_MS: S.BOSS_ATTACK_WINDUP_MS,
        PLAYER_BASE_HP: S.PLAYER_BASE_HP,
        PLAYER_HP_PER_HELMET: S.PLAYER_HP_PER_HELMET,
        BOSS_SPEED_TIERS: S.BOSS_SPEED_TIERS,
        BOSS_SPEED_SLOW: S.BOSS_SPEED_SLOW,
        DAY_MS: S.DAY_MS,
        DAILY_CRIT_BONUS: S.DAILY_CRIT_BONUS,
        DAILY_INSTANT_SECONDS: S.DAILY_INSTANT_SECONDS
    },
    initialState: S.createInitialState()
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(golden, null, 2) + '\n', 'utf8');
console.log('written:', OUT, JSON.parse(fs.readFileSync(OUT, 'utf8')).upgrades.length, 'upgrades');
