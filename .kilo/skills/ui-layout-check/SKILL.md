---
name: ui-layout-check
description: "Use when changing or reviewing any UI layout in this game: HUD, panels, rows, modals, map, craft, boss overlay, buttons, text sizes, adaptive/portrait layout, DOM-слой (src/dom). Runs the measurable layout audit (npm run ui:check / ui:check:dom), reads annotated screenshots and the report. Triggers on: вёрстка, layout, наезжает, перекрывается, отступы, кнопки, адаптив, портрет, ui:check, DOM-слой, src/dom."
---

# UI layout check

Любая правка вёрстки (координаты, размеры, кегли, тексты в UI, новые экраны/кнопки) проверяется
измеримо, а не «на глаз». Полное описание — `docs/UI_LAYOUT.md`.

## Обязательный цикл
1. До правки (если не знаете состояние): `npm run ui:check:quick` — зафиксируйте, что новых нарушений 0.
2. Правка кода.
3. `npm run ui:check:quick` (или точечно `-- --viewports p390,d1280 --states <экран>`).
   Нужно: **0 новых ошибок** (error) и 0 новых предупреждений (warn) в затронутом экране.
4. Открыть размеченные PNG из `shots/ui-check/` (имя из отчёта) и убедиться глазами, что рамки
   соответствуют реальной проблеме / проблем не осталось.
5. Перед сдачей — полная матрица `npm run ui:check` и `npm run test:ui` (golden-регрессия), `npm test`,
   `npm run format:check` и `npm run lint` (стиль-гейты; см. `AGENTS.md`, раздел «Стиль кода»).
   Если картинка изменилась осознанно — golden обновляет только человек/тимлид с явным «ок».

## Правила работы
- Не лечите проверку: не добавляйте нарушения в `tests/ui-check/baseline.json`, не повышайте
  пороги `UI_RULES`, не прячьте объекты ради зелёного прогона. Исправляйте вёрстку.
- Исправили долг — `--update-baseline` и укажите, на сколько долг уменьшился.
- Новый экран/модалка/состояние → добавить состояние в `scripts/lib/ui-matrix.mjs`.
- Состояние для проверки с ошибкой от пользователя: `npm run ui:check -- --replay <ui-report-*.json>`
  (файл скачивается клавишей F9 в dev-сборке; F8 — живое наложение нарушений).
- Числа раскладки — константами/токенами, не «на месте» (см. `docs/UI_LAYOUT_TODO.md`).
- Прод-код аудита не содержит: `src/dev/uiAudit.js` подключается только под `import.meta.env.DEV`.

## Как читать отчёт
`report.md` / консоль: `ERR|warn <viewport>|<state> #N RULE: сообщение -> файл.png`.
`#N` — номер рамки на PNG (красная — ошибка, оранжевая — предупреждение, приглушённая — известный долг).
Правила: OVERLAP, OVERFLOW, TEXT-COVERED, OFFSCREEN, MIN-FONT, ROW-NAME, PADDING, TOUCH-TARGET,
BUTTON-GAP, MISALIGNED, EDGE (таблица в `docs/UI_LAYOUT.md`).

## DOM-слой (`src/dom`, экран мастерской — по умолчанию в проде и dev)

С пилота DOM (G3 = go) мастерская живёт в `src/dom/*`, Phaser-экран удалён. Для правок действует дополнительный цикл:

1. Размеры — **только токены**: `npm run dom:tokens` (генерация из `src/ui/shared/theme.js`),
   `npm run dom:tokens -- --check` (дрейф), `npm run ui:tokens:css` (голые px/rem/em вне
   `tokens.css` запрещены; 1px — только с комментарием-причиной).
2. `npm run ui:check:dom` — 7 вьюпортов × 26 рядов, `getBoundingClientRect`, пороги `UI_RULES`;
   скриншоты `shots/ui-check/<vp>__craft-dom.png`, отчёт `shots/ui-check-dom/report.json`.
3. `npm run test:dom-golden` — tolerant-diff эталона DOM-панели (порог 0.5%, константы в скрипте);
   обновление эталона — только с явным «ок».
4. Полный прогон UI = `npm run ui:check` **и** `npm run ui:check:dom`; плюс `npm test`, `test:ui`,
   `npm run format:check`, `npm run lint`.
5. Бизнес-правила — только в `src/state.js`, тексты ошибок — `src/state/craftMessages.js`;
   `src/dom/*` не пишет в `gameState`, только читает через `bridge.js`.
6. Фикстуры/стенды (`fixtures*.js`, `lab.js`, `build-dom-*.mjs`) — не прод-код и вне метрики LOC.
