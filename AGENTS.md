# AGENTS.md — инструкции для агента

## Командный режим (включается ТОЛЬКО по явному указанию игрока)
Триггеры: слэш-команда `/team <задача>` или прямая фраза игрока («собери команду: …», «режим команды», «командой …»). В этом случае следуй плейбуку `.kilo/command/team.md`: тимлид — основной агент (GLM-5.3-Flash), архитектор `team-architect` (DeepSeek V4 Pro), разработчик `team-dev` (GLM-5.3-Flash), ревьювер `team-reviewer` (DeepSeek V4 Pro; Claude Sonnet 5.5 — только по триггерам через override тимлида), тестировщик `team-tester` и разведчик `team-scout` (DeepSeek V4.1 Flash), менеджер памяти `team-memory` (GLM-5.3-Flash); провайдер всюду openrouter, модели зафиксированы в .kilo/agent/team-*.md. Координация — через общую доску (board_post/board_read) с зеркалом для игрока в .kilo/team-board.md, долговременная память команды — .kilo/team-memory.md. Во всех остальных случаях — обычный одиночный режим: команду не поднимать и работу не делегировать.

## Стиль коммитов (Conventional Commits — обязательный стандарт)
- Каждый коммит оформляй строго по Conventional Commits: `тип(скоуп): краткое описание` — тип маленькими буквами, описание с маленькой буквы без точки в конце, в настоящем времени.
- Типы: `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `style`, `build`, `ci`; скоуп — по затронутой зоне проекта (`boss`, `ui`, `daily`, `mutation`, `balance`, `craft`, `team`, `game-design`).
- Тело коммита (через пустую строку после темы) — что и зачем изменено, если изменение не самоочевидно из темы.
- История проекта уже переписана под этот стандарт; перезапись истории впредь — только с предварительными бекап-ветками и `git bundle`, push переписанной истории — только `--force-with-lease` и по явному указанию игрока.

## Стиль кода (Prettier + ESLint — обязательный гейт)
- Форматирование — Prettier (`.prettierrc`), линт — ESLint flat-конфиг (`eslint.config.js`): только стилистические правила (`curly: all`, пустая строка перед `return` и после `if/for/while`), без смысловых `no-*`.
- Команды: `npm run format`, `npm run format:check`, `npm run lint`, `npm run lint:fix`. Охват — `src/`, `scripts/`, `tests/` (`*.js/*.mjs/*.cjs`) и `vite.config.js`. Не форматируются: `docs/`, `shots/`, `dist/`, `assets/`, `.kilo/`, `*.css` (в т.ч. генерируемый `src/ui/dom/tokens.css`), `*.html`, `*.md`, `*.json` (в т.ч. `tests/ui-check/baseline.json`), golden и `*.out` — защита в `.prettierignore` и `ignores` ESLint.
- Перед сдачей любой правки кода — `npm run format:check` и `npm run lint` с кодом 0; обе команды входят в «полный набор гейтов» вместе с `npm test`, `npm run test:ui`, токен-гейтами и `npm run build`.
- pre-commit (husky + lint-staged) прогоняет `prettier --write` и `eslint --fix` на staged-файлах: красный стиль не попадёт в коммит; обход — только осознанно (`git commit --no-verify`).
- `embeddedLanguageFormatting: "off"`: HTML-шаблоны внутри шаблонных литералов Prettier не переформатирует (иначе меняется разметка DOM и расходится dist-бандл).
- Комментарии: обоснования голых чисел обязательны (`ui:tokens`); боковой `//` допустимо переносить на строку над стейтментом, но не удалять; новые боковые комментарии не добавлять.
- `git blame` без шума стиля: `git config blame.ignoreRevsFile .git-blame-ignore-revs` (хэши механических коммитов — в файле).

## UI-правки: измеримая проверка вёрстки (обязательный гейт)
- Любая правка вёрстки (координаты, размеры, кегли, подписи, новые экраны/кнопки, адаптив) считается готовой только после `npm run ui:check:quick` (0 НОВЫХ ошибок и предупреждений в затронутых экранах) и осмотра размеченных PNG из `shots/ui-check/`; перед сдачей — полный `npm run ui:check`, `npm run test:ui`, `npm test`, `npm run format:check`, `npm run lint`. Подробности — `docs/UI_LAYOUT.md`, скилл `.kilo/skills/ui-layout-check/SKILL.md`.
- Нельзя «лечить проверку»: не добавлять новые нарушения в `tests/ui-check/baseline.json`, не ослаблять `UI_RULES` (`src/dev/uiAudit.js`) и не скрывать объекты ради зелёного прогона. Закрыли долг — `--update-baseline` и в сообщении коммита указать, на сколько долг уменьшился.
- Новый экран/модалка = новое состояние в `scripts/lib/ui-matrix.mjs`.
- Если игрок прислал `ui-report-*.json` (F9 в dev-сборке) — сначала воспроизвести: `npm run ui:check -- --replay <файл>`.
- Новые «голые» числа раскладки не плодить: константы/токены (`src/ui/shared/theme.js`, `src/ui/shared/listGeometry.js`, `src/game/*Layout.js`). Кегли в `src/ui/phaser` — только токены `FONT_SIZE`: `npm run ui:tokens` должен завершаться без нарушений (исключение — файлы раскладок). План системного лечения — `docs/UI_LAYOUT_TODO.md`.

## Токены отступов и размеров (системное правило — действует во всех диалогах)
- Открывая любой код UI, агент не должен видеть «чисел с потолка»: отступ/размер выражается
  токеном (`FONT_SIZE.*`, `SPACE.*`, `HIT.*`) или спекой раскладки (`src/layout.js`:
  `L.<экран>.*` с коэффициентами ориентации). Адаптивность — из коробки в layout.js:
  сцены НЕ умножают на масштаб и НЕ знают про вьюпорт, читают готовые числа из `L.*`.
- Явно обоснованное голое число допускается только со стоящим рядом комментарием
  «что это и зачем» (пропорции текстуры, врезка панели и т.п.). Комментарий «на глаз»
  = то же нарушение. В `src/layout.js` (и `*Layout.js`) голые числа легальны — это
  единственный источник раскладки.
- `ui:tokens` проверяет кегли И отступы/размеры: голый литерал в sizing-вызовах
  (`setPosition/setDisplaySize/setSize/fillRect/fillRoundedRect/Rectangle/...`) в
  `src/ui/phaser` без соседнего комментария — нарушение.
- Любая правка экрана проверяется минимум в двух вьюпортах: десктоп (1280x720) и
  мобилка (390x844) — скриншоты прикладываются к апруву вместе с аудитом.

## DOM-слой UI (`src/ui/dom/` — мастерская и настройки с G3 = go / фазы 2)
- Мастерская и **настройки** собираются в `src/ui/dom/` и включены по умолчанию в проде и dev. Контроллеры грузятся чанками при старте UIScene (`openCraft()`/`openModal()` ждут готовности); настройки монтируются после мастерской (она пересобирает `#ui-root`).
- Статус-модалки (офлайн/дейли/босс/вырубление, `src/ui/dom/statusModals.js`) и список улучшений (`src/ui/dom/upgradesPanel.js`) тоже на DOM по умолчанию (фаза 3). Откат любой формы на Phaser-путь: `?phaserForms=settings,status,upgrades` или `localStorage.phaserForms` (`src/ui/shared/formsFlag.js`, `DEFAULT_PHASER_FORMS`). Тексты статуса/списка — `src/state/statusMessages.js`, `src/state/upgradesMessages.js` (Phaser-путь берёт те же строки, литералов в обоих путях нет); геометрия ряда списка — `src/ui/shared/listGeometry.js` (общая для Phaser и DOM).
- Размеры — только токены: `npm run dom:tokens` генерирует `src/ui/dom/tokens.css` из `src/ui/shared/theme.js`; дрейф — `npm run dom:tokens -- --check`; голые `px/rem/em` вне `tokens.css` запрещены (`npm run ui:tokens:css`, 1px — только с комментарием-причиной).
- Гейты: `npm run ui:check:dom [-- --form craft|settings|all]` (8 вьюпортов, PNG `shots/ui-check/<vp>__<form>-dom.png`) и `npm run test:dom-golden [-- --form …]` (tolerant-diff, порог 0.5 %); приёмки — `npm run verify:craft-dom`, `npm run verify:settings-dom`. **Полный UI-прогон = `npm run ui:check` + `npm run ui:check:dom`** + `npm test`, `npm run test:ui`, `npm run format:check`, `npm run lint`.
- Бизнес-правила и запись состояния — только в `src/state.js`/`src/state/*`; `src/ui/dom/*` читает через `bridge.js`, тексты — `src/state/craftMessages.js`, `src/state/settingsMessages.js` (без копий).
- Фикстуры и стенды (`fixtures*.js`, `lab.js`, `scripts/stands/build-dom-*.mjs`) — не прод-код; для проверки на телефоне без сети: `npm run stand:craft-phone -- --form craft|settings` → `shots/pilot-gates/dom-<form>-phone.html` / `dom-lab.html`.
- Дальше на DOM — только новые формы; HUD/бой/босс/шахта/обучение/снаряжение/карта остаются в Phaser (`docs/DECISIONS.md` №1, №4).

## Структура `src/` (куда класть новое)
- Новая механика — `src/game/*` (сцены/подсистемы) + правила и запись состояния в `src/state.js`; `src/state/` — только чистые подсистемы.
- Новый экран/форма на DOM — `src/ui/dom/`; новый HUD/оверлей на Phaser — `src/ui/phaser/`.
- Общее для обоих стеков и **без** импортов Phaser/DOM — `src/ui/shared/` (`theme.js`, `iconMetrics.js`, `listGeometry.js`).
- `src/ui/UIScene.js` — хост слоёв (может тянуть и `phaser/`, и `dom/` динамически); `src/main.js` — точка входа.
- Второго `ui` вне `src/ui` быть не должно: `src/scenes/ui` и `src/scenes/game` запрещены (`src/scenes/` — только `BootScene.js`).
- Гард слоёв — `npm run layers:check`: `ui/dom` не импортирует Phaser, `ui/phaser` — DOM, `ui/shared` — ни то, ни другое, `game` — не импортирует DOM; dev-фикстуры `src/ui/dom/dev/` не тянутся прод-кодом.

## Скрипты `scripts/` (индекс и алиасы — обязательное правило)
- Каждый скрипт запускается по **npm-алиасу** (`verify:boss`, `metrics:p95`, …), а не по пути: индекс — `scripts/README.md`, гард — `npm run scripts:check` (алиас + строка в README + файл существует).
- Новый скрипт — сразу в целевую папку (`gates|verify|metrics|stands|audio|data`), с алиасом в `package.json` и строкой в `scripts/README.md`; `scripts/lib/` — библиотеки без алиасов, `scripts/archive/` — снятые с эксплуатации (вне гардов).
- Триаж и внешний долг падающих проверок — `docs/repo-reorg/REPO_REFACTOR_BASELINE.md`; падающий скрипт не «лечат» правкой ожиданий.

## Скиллы (.kilo/skills)
- Перед началом задачи сверься с реестром `.kilo/skills/INDEX.md` (если файл существует).
- Если под задачу есть прямое совпадение по триггеру — прочитай 1–2 релевантных файла из `.kilo/skills/` до начала планирования или правок.
- Если подходящего скилла нет — не читай лишние файлы и сразу переходи к задаче.
- В командном режиме (`/team`) сабагенты читают только те скиллы, которые явно передал тимлид в брифинге (или совпавшие по их узкой роли в `INDEX.md`).
- В финальном ответе/отчёте укажи `Skills: <файлы>` только если скиллы реально применялись.

## Решения владельца (docs/DECISIONS.md)
- Перед стартом любой задачи проверь `docs/DECISIONS.md` — там действующие решения владельца (HUD остаётся в Phaser; временные гейты/релизные окна отменены и т.п.). Задача, противоречащая решению, не начинается — расхождение выносится владельцу.
