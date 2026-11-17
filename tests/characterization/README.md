# Characterization-тесты

Набор фиксирует **текущее** поведение проекта как есть (включая квирки — они
помечены `// CHARACTERIZATION: current behavior, may be a bug`). Это страховка
перед рефакторингом: любое изменение поведения ломает хотя бы один тест.
Источник истины — код, не спецификация; ничего не чинится и не улучшается.

## Запуск

```bash
npm test        # unit + CLI golden (node --test, ~1-2 с, без браузера)
npm run test:ui # полный UI-golden прогон scripts/gates/ui-review.mjs (~1 мин, Playwright)
```

Требования: Node >= 20 (написано и проверено на Node 24), для `test:ui` —
установленные браузеры Playwright (`npx playwright install chromium`).

## Структура

```
tests/characterization/
├── state_economy.test.mjs     каталоги/константы/fmt/цены/мультипокупка/видимость/спуск
├── state_meta.test.mjs        клик-роллы/боссы/крафт/предметы/дейли/престиж/мутации
├── state_persist.test.mjs     сейв/миграции v1..v5/офлайн/lastExit/resetGame/sdk-stub
├── state_settings.test.mjs    src/state/settings.js — громкость (clamp, 0 сохраняется), тумблеры
├── settings_messages.test.mjs тексты настроек (статы/подписи/prestigeInfo, оба пути)
├── craft_messages.test.mjs    тексты мастерской (единый источник DOM и Phaser)
├── dom_bridge.test.mjs        снимки bridge.js (только чтение; набор состояний → снимок)
├── dom_modal.test.mjs         каркас modal.js/rangeInput (разметка, нет голых px, слайдер)
├── forms_flag.test.mjs        isPhaserForm: query/localStorage/неизвестные имена
├── layout.test.mjs            computeLayout/baseForOrientation (golden-объекты)
├── sdk_adapter.test.mjs       src/sdk/yandex.js (standalone-поведение, колбэки adv)
├── balance_sim_golden.test.mjs CLI scripts/data/balance-sim.mjs (stdout = golden-файл)
├── ui_review_golden.mjs       полный прогон scripts/gates/ui-review.mjs (медленный, вне npm test)
├── helpers/
│   ├── globals.mjs            shim localStorage + динамические импорты src/* + stubRandom
│   └── png.mjs                минимальный PNG-декодер + pixel-diff (без зависимостей)
├── golden/
│   ├── state_catalog.json     снапшот каталогов/константов/initialState (write_catalog_golden.mjs)
│   ├── balance-sim_default.out    stdout CLI (дефолтные аргументы)
│   ├── balance-sim_cps2_h30.out   stdout CLI (аргументы "2 30")
│   ├── dom/                   DOM-эталоны форм: craft/ и settings/ (1280x720, 390x844)
│   │                          — гейт test:dom-golden (scripts/gates/dom-golden.mjs)
│   └── ui/                    Phaser-golden артефакты ui-review: 21 png, 9 layout_audit*.txt,
│                              console_errors.txt, run.stdout.txt
│                              (скриншоты форм здесь — до кампании phaser-cleanup, которая
│                              заменит их на golden/dom/<form>/ и удалит Phaser-снимки)
└── tools/
    ├── capture_goldens.mjs    снимает значения с текущего кода (JSON в stdout) — источник чисел
    ├── write_catalog_golden.mjs  перегенерация golden/state_catalog.json
    └── png_diff.mjs           сравнение двух каталогов скриншотов (подбор порогов)
```

## Детерминизм и задокументированный недетерминизм

- `Math.random` в unit-тестах гасится подменой (`stubRandom`) — только в тестах,
  прод не трогается.
- `Date.now()`-зависимые поля сверяются дельтами (`endsAt - Date.now()`), а не
  абсолютными значениями.
- CLI `balance-sim.mjs` детерминирован (проверено: два прогона байт-идентичны).
- Прогон `ui-review.mjs`: stdout, console_errors.txt и все layout_audit*.txt
  байт-идентичны между прогонами. Скриншоты сравниваются pixel-diff с допуском:
  статичные сцены 0–0.6% (допуск ≤1% при tol=32); `02_clicks`/`03_buys` —
  случайные всплывающие цифры и частицы в кадре (допуск 10%); `18_map_anim_skip`
  стабилен при tol=16; `17_map_open` пиксельно недетерминирован (FX прибытия в
  кадре) — сравниваются только размеры. Пороги сняты приёмкой двух прогонов на
  одном коммите; на другой машине/версии Chromium их может потребоваться
  переснять (`tools/png_diff.mjs`).

## Перегенерация golden

Golden перегенерируется ТОЛЬКО при намеренном изменении поведения (после
ревью diff'а поведения):

```bash
node tests/characterization/tools/write_catalog_golden.mjs          # каталоги state.js
node scripts/data/balance-sim.mjs > tests/characterization/golden/balance-sim_default.out
node scripts/data/balance-sim.mjs 2 30 > tests/characterization/golden/balance-sim_cps2_h30.out
OUT_DIR=tests/characterization/golden/ui node scripts/gates/ui-review.mjs # UI-артефакты
```

(Для сравнения значений с текущим кодом есть `node
tests/characterization/tools/capture_goldens.mjs` — печатает тот же набор
чисел, что зашит в тестах.)

## Что покрыто

- **state.js** (главная точка рефакторинга): каталоги TIERS/UPGRADES/ARTIFACTS/
  ITEMS/CRAFT_RECIPES/DAILY_REWARDS/BOSSES/COMPONENTS/MUTATIONS (golden-снапшот),
  константы, fmt/fmtDuration (включая квирки `0.5 -> '0'`, `-0.5 -> '-0'`,
  `NaN -> '∞'`, `fmtDuration(-10) -> '-1 мин'`), формулы цен/доходов, якорь
  цены спуска (ленивая фиксация, пол UNLOCK_FLOOR, null на последнем тире),
  строгая мультипокупка x1/x10/x100/max, видимость улучшений (анонсы цепочек),
  unlockTier/forceNextTier, клик-роллы (крит/жила/синергия/мутации/бафы),
  боссы (HP/скорость/рекорды/kill-награда), крафт, предметы, дейли (серия/сброс/
  7 наград по кругу), престиж, офлайн, saveLastExit/readLastExit (цепочка
  фолбэков), сейв-формат и миграции v1..v5 (клампы, фильтрация мета, босс-файт,
  квирки: `dailyBuffMult` переживает истёкший баф, дробный уровень из сейва
  проходит, битый JSON в storage не сбрасывает состояние).
- **layout.js**: обе ветки computeLayout (ландшафт/портрет 390x844) — полные
  golden-объекты, клампы высоты портрета, квадрат -> ландшафт.
- **sdk-stub.js**: слоты setData/getData, legacy-миграция ключа, getStats/setStats.
- **sdk/yandex.js**: standalone-init (возвращает false + info-лог), no-op
  gameplay, showFullscreenAdv без SDK -> onClose(false); разводка колбэков
  onOpen/onClose/onError с фейковым SDK.
- **CLI**: scripts/data/balance-sim.mjs — stdout как golden (2 набора аргументов).
- **DOM-слой** (фазы 1–2): `src/state/settings.js` (clamp/сейв), тексты форм
  (`craftMessages`/`settingsMessages` — единый источник для обоих путей), снимки
  `bridge.js` (мутаторы не вызываются), каркас `modal.js`/`rangeInput`, флаг
  отката `formsFlag`; DOM-golden форм — в `golden/dom/` (гейт `test:dom-golden`).
- **UI-сценарии**: полный прогон scripts/gates/ui-review.mjs — 12 страниц/21 скриншот,
  9 layout-аудитов, console_errors (0), exit code; через него же покрыт
  boot-путь main.js (BootScene/GameScene/UIScene), карта, крафт, боссы, офлайн,
  портрет, viewport 900.

## Что не покрыто и почему

- **Скриншоты pixel-perfect**: `17_map_open` сравнивается только по размерам —
  в кадр попадает анимация прибытия на карте (FX/твин), пиксельная стабильность
  на этой сцене не достижима без правки прод-кода (тест-хук не потребовался).
- **Звук (sfx.js)**: `playSfx` требует AudioContext/загруженного кэша — в Node
  не запускается; поведение (троттлинг 70 мс, выбор варианта) не покрыто.
  Для проверки в браузере есть `scripts/verify/verify-sfx.cjs` (вне набора).
- **Scenes по кадрам**: сцены покрыты через ui-review-прогон (состояния/аудит/
  скриншоты), но не юнит-тестами по кадрам (Phaser требует DOM/WebGL в браузере).
- **verify-*.cjs**: существующие проверочные скрипты не завёрнуты в golden —
  это уже ассертивные проверки того же кода; их дубль удвоил бы время прогона
  без добавления точек наблюдения.
- **DevPanel** (`src/dev/DevPanel.js`): dev-only (import.meta.env.DEV), в
  production-ветке мёртв; покрывать отдельными тестами не нужно для рефакторинга
  игрового кода. Есть отдельный shots_devpanel/ воркфлоу.
- **Дробный уровень из сейва** (`sledge: 3.7`) и `dailyBuffMult` при истёкшем
  бафе зафиксированы КАК ЕСТЬ с пометкой may be a bug — намеренно, без исправления.

## Проверка на «ловимость» (DoD)

Намеренная правка поведения (OFFLINE_BASE_RATE 0.2 -> 0.21; LANDSCAPE_BASE
720 -> 721) ломала тесты, после чего правка была откачена. Любое изменение
экономики/раскладки/формата сейва/вывода CLI/вёрстки ловится набором.
