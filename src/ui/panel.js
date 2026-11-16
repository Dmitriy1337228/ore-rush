// Окно на базе modal_panel (docs/UI_LAYOUT_TODO.md, раздел 2, пункт 2): фон-врезка
// + заголовок + опциональный крестик закрытия + contentRect. Заменяет ручную сборку
// addImgC(панель) + makeLabel(заголовок) + addImgC(крестик) + setHitRect, которая
// повторялась в createAlertShell и окнах настроек/карты/мастерской.
// Возвращает { panel, title, close, contentRect }:
//   panel/title/close — ссылки; позиции двигает applyLayout экрана (в портрете
//   заголовок/крестик переезжают), поэтому компонент владеет только созданием;
//   close — крестик или null (у алертов крестика нет — закрытие кнопкой OK);
//   contentRect(insets) — внутренняя область врезки в контейнерных координатах
//   (origin 0.5) от ТЕКУЩЕГО размера фона: { x, y, w, h }; caller переводит в
//   мировые (x + modal.cx) для камер-скроллов.
import { addImgC, setHitWorld, makeLabel } from './uiKit.js';
import { TEXT, TEX } from './theme.js';

export function createPanel(
    scene,
    {
        w,
        h,
        title,
        titleY,
        titleSize,
        titleColor = TEXT.cream,
        close = null // { x, y, size = 44, onClose } — крестик в правом верхнем углу
    } = {}
) {
    const panel = addImgC(scene, 0, 0, TEX.modalPanel, w, h);
    const titleLabel = makeLabel(scene, 0, titleY, title, titleSize, titleColor).setOrigin(0.5);
    let closeBtn = null;
    if (close) {
        const size = close.size || 44;
        closeBtn = addImgC(scene, close.x, close.y, TEX.closeButton, size, size);
        // Хит 80x80 мировых px (крестик 44-64 видимых — на телефонах меньше
        // 40 CSS px): enlargement сверх границ, соседние интерактивные далеко
        setHitWorld(closeBtn, 80, 80);
        if (close.onClose) {
            closeBtn.on('pointerdown', close.onClose);
        }
    }

    return {
        panel,
        title: titleLabel,
        close: closeBtn,
        contentRect({ left = 0, right = 0, top = 0, bottom = 0 } = {}) {
            const cw = panel.displayWidth;
            const ch = panel.displayHeight;

            return {
                x: -cw / 2 + left,
                y: -ch / 2 + top,
                w: cw - left - right,
                h: ch - top - bottom
            };
        }
    };
}
