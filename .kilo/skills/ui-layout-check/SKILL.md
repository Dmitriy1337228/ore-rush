---
name: ui-layout-check
description: "Use when changing or reviewing any UI layout in this game: HUD, panels, rows, modals, map, craft, boss overlay, buttons, text sizes, adaptive/portrait layout. Runs the measurable layout audit (npm run ui:check), reads annotated screenshots and the report. Triggers on: вёрстка, layout, наезжает, перекрывается, отступы, кнопки, адаптив, портрет, ui:check."
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
5. Перед сдачей — полная матрица `npm run ui:check` и `npm run test:ui` (golden-регрессия) и `npm test`.
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
