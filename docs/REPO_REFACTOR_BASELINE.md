# Baseline реорганизации `scripts/` и `src/` (журнал чисел)

Документ ведётся по `docs/REPO_REFACTOR_PLAN.md`. Раздел «Стиль» — этап S0,
инвентаризация и триаж — этапы 0–1, итоговые замеры — этап 5.

## 0. Предстартовая проверка (0.3)

| Пункт | Факт |
|---|---|
| Ветка/чистота | `master`, `git status` чист, планы закоммичены (`7401226`) |
| Параллельные ветки | `backup/feature-pre-cc`, `backup/master-pre-cc` — архивные; `feature/mine-map-bosses-artifacts-craft` — 2 коммита, только `README.md` и `.kilo/skills` (кода нет) |
| Версии | node v24.19.0, npm 11.17.0 |
| `npm ci` | ок (19 пакетов). Перед установкой остановлены забытые dev-серверы (vite на 5174 и `npm run dev -- --host`), державшие `node_modules` |
| `npm run build` | ок, 75 модулей, `dist/assets/index-DUrU2wPh.js` |
| Playwright | 1.65.0 |
| Порт 5174 | освобождён (остановлен забытый `vite --port 5174 --strictPort`) |
| Подтверждение игрока | «Приступи к выполнению» |

## 1. Baseline гейтов до изменений (S0.3)

| Гейт | Результат | Время |
|---|---|---|
| `npm test` | **117 тестов, 116 pass, 1 fail** — `state_meta.test.mjs` «r_bomb…»: `assert.equal(crafting.endsAt - Date.now(), 0)` дал `-1` (гонка ±1 мс, тест флейки; в dry-run тот же тест прошёл 117/117). Внешний долг, не чинится | 2 с |
| `npm run test:ui` | 4/4 pass | 59.6 с |
| `npm run ui:tokens` | 0 нарушений, проверяется **7 файлов** `src/scenes/ui` (без `layout.js`) | <1 с |
| `npm run ui:tokens:css` | 0 нарушений, 1 файл | <1 с |
| `npm run dom:tokens -- --check` | без дрейфа | <1 с |
| `npm run ui:check` | 144 прогона: 0 ошибок, 3 новых предупреждения (MIN-FONT, `p360 boss`), долг 368 | 219.8 с |
| `npm run ui:check:dom` | 7 вьюпортов × 26 рядов, 0 err / 0 warn | 40.8 с |
| `npm run test:dom-golden` | 0.003 % пикселей, порог 0.50 % — ok | 5.6 с |
| `npm run build` ×2 | имена `dist/assets/*` совпадают (детерминизм) | ~1 с |

**Baseline dist-хэша:** `index-DUrU2wPh.js` (1 528 488 Б; gzip 406.79 КБ),
`craftScreen-RSpNUm4y.js` (12 969 Б; gzip 5.42 КБ), `craftScreen-A_OqnNL1.css`
(7 380 Б; gzip 2.00 КБ). Остальные `dist/assets/*` — картинки/шрифты без изменений.

**Gzip baseline (JS+CSS):** 406.79 + 5.42 + 2.00 = **414.21 КБ**.

## 2. Блок S — стиль (dry-run S0.4–S0.6)

Dry-run выполнен в отдельном worktree `..\game_clicker-style-dry` (ветка `dry/style`),
worktree и ветка удалены после прогона. Инструменты: `prettier 3.10.1`,
`eslint 10.15.0`, `@stylistic/eslint-plugin 6.0.1` (`--save-exact`).

**Отклонение от Приложения D (записано по правилу 0.4):** в `.prettierrc` добавлен
`"embeddedLanguageFormatting": "off"`. Причина: с настройкой по умолчанию Prettier
переформатирует HTML-шаблоны внутри шаблонных литералов (`alt="">` → `alt="" />`,
переносы `>`), из-за чего `dist` расходился: `craftScreen` +187 Б, оба хэша другие —
критерий «dist-хэш до = после» красный, и это не эквивалентное изменение (пробелы в
HTML меняют inline-раскладку DOM). С выключенным embedded-форматированием хэши
совпали байт-в-байт.

**Единственная ручная правка в стиль-коммите:** `src/scenes/ui/hud.js` —
боковой комментарий `// 26 — диаметр шестерёнки в кнопке` перенесён на строку над
`.setDisplaySize(26, 26)` внутри цепочки (D13). Причина: Prettier разбил цепочку, и
`ui:tokens` (`hasCommentNearby`) перестал видеть обоснование голого числа — 2 нарушения.

**Объём механического диффа (dry-run):**

| Зона | Файлов | +строк | −строк |
|---|---|---|---|
| `src/` (scenes, state, ui, dom, dev, layout, main, sfx, sdk) | 63 | 4 601 | 1 124 |
| `scripts/` | 35 | 4 402 | 1 238 |
| `tests/` | 14 | 1 010 | 296 |
| `vite.config.js` | 0 (без изменений) | — | — |
| **Итого исходников** | **112** | **~10 978** | **~3 135** |

`package.json` (+8/−1, скрипты `format`/`format:check`/`lint`/`lint:fix`) и
`package-lock.json` (+1087/−17, три пакета) — отдельным коммитом S1.

**Гейты в dry-run после формата:** `format:check` 0, `lint` 0, `ui:tokens` 0
(те же 7 файлов), `ui:tokens:css` 0, `dom:tokens --check` 0, `npm test` 117/117,
`test:ui` 4/4, `ui:check` 0 новых ошибок и 0 новых предупреждений (долг 369),
`ui:check:dom` 0/0, `test:dom-golden` 0.003 %. `dist`-хэши: `index-DUrU2wPh.js`,
`craftScreen-RSpNUm4y.js` — **совпадают с baseline**. Идемпотентность: повторный
`format → lint:fix → format` диффа не даёт.

## 3. Гейты на отформатированном коде (этап 0.1)

Прогон на состоянии после коммитов стиля (`da0acb9`, `44d874d`, `1db20c0` — только docs):

| Гейт | Результат |
|---|---|
| `npm test` | 117/117 pass (флейк `r_bomb` не воспроизвёлся) |
| `npm run test:ui` | 4/4 pass |
| `npm run ui:tokens` | 0 нарушений, 7 файлов |
| `npm run ui:tokens:css` | 0 нарушений |
| `npm run dom:tokens -- --check` | без дрейфа |
| `npm run ui:check` | 0 новых ошибок, 3 новых предупреждения (MIN-FONT `p360 boss`, как в baseline), долг 368 |
| `npm run ui:check:dom` | 7 × 26, 0 err / 0 warn |
| `npm run test:dom-golden` | 0.003 % — ok |
| `npm run format:check` | 0 |
| `npm run lint` | 0 |
| `npm run build` | `index-DUrU2wPh.js`, `craftScreen-RSpNUm4y.js` — совпадают с baseline |

Блок S: **104 файла** изменено Prettier (+7 974/−2 544), затем **95 файлов**
ESLint-автофиксов (+3 106/−693); ручная правка одна (`hud.js`, перенос комментария).

## 4. Инвентаризация фактов (этап 0.2)

| Факт | Значение |
|---|---|
| Файлов в `scripts/` (без `lib/`) | 35: 21 `*.mjs`, 10 `*.cjs`, 4 `*.py` |
| Файлов в `scripts/lib/` | 2 (`dev-server.cjs`, `ui-matrix.mjs`) |
| Всего файлов `scripts/` | **37** |
| Файлов в `src/` | 73 (71 `*.js` + `dom.css` + `tokens.css`) |
| Файлов `src/*.js`, импортирующих `src/ui/theme.js` | **18** |
| Импортов `src/ui/uiKit.js` из `src/` | **12** |
| Импорт-строк на `state.js` из `src/` | **37** (файлов — 26) |
| Упоминаний `scripts/` в `package.json` | 9 (7 гейтов + 2 в глобах format) |
| Упоминаний `scripts/` в `tests/` | 15 |
| Упоминаний `scripts/` в `.kilo/` | 11 |
| Упоминаний `scripts/` в `AGENTS.md` | 3 |
| Упоминаний `scripts/` в `docs/` | 155 (исторические документы не правим — D7) |

### Зашитые пути (Приложение B плана, факт после S2)

| Файл:строка | Что зашито | Куда при переносе |
|---|---|---|
| `scripts/ui-tokens.mjs:17` | `DIR = 'src/scenes/ui'` | новые папки экранов + виджетов |
| `scripts/gen-dom-tokens.mjs:13` | `../src/ui/theme.js` | `../src/ui/shared/theme.js` |
| `scripts/gen-dom-tokens.mjs:64,131,135` | тексты про `src/dom/tokens.css`, `src/ui/theme.js` | новые пути |
| `scripts/ui-tokens-css.mjs:118` | `path.join('src/dom', f)` | `src/ui/dom` |
| `scripts/ui-check-dom.mjs:21,22` | `../src/dev/uiAudit.js`, `../src/state.js` | `../..`-глубина после `gates/` |
| `scripts/ui-check-dom.mjs:357` | детект `/src/state.js` | **не меняется** (D2) |
| `scripts/ui-review.mjs:340` | детект `/src/state.js` | **не меняется** (D2) |
| `scripts/lib/dev-server.cjs:11` | `__dirname` на два уровня выше | `lib/` остаётся — без изменений |
| `scripts/pilot-loc.mjs:17–31` | `src/scenes/ui/craftScreen.js`, `src/dom`, `scripts/…` | новые пути |
| `scripts/build-dom-lab.mjs:10,27,29,37` | `src/dom/*` | `src/ui/dom/*` |
| `scripts/build-dom-craft-snapshot.mjs:65,91,93` | `src/dom/tokens.css`, `dom.css` | `src/ui/dom/*` |
| `scripts/verify-craft-dom.mjs:12,105,416,630,774` | `src/dom/bridge.js`, `src/state.js`-детект | `src/ui/dom/bridge.js` |
| `tests/characterization/ui_review_golden.mjs:81` | spawn `scripts/ui-review.mjs` | `scripts/gates/ui-review.mjs` |
| `src/scenes/UIScene.js` | 9 статических `./ui/*` + динамический `../dom/craftScreen.js` | `src/ui/*` |
| `dom-lab.html:22` | `/src/dom/lab.js` | `/src/ui/dom/dev/lab.js` |
| `src/dev/uiAudit.js:8,28,146` | `scripts/ui-check.mjs`, `../state.js`, `src/dom` | новые пути |
| `package.json:12–18` | 7 путей гейтов | `scripts/gates/*` |

`vite.config.js` зашитых путей `src/dom`/`scripts/` не содержит.

