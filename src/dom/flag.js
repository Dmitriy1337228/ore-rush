// Флаг D5: переключение реализации экрана. ?dom=1 в адресе или localStorage.domUi=1.
// Значение читают main.js (стенд) и UIScene (openCraft маршрут). В проде флаг не
// включается: UIScene монтирует DOM-слой только в DEV-сборке.
export function isDomUiEnabled() {
    try {
        const q = new URLSearchParams(window.location.search).get('dom');
        return q === '1' || localStorage.getItem('domUi') === '1';
    } catch (e) {
        return false;
    }
}
