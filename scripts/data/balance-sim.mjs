// Симулятор баланса: импортирует РЕАЛЬНУЮ экономику из src/state.js.
// Два режима в одном прогоне:
//   greedy — жадная закупка (лучший ROI), спуск когда нечего купить с окупаемостью
//            быстрее фактического времени до спуска (цена - руда) / ставка,
//            либо исчерпан лимит терпения (150 закупок на тир);
//   lazy   — без единой покупки, чистое накопление (базлайн).
// Запуск: node scripts/balance-sim.mjs [cps] [maxHours]
import {
    gameState,
    UPGRADES,
    TIERS,
    addOre,
    resetGame,
    getUpgradeCost,
    canBuy,
    buyUpgrade,
    getClickDamage,
    getExpectedClickGain,
    getOrePerSecond,
    getAutoClicksPerSecond,
    getEarningRate,
    getSynergyGain,
    getCritFactor,
    getVeinFactor,
    upgradeIncomeDelta,
    getCritMult,
    unlockTier,
    getNextUnlockPrice,
    ARTIFACTS,
    UNLOCK_BASE_SECONDS,
    UNLOCK_FLOOR,
    unlockSecondsFor,
    CRIT_BASE_CHANCE,
    CRIT_CHANCE_CAP,
    SECONDS_PER_HOUR,
    SECONDS_PER_MINUTE
} from '../../src/state.js';

const ARGS = process.argv.slice(2);
const DEFAULT_CPS_MANUAL = 3.5;
const DEFAULT_MAX_HOURS = 60;
const CPS_MANUAL = Number(ARGS[0] || DEFAULT_CPS_MANUAL);
const MAX_H = Number(ARGS[1] || DEFAULT_MAX_HOURS);
const DT = 1;
const PATIENCE = 150; // лимит закупок на тир (ко-петля «кирка ↔ множители»)
const BUY_GUARD = 60; // максимум покупок за один шаг сима
const MIN_RATE = 1e-9; // защита от деления на ноль
const ARTIFACT_EPS = 1e-9; // допуск сравнения множителей артефактов
const PAYBACK_CORRIDOR = 0.1; // коридор окупаемости: N сек якоря x(1 ± 0.1)

// Общая ставка кликов сима: ручные (аргумент CLI) + авто-клики робо-руки
function cpsTotal() {
    return CPS_MANUAL + getAutoClicksPerSecond();
}
function clickIncome() {
    return (getClickDamage() + getSynergyGain()) * getCritFactor() * getVeinFactor() * cpsTotal();
}

// прирост дохода/сек от +1 уровня улучшения id (приближение для жадной закупки);
// формула — единая с игрой (state/upgradeRoi.js), отличается только темпом ручных кликов
function deltaIncome(id) {
    return upgradeIncomeDelta(id, CPS_MANUAL);
}

function runSimulation(mode) {
    resetGame();
    let time = 0;
    let tierStart = 0;
    let buysThisTier = 0; // лимит терпения считается НА ТИР, не на шаг сима
    let oreAtEntry = 0; // баланс на входе в тир
    let earnedAtEntry = 0; // tierEarned тира на входе
    const durations = [];
    const buys = {};
    const tierStats = [];

    while (gameState.tier < TIERS.length - 1 && time < MAX_H * SECONDS_PER_HOUR) {
        // доход за шаг: пассив + ожидание кликов + авто-клики
        addOre(getOrePerSecond() * DT);
        addOre(clickIncome() * DT);
        time += DT;

        if (mode === 'lazy') {
            const uc = getNextUnlockPrice();
            if (uc != null && gameState.ore >= uc) {
                durations.push({ tier: gameState.tier, dur: time - tierStart });
                tierStart = time;
                unlockTier();
                buysThisTier = 0;
            }

            continue;
        }

        // жадная закупка: лучший ROI из доступных. Спуск: нечего купить с
        // окупаемостью быстрее времени до спуска, или лимит терпения исчерпан.
        for (let guard = 0; guard < BUY_GUARD; guard++) {
            // фактическое время до спуска: дефицит / ставка
            const uc = getNextUnlockPrice();
            const rate = Math.max(getEarningRate(), MIN_RATE);
            const eta = Math.max(0, (uc - gameState.ore) / rate);
            let best = null,
                bestRoi = 0;
            for (const def of UPGRADES) {
                if (!canBuy(def.id)) {
                    continue;
                }

                const d = deltaIncome(def.id);
                const c = getUpgradeCost(def.id);
                if (d > 0 && c / d <= eta) {
                    const roi = d / c;
                    if (roi > bestRoi) {
                        bestRoi = roi;
                        best = def.id;
                    }
                }
            }

            const canDescend = uc != null && gameState.ore >= uc;
            if (canDescend && (!best || buysThisTier >= PATIENCE)) {
                durations.push({ tier: gameState.tier, dur: time - tierStart });
                tierStats.push({
                    tier: gameState.tier,
                    price: uc,
                    anchor: gameState.tierAnchorRate,
                    rateOut: getEarningRate(),
                    oreIn: gameState.ore - oreAtEntry, // прирост баланса за тир (после трат)
                    earnedIn: gameState.tierEarned[gameState.tier] - earnedAtEntry // валовая добыча за тир
                });
                tierStart = time;
                unlockTier();
                buysThisTier = 0;
                oreAtEntry = gameState.ore;
                earnedAtEntry = gameState.tierEarned[gameState.tier];
                break;
            }

            if (!best || buysThisTier >= PATIENCE) {
                break;
            } // лимит терпения: ко-петля

            buyUpgrade(best);
            buys[best] = (buys[best] || 0) + 1;
            buysThisTier++;
        }
    }

    return { durations, buys, time, finished: gameState.tier >= TIERS.length - 1, tierStats };
}

function fmtLike(n) {
    if (!isFinite(n)) {
        return 'inf';
    }

    if (n >= 1e15) {
        return n.toExponential(2);
    }

    if (n >= 1e9) {
        return (n / 1e9).toFixed(1) + 'B';
    }

    if (n >= 1e6) {
        return (n / 1e6).toFixed(1) + 'M';
    }

    if (n >= 1e3) {
        return (n / 1e3).toFixed(1) + 'K';
    }

    return n.toFixed(1);
}

function printResult(label, r) {
    console.log(`\n=== ${label} ===`);
    console.log(
        'тир  руда       длительность   цена(якорь N сек)  якорь        ставка вых   рост   добыча за тир / цена'
    );
    const NAMES = TIERS.map((t) => t.name);
    const stat = (t) => r.tierStats.find((s) => s.tier === t);
    for (const d of r.durations) {
        const s = stat(d.tier);
        if (!s) {
            console.log(
                `${String(d.tier).padStart(2)} ${NAMES[d.tier].padEnd(8)} ${(d.dur / SECONDS_PER_MINUTE).toFixed(1).padStart(9)} мин`
            );
            continue;
        }

        const growth = 'x' + (s.rateOut / Math.max(s.anchor, MIN_RATE)).toFixed(1);
        const ratio = (s.earnedIn / Math.max(s.price, MIN_RATE)).toFixed(2);
        console.log(
            `${String(d.tier).padStart(2)} ${NAMES[d.tier].padEnd(8)} ${(d.dur / SECONDS_PER_MINUTE).toFixed(1).padStart(9)} мин ${fmtLike(s.price).padStart(12)} ${fmtLike(s.anchor).padStart(12)} ${fmtLike(s.rateOut).padStart(12)} ${growth.padStart(7)}  ${ratio}`
        );
    }

    if (!r.finished) {
        console.log(`!! оборвалась на ${MAX_H}ч, тир ${gameState.tier} (${NAMES[gameState.tier]})`);
    }

    const totalBuys = Object.values(r.buys).reduce((a, b) => a + b, 0);
    const top = Object.entries(r.buys)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id, n]) => `${id}:${n}`)
        .join(' ');
    console.log(`Итого до алмазов: ${(r.time / SECONDS_PER_HOUR).toFixed(1)} ч активной игры, покупок: ${totalBuys}`);
    console.log(`Топ закупок: ${top}`);
}

printResult(`БЕЗ ПОКУПОК (чистое накопление, клики ${CPS_MANUAL}/с)`, runSimulation('lazy'));
printResult(`ЖАДНАЯ ЗАКУПКА (окупаемость быстрее времени до спуска, клики ${CPS_MANUAL}/с)`, runSimulation('greedy'));

// ---------- Гейт П6: «все артефакты» ----------
// Ожидаемые множители выводятся из каталога ARTIFACTS (ground truth state.js):
// passiveMult = 1.1 (Тотем) x 1.15 (Аккумулятор) = 1.265; clickMult = 1.1
// (Рукавица) x 1.15 (Древняя кирка) = 1.265; плоские: critAdd +0.03,
// autoCpsAdd +0.5, offlineAdd +0.05, dropBonus +0.15; bossDamageMult 1.25 x 1.1.
// (В брифе П6 фигурировало «passiveMult 1.25 x 1.15» — в каталоге 1.1 x 1.15.)
let artFails = 0;
function artCheck(name, cond, detail = '') {
    const ok = Boolean(cond);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) {
        artFails++;
    }
}
const grantAllArtifacts = () => {
    gameState.artifacts = ARTIFACTS.map((a) => a.id);
};
const critFactor = (cc) => 1 + cc * (getCritMult() - 1); // critMult без focuslens = базовый

console.log('\n=== ВСЕ АРТЕФАКТЫ СТАРТА (гейт П6) ===');
{
    // (а)+(б): множители клика/пассива. miner 60 — иначе отношение 0/0 (чистый старт
    // без добычи); бафы предметов/дейли на чистом старте нейтральны.
    resetGame();
    gameState.levels.miner = 60;
    const baseDmg = getClickDamage();
    const baseClick = getExpectedClickGain();
    const baseOps = getOrePerSecond();
    grantAllArtifacts();
    const artDmg = getClickDamage();
    const artClick = getExpectedClickGain();
    const artOps = getOrePerSecond();
    const expClick = ARTIFACTS.reduce((acc, a) => (a.bonuses.clickMult ? acc * a.bonuses.clickMult : acc), 1);
    const expPassive = ARTIFACTS.reduce((acc, a) => (a.bonuses.passiveMult ? acc * a.bonuses.passiveMult : acc), 1);
    const critAdd = ARTIFACTS.reduce((acc, a) => acc + (a.bonuses.critAdd || 0), 0);
    const expClickGain =
        (expClick * critFactor(Math.min(CRIT_BASE_CHANCE + critAdd, CRIT_CHANCE_CAP))) / critFactor(CRIT_BASE_CHANCE);
    artCheck(
        `клик: getClickDamage x${expClick.toFixed(4)}`,
        Math.abs(artDmg / baseDmg - expClick) < ARTIFACT_EPS,
        `${fmtLike(baseDmg)} -> ${fmtLike(artDmg)}`
    );
    artCheck(
        `клик: getExpectedClickGain x${expClickGain.toFixed(4)} (множители + крит от critAdd)`,
        Math.abs(artClick / baseClick - expClickGain) < ARTIFACT_EPS,
        `${baseClick.toFixed(4)} -> ${artClick.toFixed(4)}`
    );
    artCheck(
        `пассив: getOrePerSecond x${expPassive.toFixed(4)}`,
        Math.abs(artOps / baseOps - expPassive) < ARTIFACT_EPS,
        `${fmtLike(baseOps)} -> ${fmtLike(artOps)}`
    );
    console.log(
        `множители при 9/9 артефактах: клик x${(artDmg / baseDmg).toFixed(4)}, E-клик x${(artClick / baseClick).toFixed(4)}, пассив x${(artOps / baseOps).toFixed(4)}`
    );

    // (в) якорь-снапшот: владение артефактами БЕЗ прокачки цену спуска не меняет
    // (якорь фиксируется на входе, как и для престижа). Тир 5/miner 50 — пол
    // UNLOCK_FLOOR не маскирует якорную величину.
    resetGame();
    gameState.tier = 5;
    gameState.levels.miner = 50;
    const priceNoArt = getNextUnlockPrice(); // лениво фиксирует якорь БЕЗ артефактов
    const anchorNoArt = gameState.tierAnchorRate;
    grantAllArtifacts();
    const priceWithArt = getNextUnlockPrice();
    const secNoArt = priceNoArt / anchorNoArt;
    const expSecT5 = unlockSecondsFor(5);
    artCheck(
        'якорь: владение артефактами цену не меняет (снапшот)',
        priceWithArt === priceNoArt,
        `${priceNoArt} -> ${priceWithArt}`
    );
    artCheck(
        `якорь: величина цены = N(5) = ${expSecT5.toFixed(0)}с якоря`,
        Math.abs(secNoArt - expSecT5) < 1 / anchorNoArt,
        `факт ${secNoArt.toFixed(2)}с (ceil цены = +<1 ед.)`
    );
    console.log(
        `величины тира 5 без артефактов: якорь ${fmtLike(anchorNoArt)}/с, цена ${fmtLike(priceNoArt)} = ${secNoArt.toFixed(1)}с якоря`
    );
    // величина на старте (тир 0): цена держится полом UNLOCK_FLOOR и с артефактами,
    // и без — артефакты стартового анчора не выше пола
    resetGame();
    const priceFloorBase = getNextUnlockPrice();
    grantAllArtifacts();
    const priceFloorArt = getNextUnlockPrice();
    artCheck(
        `якорь: тир 0 — цена держит пол UNLOCK_FLOOR = ${UNLOCK_FLOOR}`,
        priceFloorBase === UNLOCK_FLOOR && priceFloorArt === UNLOCK_FLOOR,
        `${priceFloorBase} / ${priceFloorArt}`
    );

    // (г) инвариант окупаемости (ETA-чек как в verify-economy): буст кирки x10
    // поднимает якорь над полом, после чего цена спуска = N(0) = 180с якоря
    // (коридор 0.9..1.1). Якорь фиксируется ПОСЛЕ 10 закупок кирки (ниже) —
    // сами закупки идут до его фиксации, поэтому цену якоря сравнивать не с чем.
    resetGame();
    grantAllArtifacts();
    for (let i = 0; i < 10; i++) {
        gameState.ore += getUpgradeCost('pickaxe');
        buyUpgrade('pickaxe');
    }

    const price = getNextUnlockPrice(); // якорь фиксируется от буста кирки
    const anchor = gameState.tierAnchorRate;
    const sec = price / anchor;
    const lo = UNLOCK_BASE_SECONDS * (1 - PAYBACK_CORRIDOR),
        hi = UNLOCK_BASE_SECONDS * (1 + PAYBACK_CORRIDOR);
    artCheck(
        `окупаемость: цена спуска = ${sec.toFixed(1)}с якоря, коридор ${UNLOCK_BASE_SECONDS}с x0.9..1.1`,
        sec >= lo && sec <= hi,
        `границы ${lo}..${hi}`
    );
    artCheck(
        'окупаемость: цена = ceil(N(0) x якорь)',
        price === Math.ceil(unlockSecondsFor(0) * anchor),
        `цена ${price}, якорь ${anchor.toFixed(3)}`
    );
    console.log(
        `величины буста: кирка ур.10, якорь ${fmtLike(anchor)}/с, цена ${fmtLike(price)}, окупаемость ${sec.toFixed(1)}с`
    );
}
console.log(artFails === 0 ? 'БАЛАНС «ВСЕ АРТЕФАКТЫ»: PASS' : `БАЛАНС «ВСЕ АРТЕФАКТЫ»: FAIL (${artFails})`);
if (artFails > 0) {
    process.exitCode = 1;
}
