# Реестр скиллов — .kilo/skills/INDEX.md

Назначение: тимлид перед брифингом сабагента сверяется с этим файлом и передаёт в prompt/board_post пути к 1–2 релевантным SKILL.md (при прямом совпадении с задачей). Если совпадения нет — не передавать ничего.

Роли: тимлид / архитектор / dev / тестировщик. «—» — скилл существует, но в этом проекте не применяется.

| Путь | Триггер / задача | Роли |
|---|---|---|
| .kilo/skills/phaser-actions-and-utilities/SKILL.md | выравнивание, grid-раскладка, пакетные операции над группой объектов | dev |
| .kilo/skills/phaser-animations/SKILL.md | спрайт-анимации: spritesheet, atlas, play/stop, кадры | dev |
| .kilo/skills/phaser-audio-and-sound/SKILL.md | звук и музыка: загрузка, громкость, mute, Web Audio | dev |
| .kilo/skills/phaser-cameras/SKILL.md | камеры: вьюпорты, несколько камер, скролл-клиппинг | dev |
| .kilo/skills/phaser-curves-and-paths/SKILL.md | кривые и пути: сплайны, безье, следование по пути | dev (редко) |
| .kilo/skills/phaser-data-manager/SKILL.md | данные на объектах: setData/getData, события данных | dev |
| .kilo/skills/phaser-events-system/SKILL.md | события: EventEmitter, scene/game events, подписки | dev |
| .kilo/skills/phaser-filters-and-postfx/SKILL.md | фильтры и пост-обработка: bloom, blur, glow, шейдеры | dev (редко) |
| .kilo/skills/phaser-game-object-components/SKILL.md | компоненты объектов: transform, tint, origin, depth, маски | dev |
| .kilo/skills/phaser-game-setup-and-config/SKILL.md | создание Phaser.Game, GameConfig, рендерер, FPS | архитектор, dev |
| .kilo/skills/phaser-geometry-and-math/SKILL.md | математика: Vector2, прямоугольники, углы, lerp, рандом | dev |
| .kilo/skills/phaser-graphics-and-shapes/SKILL.md | рисование фигур: Graphics, rect/circle/arc, градиенты | dev |
| .kilo/skills/phaser-groups-and-containers/SKILL.md | Group/Container: пулы объектов, вложенные трансформы | dev |
| .kilo/skills/phaser-input-keyboard-mouse-touch/SKILL.md | ввод: клавиатура, мышь, тач, драг, hit-области | dev |
| .kilo/skills/phaser-loading-assets/SKILL.md | загрузка ассетов: Loader, preload, спрайтшиты, прогресс | dev |
| .kilo/skills/phaser-particles/SKILL.md | частицы: эмиттеры, зоны, взрывы, дым | dev |
| .kilo/skills/phaser-physics-arcade/SKILL.md | аркадная физика: скорость, гравитация, коллизии | — |
| .kilo/skills/phaser-physics-matter/SKILL.md | физика Matter: тела, констрейнты, сенсоры | — |
| .kilo/skills/phaser-render-textures/SKILL.md | RenderTexture/DynamicTexture: рисование в текстуру | dev (редко) |
| .kilo/skills/phaser-scale-and-responsive/SKILL.md | адаптивность: ScaleManager, FIT/RESIZE, resize | dev |
| .kilo/skills/phaser-scenes/SKILL.md | сцены: жизненный цикл, переходы, коммуникация сцен | архитектор, dev |
| .kilo/skills/phaser-sprites-and-images/SKILL.md | спрайты/изображения: создание, позиция, tint, depth | dev |
| .kilo/skills/phaser-text-and-bitmaptext/SKILL.md | текст: Text/BitmapText, стили, word wrap, шрифты | dev |
| .kilo/skills/phaser-tilemaps/SKILL.md | тайлмапы: Tiled JSON, слои, коллизии тайлов | — |
| .kilo/skills/phaser-time-and-timers/SKILL.md | таймеры: delayedCall, циклы, Clock, time scale | dev |
| .kilo/skills/phaser-tweens/SKILL.md | твины: анимация свойств, easing, stagger, цепочки | dev |
| .kilo/skills/phaser-v3-to-v4-migration/SKILL.md | миграция Phaser 3→4, breaking changes API | — |
| .kilo/skills/phaser-v4-new-features/SKILL.md | новое в Phaser 4: фильтры, RenderNodes, тинты | архитектор, dev |
| .kilo/skills/spritecook-animate-assets/SKILL.md | анимация готовых SpriteCook-ассетов, motion-промпты | тимлид |
| .kilo/skills/spritecook-build-ui-kits/SKILL.md | UI-киты SpriteCook: концепт, шиты компонентов, финализация | тимлид |
| .kilo/skills/spritecook-generate-sprites/SKILL.md | генерация спрайтов: пиксель-арт/HD, модели, референсы | тимлид |
| .kilo/skills/spritecook-generate-tilesets/SKILL.md | генерация тайлсетов: autotile, размеры, edge-режимы | тимлид |
| .kilo/skills/spritecook-polish-sprites/SKILL.md | полировка спрайтов: обводка, ореолы, alpha-порог | тимлид |
| .kilo/skills/spritecook-upload-assets/SKILL.md | загрузка локальных картинок в SpriteCook через MCP | тимлид |
| .kilo/skills/spritecook-use-assets-in-godot/SKILL.md | SpriteCook-ассеты в Godot: SpriteFrames, экспорт | — |
| .kilo/skills/spritecook-use-dual-grid-tilesets/SKILL.md | dual-grid рендеринг 15-piece тайлсетов | — |
| .kilo/skills/spritecook-use-presets/SKILL.md | пресеты SpriteCook: поиск, применение, сохранение | тимлид |
| .kilo/skills/spritecook-workflow-essentials/SKILL.md | базовые правила SpriteCook: кредиты, манифест, дефолты | тимлид |
| .kilo/skills/refactoring-surgeon/SKILL.md | рефакторинг: code smell, техдолг, legacy, cleanup, extract method/class, DRY/SOLID (источник: NeverSight/learn-skills.dev; references/ и scripts/ из зеркала не поставляются) | dev, архитектор |
| .kilo/skills/code-review-skill/SKILL.md | ревью кода: 4-фазный процесс, severity-метки (blocking/important/nit/…), security/performance/архитектура; справочники по языкам в reference/ (источник: awesome-skills/code-review-skill, MIT). Локальное дополнение: обязательная по-коммитная проверка реорганизационных/массовых веток и сверка журнала | тимлид, dev, архитектор |
| .kilo/skills/ui-layout-check/SKILL.md | ЛЮБАЯ правка/ревью вёрстки UI: HUD, панели, ряды, модалки, карта, мастерская, кнопки, кегли, адаптив/портрет; наезды текста, отступы, `npm run ui:check` | dev, тестировщик, тимлид, ui |

Примечания:
- SpriteCook-скиллы назначаются только тимлиду: MCP-сервер spritecook подключён к основной сессии, у сабагентов этих инструментов нет.
- Скиллы с ролями «—» в реестре оставлены для полноты (официальный набор), в командные брифы не передаются.
