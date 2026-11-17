# Индекс скриптов `scripts/`

Единая точка входа: **алиас npm** (стабильное имя, не зависит от папки). Гард
`npm run scripts:check` проверяет три правила (D8 в `docs/repo-reorg/REPO_REFACTOR_PLAN.md`):

1. у каждого файла `scripts/**/*` (кроме `lib/`, `archive/`, `README.md`) есть npm-алиас;
2. каждый такой файл упомянут строкой в этой таблице;
3. каждый алиас, ссылающийся на `scripts/**`, указывает на существующий файл.

Правила для новых скриптов: сразу в целевую папку (`gates|verify|metrics|stands|audio|data`),
алиас в `package.json` и строка в таблице. `scripts/lib/` — библиотеки без алиасов.
`scripts/archive/` — снятые с эксплуатации, вне гардов и алиасов (файлы не удаляются).

## Таблица

| Скрипт | Назначение | Алиас | Категория | Браузер/dev-сервер | Статус |
|---|---|---|---|---|---|
| `scripts/gates/ui-check.mjs` | Матрица вьюпортов × состояний, аудит вёрстки Phaser, размеченные PNG, baseline долга | `ui:check`, `ui:check:quick` | гейт | да | активен |
| `scripts/gates/ui-check-dom.mjs` | DOM-аудит вёрстки форм (`--form`, 8 вьюпортов; H-SCROLL, TOUCH, MIN-FONT, PADDING) | `ui:check:dom` | гейт | да | активен |
| `scripts/gates/ui-review.mjs` | Golden-обзор состояний игры (скриншоты + текстовые артефакты) | `ui:review` | гейт | да | активен |
| `scripts/gates/ui-tokens.mjs` | Нет голых кеглей/отступов в `src/scenes/ui` | `ui:tokens` | гейт | нет | активен |
| `scripts/gates/ui-tokens-css.mjs` | Нет голых px/rem/em вне `tokens.css` в DOM-слое | `ui:tokens:css` | гейт | нет | активен |
| `scripts/gates/gen-dom-tokens.mjs` | Генерация `src/ui/dom/tokens.css` из `src/ui/shared/theme.js` (`--check` — дрейф) | `dom:tokens` | гейт | нет | активен |
| `scripts/gates/dom-golden.mjs` | Tolerant-diff эталона DOM-панели (порог 0.5 %) | `test:dom-golden` | гейт | да | активен |
| `scripts/gates/check-scripts-index.mjs` | Гард индекса скриптов (алиасы + README + существование файлов) | `scripts:check` | гейт | нет | активен |
| `scripts/gates/check-layers.mjs` | Гард слоёв: ui/dom не тянет Phaser, ui/phaser не тянет DOM, shared и game изолированы, dev-фикстуры вне прода | `layers:check` | гейт | нет | активен |
| `scripts/verify/verify-bg.cjs` | Фоны локаций: 12 пиксель-арт фонов, кроссфейд, сброс | `verify:bg` | verify | да | активен |
| `scripts/verify/verify-boss.cjs` | Боссы: старт с карты, HP, клик-килл, награда, артефакт, робо-рука | `verify:boss` | verify | да | активен |
| `scripts/verify/verify-bulkbuy.cjs` | Мультипокупка x1/x10/x100/max: экономика и UI | `verify:bulkbuy` | verify | да | активен |
| `scripts/verify/verify-craft-dom.mjs` | Приёмка DOM-мастерской: открытие/закрытие, блокировка, мост, слои | `verify:craft-dom` | verify | да | активен |
| `scripts/verify/verify-settings-dom.mjs` | Приёмка DOM-настроек (ST1–ST14): тумблеры, громкость, престиж/сброс, очередь, блокировка | `verify:settings-dom` | verify | да | активен |
| `scripts/verify/verify-daily.mjs` | Ежедневные награды: цикл, серия, бафы, DevPanel, модалка | `verify:daily` | verify | да | активен |
| `scripts/verify/verify-devpanel.cjs` | DevPanel: активация, ресурсы, тиры, офлайн-симуляция, сброс | `verify:devpanel` | verify | да | активен |
| `scripts/archive/verify-economy.mjs` | Экономика (node): 12 тиров, цена спуска, гейты, миграции v2→v4 | — | архив | нет | архив: полностью покрыт unit-тестами `state_economy`/`state_persist`; удалить после квартальной ревизии, если не понадобился |
| `scripts/verify/verify-map.cjs` | Карта шахты: круги статусов, тропа, лок/разлок, спуск, очередь daily | `verify:map` | verify | да | активен |
| `scripts/archive/verify-mine-meta.mjs` | Мета (node): каталоги, сейв v5, миграции, бафы, крафт, престиж | — | архив | нет | архив: покрыт unit-тестами `state_meta`; удалить после квартальной ревизии, если не понадобился |
| `scripts/verify/verify-mutations.cjs` | Мутации блока: таймер, радуга/заморозка/взрыв/заряд, DevPanel | `verify:mutations` | verify | да | активен |
| `scripts/verify/verify-offline.cjs` | Реальный возврат во вкладку (visibilitychange), офлайн-награда | `verify:offline` | verify | да | активен |
| `scripts/verify/verify-rebalance.cjs` | Пересчёт цен в UI без перезагрузки сцены | `verify:rebalance` | verify | да | активен |
| `scripts/verify/verify-responsive.cjs` | Адаптив: две базовые сетки, смена ориентации, UI в портрете | `verify:responsive` | verify | да | активен |
| `scripts/verify/verify-robotarm.cjs` | Робо-рука: авто-клики дают доход и разрушают блок | `verify:robotarm` | verify | да | активен |
| `scripts/verify/verify-sfx.cjs` | Звуки: ключи из `assets/audio`, воспроизведение, клики/покупка | `verify:sfx` | verify | да | активен |
| `scripts/metrics/pilot-frame-p95.mjs` | p95 времени кадра при открытой мастерской (Phaser и DOM) | `metrics:p95` | метрика | да | активен |
| `scripts/metrics/pilot-loc.mjs` | Метрика «экран целиком»: строки кода по явному списку файлов | `metrics:loc` | метрика | нет | активен |
| `scripts/metrics/phase2-fixcount.mjs` | Пересчёт «чистых» fix-коммитов по формам для гейта GA (фаза 2) | `metrics:fixcount` | метрика | нет | активен |
| `scripts/metrics/gzip-size.mjs` | Вес бандла единым методом: gzip (zlib level 9) всех `dist/assets/*.js|*.css` | `metrics:gzip` | метрика | нет | активен |
| `scripts/metrics/pilot-layers-check.mjs` | Порядок слоёв DOM и Phaser (DOM над канвасом) | `metrics:layers` | метрика | да | активен |
| `scripts/archive/pilot-dom-input-check.mjs` | Ввод через DOM-слой: клик в шахту, клик по панели, драг | — | архив | да | архив: пилот завершён (G3 = go), блокировка под панелью покрыта `verify:craft-dom`; удалить после квартальной ревизии |
| `scripts/archive/pilot-dpr-shots.mjs` | Шрифт/рамки на DPR 1…3 (CSS px не «плывут») | — | архив | да | архив: разовый замер пилота, ассертов нет; вернуть из истории при смене шрифтов |
| `scripts/metrics/pilot-baseline-shots.mjs` | Чистые скриншоты мастерской на наборе вьюпортов → `docs/dom-pilot/baseline/` | `metrics:baseline-shots` | метрика | да | активен |
| `scripts/stands/build-dom-lab.mjs` | Автономный стенд DOM-панели (один HTML, без сети) | `stand:dom-lab` | стенд | нет | активен |
| `scripts/stands/build-dom-form-snapshot.mjs` | Автономный снимок DOM-формы для телефона (`--form craft|settings`) | `stand:craft-phone` | стенд | нет | активен |
| `scripts/data/balance-sim.mjs` | Симулятор баланса на реальной экономике `src/state.js` | `balance:sim` | данные | нет | активен |
| `scripts/audio/gen_bgm.py` | Генерация BGM-кандидатов в `audio-src/` (нужен venv audio-studio) | `audio:bgm` | аудио | нет | активен |
| `scripts/audio/gen_sfx.py` | Генерация SFX через audio-studio MCP → `assets/audio/` | `audio:sfx` | аудио | нет | активен |
| `scripts/audio/synth_sfx.py` | Детерминированный синтез SFX (`*_1/2.ogg+mp3`) | `audio:synth` | аудио | нет | активен |
| `scripts/audio/trim_sfx.py` | Тримминг/нормализация SFX | `audio:trim` | аудио | нет | активен |

`scripts/lib/`: `dev-server.cjs` (подъём/гашение dev-сервера для гейтов) и
`ui-matrix.mjs` (вьюпорты и состояния матрицы `ui:check`) — библиотеки, алиасов не требуют.

## Карта переезда (этап 2 плана)

| Было (до реорганизации) | Стало |
|---|---|
| `scripts/ui-check.mjs`, `ui-check-dom.mjs`, `ui-review.mjs`, `ui-tokens.mjs`, `ui-tokens-css.mjs`, `gen-dom-tokens.mjs`, `dom-golden.mjs`, `check-scripts-index.mjs` | `scripts/gates/…` |
| `scripts/verify-bg.cjs`, `verify-boss.cjs`, `verify-bulkbuy.cjs`, `verify-craft-dom.mjs`, `verify-daily.mjs`, `verify-devpanel.cjs`, `verify-map.cjs`, `verify-mutations.cjs`, `verify-offline.cjs`, `verify-rebalance.cjs`, `verify-responsive.cjs`, `verify-robotarm.cjs`, `verify-sfx.cjs` | `scripts/verify/…` |
| `scripts/pilot-frame-p95.mjs`, `pilot-loc.mjs`, `pilot-layers-check.mjs`, `pilot-baseline-shots.mjs` | `scripts/metrics/…` |
| `scripts/build-dom-lab.mjs`, `build-dom-craft-snapshot.mjs` | `scripts/stands/…` |
| `scripts/gen_bgm.py`, `gen_sfx.py`, `synth_sfx.py`, `trim_sfx.py` | `scripts/audio/…` |
| `scripts/balance-sim.mjs` | `scripts/data/…` |
| `scripts/verify-economy.mjs`, `verify-mine-meta.mjs`, `pilot-dom-input-check.mjs`, `pilot-dpr-shots.mjs` | `scripts/archive/…` (сняты с эксплуатации, D4) |
| `scripts/lib/*` | `scripts/lib/*` (без смены) |
