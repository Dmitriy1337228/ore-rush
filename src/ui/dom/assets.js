// Путь к ассету UI: в dev и prod картинки лежат по относительному пути assets/ui/<key>.png.
// Живёт в прод-коде слоя: раньше helper лежал в фикстурах (dev), из-за чего продовые
// components.js тянули dev-модуль — с переездом в ui/dom/dev это нарушило правило слоёв.
export const assetUrl = (key) => `assets/ui/${key}.png`;
