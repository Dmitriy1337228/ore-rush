# Baseline фазы 2 «формы на DOM» (этап 0)

Документ ведётся по `docs/UI_DOM_PHASE2_PLAN.md`. Снят на отформатированном коде и новой
структуре после `docs/REPO_REFACTOR_PLAN.md` (ветка `phase2/dom-forms` от `master` `29628a0`).
Дата: 2026-11-17.

## 1. Гейты до правок (0.2)

| Команда | Код | Время |
|---|---|---|
| `npm test` | 0 (117/117) | 2 с |
| `npm run test:ui` | 0 (4/4) | 58.9 с |
| `npm run ui:tokens` | 0 | 0.3 с |
| `npm run ui:tokens:css` | 0 | 0.3 с |
| `npm run dom:tokens -- --check` | 0 | 0.3 с |
| `npm run ui:check` | 0 (0 новых ошибок, 0 новых предупреждений, долг 369) | 224.6 с |
| `npm run ui:check:dom` | 0 (7 × 26, 0/0) | 41.1 с |
| `npm run format:check` | 0 | 1.3 с |
| `npm run lint` | 0 | 1.1 с |
| `npm run scripts:check` | 0 | 0.3 с |
| `npm run layers:check` | 0 | 0.3 с |
| `node scripts/verify/verify-craft-dom.mjs` | 0 (40/40) | 40.6 с |

Внешнего долга в гейтах нет.

## 2. LOC форм (Phaser-путь)

| Файл | Строк |
|---|---|
| `src/ui/phaser/settingsModal.js` | 399 |
| `src/ui/phaser/statusModals.js` | 379 |
| специфичные проверки: `scripts/verify/verify-daily.mjs` | 234 |
| `scripts/verify/verify-boss.cjs` (вся проверка, форма — часть) | 1128 |
| `scripts/verify/verify-offline.cjs` | 252 |

Метрика этапа 4 — те же файлы через `pilot-loc.mjs --form` (обобщается на этапе 1).

## 3. Нарушения `ui:check` по состояниям форм

Все — известный долг (`baseline.json`), новых нет. Считано по `shots/ui-check/report.json`
(2026-11-17T07:13:48Z), ошибки + предупреждения MIN-FONT.

| Состояние | d1024 | d1280 | d1366 | d1920 | l844 | p360 | p390 | p412 | t768 | Итого |
|---|---|---|---|---|---|---|---|---|---|---|
| settings | 0 | 0 | 0 | 0 | 20 | 8 | 2 | 1 | 0 | **31** |
| settings-stress | 1 | 0 | 0 | 0 | 19 | 9 | 2 | 1 | 0 | **32** |
| daily | 0 | 0 | 0 | 0 | 14 | 2 | 2 | 1 | 0 | **19** |
| offline | 0 | 0 | 0 | 0 | 14 | 2 | 2 | 1 | 0 | **19** |
| player-down | 0 | 0 | 0 | 0 | 14 | 2 | 2 | 1 | 0 | **19** |
| boss-reward | 3 | 0 | 0 | 0 | 17 | 4 | 4 | 3 | 0 | **31** |

Итого по формам: **151** (настройки 63, статус 88). Часть долга — HUD под модалкой
(проверяется на гейте GA, шаг GA.3).

## 4. Скриншоты Phaser-эталонов

`docs/pilot-baseline/phase2/`: 6 вьюпортов (360×640, 390×844, 412×915, 768×1024,
844×390, 1280×720) × 5 состояний (settings, daily, offline, boss-reward, player-down) —
**30 PNG**, сняты скриптом на базе `pilot-baseline-shots.mjs` (временный, в репозиторий
не входит). Ошибок страницы при съёмке нет.

## 5. Вес бандла

`npm run build`: `index-CuEHZ4bP.js` 1 528.47 кБ (gzip 406.78), `craft-Dvsfqtei.js`
12.94 кБ (gzip 5.41), `craft-A_OqnNL1.css` 7.38 кБ (gzip 2.00). **JS+CSS gzip = 414.19 КБ**.

## 6. Пересчёт `fix`-счётчиков (0.4)

Скрипт `npm run metrics:fixcount` (`scripts/metrics/phase2-fixcount.mjs`): период 90 дней,
история с `--follow`, массовый коммит = ≥ 6 файлов в UI-каталогах.

| Файл | Все коммиты | Массовые | Чистые | Чистые `fix` |
|---|---|---|---|---|
| `settingsModal.js` (settings) | 15 | 8 | 7 | **3** |
| `statusModals.js` (status) | 13 | 8 | 5 | **1** |
| `upgrades.js` (был `panel.js`) | 14 | 8 | 6 | 2 |
| `mapScreen.js` (был `map.js`) | 10 | 6 | 4 | 2 |
| `gear.js` | 10 | 6 | 4 | 1 |
| `hud.js` | 12 | 7 | 5 | 2 |
| `tutorial.js` | 9 | 7 | 2 | 0 |

Массовые коммиты отсеяны (стиль/реорганизация кампании). Для `settings` порог (≥ 2)
выполнен — этап 2 стартует безусловно. Для `status` — **1 чистый fix**, что по правилу
10.1/раздела 5 означает «M2 отложен» на гейте GA (решение записывается после M1).

## 7. Метод замеров этапа 4

- LOC — `pilot-loc.mjs --form <form>` (обобщение на этапе 1; группы «экран / проверки / фикстуры»).
- Нарушения — `ui:check` (Phaser-состояния `*-dom` только PNG) и `ui:check:dom --form <form>`
  (те же 7 вьюпортов, 0 новых).
- Вес — `npm run build`, gzip всех `dist/assets/*.js|*.css`.
- p95 — `pilot-frame-p95.mjs --form <form>` (CPU ×4, 3×10 с), baseline дозаписывается в
  конце этапа 1 на Phaser-пути (`--legacy`).
