# Baseline фазы 3 DOM (этап 0)

Дата: 2026-11-20 · Ветка: `phase3/dom-forms` от `master` (bf4c027) · План: `docs/dom-phase3/UI_DOM_PHASE3_PLAN.md`.

Все числа сняты скриптами проекта на этой же машине (Windows, Chromium Playwright), чтобы
замеры этапа 3 были сравнимы тем же методом. Пути артефактов — от корня репозитория.

## 1. Гейты «до» (полный набор 0.3)

| Команда | Итог |
|---|---|
| `npm test` | 144 pass, 0 fail |
| `npm run test:ui` | 4/4 pass (golden-прогон UI, 61.9 с) |
| `npm run ui:tokens` | ок |
| `npm run ui:tokens:css` | ок |
| `npm run dom:tokens -- --check` | ок |
| `npm run ui:check` | 162 combo, новых ошибок 0, новых предупреждений **3**, долг 368, console 0 |
| `npm run ui:check:dom` | 16 прогонов (craft+settings × 8 вьюпортов), 0 err / 0 warn / 0 console |
| `npm run format:check` | ок |
| `npm run lint` | ок |
| `npm run scripts:check` | ок |
| `npm run layers:check` | ок |
| `npm run verify:craft-dom` | 40/40 ok |
| `npm run verify:settings-dom` | 28 OK, 0 FAIL |
| `npm run build` | ок (1.53 МБ index, предупреждение размера чанка — историческое) |

**Внешний долг (не чинится в этой фазе):** `ui:check` показывает 3 новых MIN-FONT
предупреждения в `p360|boss` (кегли `x#`/`Купить #B` в панели снаряжения; порог 10 CSS px,
факт 8.5–9.0). На `master` до правок фазы 3 поведение идентично: изменения этапа 0 —
`formsFlag.js`/`forms-flag.mjs` (без влияния на рендер) и реестр/метрики. Эти три
предупреждения — воспроизводимая разница окружения/шрифтов (тот же `p360|boss` уже имеет
4 записи долга в `tests/ui-check/baseline.json`); `baseline.json` не расширяется.

## 2. LOC baseline (метод `metrics:loc`)

| Файл / группа | строк кода | строк всего |
|---|---|---|
| `src/ui/phaser/upgrades.js` | **573** | 723 |
| `src/ui/phaser/gear.js` | **193** | 255 |
| Phaser-пара (baseline `upgrades`) | 766 | 978 |

Списки проверок статуса (тот же метод: непустые строки без чисто-комментарных):

| Файл | строк кода | строк всего |
|---|---|---|
| `scripts/verify/verify-daily.mjs` | 207 | 235 |
| `scripts/verify/verify-boss.cjs` | 1045 | 1129 |
| `scripts/verify/verify-offline.cjs` | 212 | 253 |
| `scripts/verify/verify-bulkbuy.cjs` | 177 | 196 |
| `scripts/verify/verify-responsive.cjs` | 678 | 732 |
| `scripts/verify/verify-rebalance.cjs` | 73 | 83 |
| `scripts/verify/verify-map.cjs` | 683 | 780 |
| `scripts/verify/verify-devpanel.cjs` | 102 | 119 |

W1 этапа 3 для `upgrades` сравнивается **только** с `src/ui/phaser/upgrades.js` (573);
`gear.js` — вне сравнения (Q2: постоянный Phaser-слой).

## 3. Нарушения вёрстки «до» (`shots/ui-check/report.json`)

Агрегат по состояниям (долг baseline, не новые):

| Группа | Состояния | Всего | err | warn |
|---|---|---|---|---|
| Статус-модалки | daily / offline / player-down / boss-reward | 88 | 38 | 50 |
| Панель списка | mid / mid-scrolled / deep / stress | 85 | 36 | 49 |
| Снаряжение (боевая панель) | boss | 57 | 23 | 34 |

По статус-модалкам — 19/19/19/31 (`daily`/`offline`/`player-down`/`boss-reward`), что
совпадает с baseline фазы 2 §3 (переприёмка долга воспроизводится).

Число рядов каталога: **27 улучшений — 20 `equipment` + 7 `enhance`**
(`src/state/catalog/upgrades.js`; реестр `upgrades.expected()` считает из каталога).

## 4. Вес бандла «до» (`metrics:gzip`, `npm run build`)

| Файл | gzip |
|---|---|
| `index-*.js` | 393.77 КБ |
| `components-*.js` | 3.61 КБ |
| `craft-*.js` | 2.69 КБ |
| `settingsScreen-*.js` | 2.07 КБ |
| `craft-*.css` | 2.30 КБ |
| **Итого JS+CSS** | **404.43 КБ** |

Метод: `zlib.gzipSync(level 9)` по `dist/assets/*.{js,css}`. W2 фазы 3 — прирост на форму
≤ 15 КБ gzip.

## 5. Справочно: fix-счётчики (`metrics:fixcount`, не гейт — решение владельца №2)

| Файл | все | массовые | чистые | чистые fix |
|---|---|---|---|---|
| `src/ui/phaser/upgrades.js` | 14 | 8 | 6 | 2 |
| `src/ui/phaser/gear.js` | 10 | 6 | 4 | 1 |
| `src/ui/phaser/statusModals.js` | 14 | 9 | 5 | 1 |
| `src/ui/phaser/settingsModal.js` | 16 | 9 | 7 | 3 |

## 6. p95 списка улучшений (расширенный протокол Q4)

Скрипт: `npm run metrics:p95 -- --form upgrades [--legacy]` (CPU ×4, deviceScaleFactor 1,
3 раунда × 10 с после 1 с прогрева; фазы внутри раунда: покой → скролл → серия покупок
(250 мс между кликами) → смена вкладок, циклом 1.5 с; long tasks > 50 мс через
PerformanceObserver; viewport 1280×720 и 390×844, stress-сид, полный каталог).

Phaser-baseline (`--legacy`): `docs/dom-phase3/baseline/phase3-p95-upgrades-phaser.json`

| Вьюпорт | p50 | p95 | max | кадров | long tasks |
|---|---|---|---|---|---|
| 1280×720 | 16.7 | **33.3** | 66.7 | 1651 | 2 (max 55 мс) |
| 390×844 | 16.7 | **33.4** | 100.0 | 1406 | 3 (max 91 мс) |

### Порог p95 фазы 3 (фиксируется до старта M3)

Правило плана: «Phaser-baseline + 2 мс»; baseline ≥ ~10 мс, пересчёт не требуется.

> **Порог p95 для DOM-списка: ≤ 35.4 мс** (max(33.3; 33.4) + 2), оба вьюпорта,
> тот же протокол, W-критерий (провал не откатывает форму, фиксируется в отчёте).

Отклик покупки (доп-критерий Q4): «клик → ряд перерисован ≤ 1 кадра» (rAF-счётчик);
методика — синхронное событие покупки + чтение текста ряда в том же кадре
(`verify-upgrades-dom` на этапе 2).

## 7. Спайк M3 (go/no-go, шаг 0.5)

Прототип: черновая ветка контроллера `src/ui/dom/upgradesPanel.js` (он же станет боевым
на этапе 2), смонтированная в dev только по флагу `?domUpgradesSpike=1`; в прод не
попадает (монтирование в `UIScene` закрыто `import.meta.env.DEV`); Phaser-ряды на спайке
не строятся (`rows: 0`).

Замер: `docs/dom-phase3/baseline/phase3-p95-upgrades-dom-spike.json`

| Вьюпорт | p50 | p95 | max | кадров | long tasks |
|---|---|---|---|---|---|
| 1280×720 | 16.7 | **16.7** | 33.4 | 1800 | 0 |
| 390×844 | 16.7 | **16.7** | 33.4 | 1801 | 0 |

Функциональная проверка спайка (Playwright, stress-сид): панель смонтирована и видима,
20 рядов equipment + 7 enhance (27/27), 2 вкладки, 4 пакета; прямоугольник панели
совпадает с Phaser-вьюпортом (934…1230 × 192…662 на 1280×720); покупка x1 обновляет ряд
синхронно за **0.9 мс** (≤ 1 кадра), `saveGame()` вызван; вкладки переключаются.

**Решение: GO.** p95 16.7 мс ≤ 35.4 мс, отклик покупки ≤ 1 кадра → M3 выполняется на
этапе 2.

## 8. Метод замеров этапа 3 (те же скрипты)

- LOC — `npm run metrics:loc -- --form upgrades` (списки файлов — `scripts/metrics/pilot-loc.mjs`).
- Нарушения — `npm run ui:check` (Phaser-состояния) и `npm run ui:check:dom -- --form …`.
- Бандл — `npm run build` + `npm run metrics:gzip`.
- p95 — `npm run metrics:p95 -- --form upgrades` (DOM) / `--legacy` (Phaser).
- fixcount — `npm run metrics:fixcount` (справочно).
- Golden — `npm run test:dom-golden -- --form … --runs 3`.

## 9. Примечание после доводки вида (2026-11-21)

Baseline «до» не пересчитывался. Спайк §7 мерил черновую панель с прямоугольником из процентов
Phaser-вьюпорта и 27/27 рядами в DOM; после доводки к Phaser-эталону DOM-список показывает
только «доступные + следующее» (как Phaser, isUpgradeVisible), поэтому число рядов в DOM
на mid-сиде — 10 (equipment), а полный охват 27/27 даёт аудит ui:check:dom на stress-сиде.
Числа p95/отклика §7 остаются точкой отсчёта; перезамер после доводки — вне объёма (геометрия
менялась только в CSS/раскладке, число DOM-узлов списка не выросло).
