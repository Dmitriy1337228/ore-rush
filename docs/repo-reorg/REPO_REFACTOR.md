# Реорганизация `scripts/` и `src/` (предложение)

Статус: **предложение на согласование** · Дата: 2026-11-16
Контекст: после пилота DOM и фазы 2 в проекте два UI-стека (Phaser-примитивы + формы DOM);
в `src` две папки `ui`, в `scripts` — 41 файл без явной структуры.
Цель — навести порядок **без изменения поведения**, отдельными проверяемыми коммитами.

---

## 1. Что имеем (факты)

### 1.1. `scripts/` — 41 файл

| Категория | Файлы | Сколько | Нужны? |
|---|---|---|---|
| Гейты (в `package.json`) | `ui-check.mjs`, `ui-check-dom.mjs`, `ui-review.mjs`, `ui-tokens.mjs`, `ui-tokens-css.mjs`, `gen-dom-tokens.mjs`, `dom-golden.mjs` | 7 | **Да, ядро** |
| Библиотеки гейтов | `lib/dev-server.cjs`, `lib/ui-matrix.mjs` | 2 | **Да** |
| Приёмка поведения | `verify-craft-dom.mjs` + 14 `verify-*.{cjs,mjs}` | 15 | Частично: триаж (см. 3.3) |
| Метрики/диагностика пилота | `pilot-frame-p95`, `pilot-loc`, `pilot-dom-input-check`, `pilot-layers-check`, `pilot-dpr-shots`, `pilot-baseline-shots` | 6 | 3 оставить, 3 архив |
| Стенды для телефона/дизайна | `build-dom-lab.mjs`, `build-dom-craft-snapshot.mjs` | 2 | **Да** (проверка без сети) |
| Аудио-пайплайн | `gen_bgm.py`, `gen_sfx.py`, `synth_sfx.py`, `trim_sfx.py` | 4 | **Да** (документированы) |
| Симуляция/метрики баланса | `balance-sim.mjs` | 1 | **Да** (есть golden-тест) |

Проблемы: плоская свалка; имена `pilot-*`/`verify-*` не говорят, что гейт, а что одноразовое;
`ui-review.mjs` (46 КБ) лежит рядом с одноразовыми скриптами; часть `verify-*` не упомянута
ни в `package.json`, ни в документации (последние правки — ноябрь 2026, т.е. живые, но «теневые»).

### 1.2. `src/` — две `ui` и «сцены-склады»

- `src/ui/` — Phaser-примитивы: `theme.js` (18 импортов), `uiKit.js` (10), `button.js` (5),
  `panel.js` (4), `listGeometry.js` (5), `iconMetrics.js` (4), `stack.js` (1).
- `src/scenes/ui/` — миксины экранов Phaser (hud, panel=список улучшений, gear, mapScreen,
  settingsModal, statusModals, tutorial, layout) — импортируются только UIScene (через `./ui/...`).
- `src/dom/` — DOM-слой: `craftScreen.js`, `bridge.js`, `components.js`, `html.js`, `iconFit.js`,
  `root.js`, `tokens.css`, `dom.css` + dev-стенд (`fixtures*`, `lab.js`).
- `src/scenes/game/` — модули GameScene (block, boss, effects, timers…), сам `GameScene.js` — уровнем выше.
- `src/state.js` — баррель рядом с папкой `src/state/` (двусмысленно, но не критично).

Проблемы: непонятно, куда класть новый UI; два `panel.js` (виджет и экран улучшений);
Phaser-миксины экранов называются «scenes», хотя это не сцены; DOM-стенды лежат в прод-папке.

---

## 2. Целевая структура

```
src/
  main.js                 точка входа (без изменений)
  layout.js               общая сетка (Phaser) — остаётся в корне
  sfx.js                  мост звука (общий)
  game/                   ИГРА (Phaser): GameScene.js + block/boss/effects/timers/mutation/...
  ui/
    phaser/               UI на Phaser
      UIScene.js          единственная UI-сцена
      theme.js            (примитивы; импорты внутри папки не меняются)
      uiKit.js
      widgets/            button.js, panelFrame.js, stack.js, listGeometry.js, iconMetrics.js
      screens/            hud.js, upgradesList.js, gear.js, map.js, settings.js,
                          statusModals.js, tutorial.js, layout.js
    dom/                  UI на DOM
      craft.js            (было craftScreen.js)
      bridge.js, components.js, html.js, iconFit.js, root.js
      tokens.css (генерируется), dom.css
      dev/                fixtures.js, fixtureMarkup.js, fixtureApp.js, lab.js
  scenes/                 только «оболочки»: BootScene.js (UIScene переехала в ui/phaser)
  state/                  state/index.js (было state.js) + модули, без изменений логики
  sdk/, sdk-stub.js, dev/, state.js? — см. этап C
```

Правила после реорганизации:
1. `src/ui/phaser/**` — только Phaser-UI; `src/ui/dom/**` — только DOM-UI; `src/game/**` — только игровой цикл.
2. Новый экран-форма → `src/ui/dom/`; новый HUD/игровой оверлей → `src/ui/phaser/screens/`.
3. Никаких двух файлов с одинаковым именем-смыслом: `panel` → `widgets/panelFrame.js` и `screens/upgradesList.js`.
4. Dev-стенды DOM (`fixtures*`, `lab.js`) — только в `ui/dom/dev/` и не импортируются прод-кодом.

### 2.1. Ключевые переименования (без изменения кода)

| Было | Стало | Причина |
|---|---|---|
| `src/scenes/GameScene.js` + `src/scenes/game/*` | `src/game/GameScene.js` + `src/game/*` | «Игра» отдельно от «сцен-оболочек» |
| `src/ui/*` | `src/ui/phaser/{theme,uiKit}.js`, `src/ui/phaser/widgets/*` | Один UI-корень, два движка |
| `src/scenes/ui/*` | `src/ui/phaser/screens/*` | Экраны — не сцены |
| `src/scenes/ui/panel.js` | `src/ui/phaser/screens/upgradesList.js` | Убрать коллизию имён с виджетом |
| `src/ui/panel.js` | `src/ui/phaser/widgets/panelFrame.js` | Явно «рамка-панель» |
| `src/scenes/ui/mapScreen.js` / `settingsModal.js` | `.../screens/map.js` / `settings.js` | Короче и по смыслу |
| `src/dom/craftScreen.js` | `src/dom/craft.js` | Единый стиль форм |
| `src/dom/*.css` | остаются в `src/dom/` | Рядом с токенами и формами |
| `src/scenes/UIScene.js` | `src/ui/phaser/UIScene.js` | UI-сцена принадлежит UI-слою |

### 2.2. `scripts/` — целевая структура

```
scripts/
  gates/        ui-check.mjs, ui-check-dom.mjs, ui-review.mjs, ui-tokens.mjs,
                ui-tokens-css.mjs, gen-dom-tokens.mjs, dom-golden.mjs
  verify/       verify-craft-dom.mjs + прошедшие триаж verify-*.{cjs,mjs}
  metrics/      pilot-frame-p95.mjs, pilot-loc.mjs, pilot-layers-check.mjs
  stands/       build-dom-lab.mjs, build-dom-craft-snapshot.mjs
  audio/        gen_bgm.py, gen_sfx.py, synth_sfx.py, trim_sfx.py
  data/         balance-sim.mjs, lib/ui-matrix.mjs
  lib/          dev-server.cjs
  archive/      снятые с эксплуатации pilot-*/verify-* (см. 3.3)
```

`package.json` получает явные алиасы: `verify:craft-dom`, `verify:boss`, …,
`metrics:p95`, `metrics:loc`, `stand:dom-lab`, `stand:craft-phone`.
Правило: **в `scripts/` нет скрипта без npm-алиаса и без строки в `docs/`** (кроме `lib/`).

---

## 3. Этапы (каждый — отдельный коммит, без изменения поведения)

### Этап A. Инвентаризация `scripts/` и триаж `verify-*` (0.5 дня)
1. Прогнать каждый `verify-*` один раз, зафиксировать: время, проходит/падает, что покрывает.
2. Решение по каждому по правилу: **оставить**, если (а) покрывает подсистему без unit-теста,
   (б) проходит ≤ 2 мин, (в) обновлялся за последний месяц. Иначе — `archive/` (файл сохраняется,
   но исключается из активной работы) или удаление (история в git).
3. Кандидаты на архив заранее: `verify-responsive` (заменён `ui:check`), `verify-rebalance`,
   `verify-devpanel`; кандидаты на удаление: `pilot-baseline-shots` (историческая база),
   `pilot-dpr-shots` (разовый замер), `pilot-dom-input-check` (входит в `verify-craft-dom`).
4. Результат — таблица в этом документе (до/после) + npm-алиасы.

**Гейт A:** `npm test`, `test:ui`, `ui:check:quick`, `ui:check:dom` — без изменений; ни один
действующий гейт не изменил путь.

### Этап B. `scripts/` по папкам + алиасы (0.5 дня)
1. `git mv` по структуре 2.2; обновить относительные импорты `lib/`, пути в `package.json`,
   `tests/characterization/ui_review_golden.mjs` (spawn `scripts/ui-review.mjs`),
   docs/AGENTS/.kilo/skills.
2. Проверить `npm run <каждый алиас>` (гейты — полный прогон, verify — smoke).
3. В `docs/UI_LAYOUT.md` и `AGENTS.md` — новые пути.

**Гейт B:** все npm-скрипты зелёные; `git log --stat` показывает только `R` (rename) и пути.

### Этап C. `src/` — UI-корень и игровой слой (1 день)
1. `git mv src/ui/* → src/ui/phaser/*` (примитивы), `widgets/` для виджетов;
   `git mv src/scenes/ui/* → src/ui/phaser/screens/*`; UIScene → `src/ui/phaser/UIScene.js`.
2. `git mv src/scenes/game/* → src/game/*`, `GameScene.js → src/game/GameScene.js`.
3. `git mv src/dom → src/ui/dom`; dev-стенды → `src/ui/dom/dev/`.
4. Автоматическая правка импортов (скрипт-кодмод по карте путей), затем ручная проверка
   `npm run build` и запуск игры.
5. Переименования из 2.1 в том же этапе (или отдельным коммитом C2).

**Гейт C:** сборка, `npm test`, `test:ui`, `ui:check`, `ui:check:dom`, `dom:tokens --check`,
`ui:tokens:css`; bundle gzip не изменился (допуск ±0.5 КБ из-за путей); DOM-golden без диффа.

### Этап D. Баррель `state.js` (0.5 дня, опционально)
`src/state.js` → `src/state/index.js`, кодмод импортов (`from '../state.js'` → `'../state/index.js'`
или `'../state'`). Плюс: нет файла-обманки рядом с папкой. Минус: правка ~40 импортов.
Решение — по результатам этапа C (если шума мало, делаем; иначе оставляем).

### Этап E. Документация и правила (0.5 дня)
- `AGENTS.md`: карта «куда класть новый экран», запрет второго `ui` вне `src/ui`.
- `docs/UI_LAYOUT.md`: пути гейтов; `scripts/README.md` — таблица «скрипт → назначение → алиас».
- Скилл `ui-layout-check`: новые пути.

**Итоговый гейт:** `npm test`, `test:ui`, `ui:check`, `ui:check:dom`, `test:dom-golden`,
`ui:tokens`, `ui:tokens:css`, `dom:tokens --check` — всё зелёное; ручной smoke игры (мастерская,
настройки, карта, бой) на 1280×720 и 390×844.

---

## 4. Что удаляем/архивируем (предварительно)

| Файл | Решение | Почему |
|---|---|---|
| `pilot-baseline-shots.mjs` | archive | Исторический снимок этапа 0; база зафиксирована в `docs/dom-pilot/baseline/` |
| `pilot-dpr-shots.mjs` | archive | Разовый замер DPR; при новых шрифтах можно вернуть из истории |
| `pilot-dom-input-check.mjs` | delete | Полностью покрыт `verify-craft-dom` (блокировка/фон/тач) |
| `verify-responsive.cjs` | archive | Заменён матрицей `ui:check` + `ui:check:dom` |
| `verify-rebalance.cjs`, `verify-devpanel.cjs` | триаж A | Точечные ручные прогоны; вернуть при необходимости |
| `verify-economy.mjs`, `verify-bulkbuy.cjs` | триаж A | Есть unit-тесты `state_economy`; проверить уникальность браузерных сценариев |
| `balance-sim.mjs` | оставить (data) | Питает golden-тест баланса |

Ничего не удаляется без строки в таблице триажа и зелёных гейтов.

---

## 5. Риски и меры

| Риск | Мера |
|---|---|
| Массовый перенос импортов ломает сборку | Кодмод + `node --check`, сборка и полный гейт на каждом этапе; каждый этап — отдельный коммит |
| `git` потеряет историю файлов | Только `git mv` (rename detection), без copy+delete |
| Гейты временно не находятся по старым путям (docs/tests) | Обновлять пути в том же коммите; grep по старым путям перед коммитом |
| `verify-*` окажутся нужны после архивации | Файлы остаются в `scripts/archive/` и в истории; вернуть = `git mv` обратно |
| Смешение слоёв снова появится | Правило в `AGENTS.md` + структура папок + ревью-чеклист |
| Долгая миграция | Таймбокс 3 дня; этапы A/B независимы от C/D — можно остановиться после любого |

---

## 6. Таймбокс и результат

| Этап | Оценка |
|---|---|
| A. Триаж scripts | 0.5 дня |
| B. Папки scripts + алиасы | 0.5 дня |
| C. src: ui-корень, game, dom | 1 день |
| D. state-баррель (опц.) | 0.5 дня |
| E. Документация | 0.5 дня |
| **Итого** | **≤ 3 дней** |

Ожидаемый результат:
- `scripts/` из 41 файла → ~25 активных + `archive/`; каждый активный скрипт имеет алиас и строку в docs.
- `src/`: один `ui`-корень с явными движками `phaser/` и `dom/`; игра в `src/game/`; никаких двух `panel.js`.
- Ни одного изменения поведения: все гейты и golden обязаны остаться зелёными.

---

## 7. Вопросы на апрув

1. Структура `src/ui/phaser|dom` + `src/game` — принимается? (альтернатива — `src/ui-phaser`/`src/ui-dom` в корне)
2. `scripts/archive/` (файлы остаются) или сразу удалять снятые скрипты?
3. `verify-*`: триаж по правилу 3.1 или сразу оставить все 14 как есть (только разложить по папкам)?
4. Перенос `state.js` → `state/index.js` — делать (этап D) или оставить баррель?
5. Таймбокс 3 дня и остановка после любого этапа — ок?
