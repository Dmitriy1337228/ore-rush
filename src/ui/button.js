// Кнопка как единый компонент (docs/UI_LAYOUT_TODO.md, раздел 2): фон-девятка +
// подпись по центру + hit-area + авто-ужим подписи под ширину. Заменяет пачку
// addNineC + setHitRect + makeLabel (+ fitFontSize), повторявшуюся 30+ раз.
// Возвращает ссылки { bg, label } — раскладки продолжают работать с ними как
// раньше (bg.setTexture для вкл/выкл, label.setText/setFontSize/setColor),
// порядок объектов в контейнере сохраняется вызывной стороной.
import { addNineC, setHitRect, makeLabel, fitFontSize } from './uiKit.js';

export function addButton(scene, x, y, {
    w, h,              // размер фона; по умолчанию также размер hit-area
    key,               // текстура фона (TEX.button / TEX.buttonDisabled)
    text = '',         // подпись по центру (origin 0.5, как у прежних кнопок)
    fontSize,          // кегль подписи (токен FONT_SIZE или масштабированная база)
    color,
    style = {},        // доп. стиль makeLabel (align, wordWrap и пр.)
    fitMaxW = null,    // ширина для авто-ужима подписи (null — не ужинать)
    fitMin,            // нижний порог ужина (по умолчанию 9 из uiKit)
    hitW = w,          // hit-area — те же числа, что ставил вызывной setHitRect
    hitH = h,
    hitCentered = false
} = {}) {
    const bg = addNineC(scene, x, y, key, w, h);
    setHitRect(bg, hitW, hitH, hitCentered);
    const label = makeLabel(scene, x, y, text, fontSize, color, style).setOrigin(0.5);
    if (fitMaxW !== null) fitFontSize(label, fontSize, fitMaxW, fitMin);
    return { bg, label };
}
