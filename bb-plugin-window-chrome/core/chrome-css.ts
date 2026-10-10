// Window Chrome, ядро: таблица стилей, которая убирает строку заголовка
// десктопного bb и разносит её кнопки по углам острова. Чистая функция без
// эффектов: content-скрипт только кладёт её результат в <head>.
//
// Почему стили, а не перенос узлов. Кнопки — React-узлы bb: перенос в чужого
// родителя ломает их при следующем рендере. Фиксированное положение оставляет
// узлы на месте, а CSS сам применяется к каждому новому узлу без наблюдателя.
//
// Разметка bb — не API (bb 0.46): якоря ниже сняты с живого десктопа. Всё
// привязано к корню с `data-framed` — он есть только в десктопной раскладке с
// островом, поэтому браузерный и телефонный вид bb правило не задевает.

/** Отступ острова сверху в полноэкранном окне, px. */
const TOP_FULLSCREEN_PX = 4;
/** Отступ острова сверху в обычном окне, px: под ним светофор macOS. */
const TOP_WINDOWED_PX = 48;
/** Отступ острова справа и снизу, px. */
const LIP_PX = 4;
/** Фон за островом. */
const BACKDROP = "#000000";
/** Высота нижнего ряда панели тредов bb, px: p-2 вокруг меню в 32 px. */
const FOOTER_ROW_PX = 48;
/** Зазор между строками тредов внутри проекта в панели тредов bb (--bb-sidebar-sticky-child-row-gap). */
const RAIL_GAP = "0.125rem";

const ROOT = `[data-testid="app-layout-root"][data-framed]`;
const TITLE_BAR_ID = `[data-testid="app-window-title-bar"]`;
const TITLE_BAR = `[data-framed] > ${TITLE_BAR_ID}`;
// Полоса заголовка bb держит класс отступа под светофор только в обычном окне;
// в полноэкранном — pl-[12px].
const WINDOWED = `${ROOT}:has(> ${TITLE_BAR_ID}.pl-\\[84px\\])`;
const COLLAPSED = `[data-framed]:has(> [data-state="collapsed"])`;
// Кнопки правой панели нет вовсе, когда панель не зарегистрирована, — тогда и места под неё не нужно.
const RIGHT_PANEL_CLOSED = `[data-framed]:has([data-testid="window-right-panel-toggle"][aria-expanded="false"])`;
// Группа назад/вперёд узнаётся по подсказкам горячих клавиш, а не по английской подписи кнопки.
const BACK_FORWARD_GROUP = `:has(> [data-sidebar-history-shortcut-hints])`;
const SIDEBAR_TOP_ROW = `[data-framed] [data-testid="app-sidebar-top-reserve-row"]`;
const ANY_SIDEBAR_TOP_ROW = `[data-framed] [data-testid$="-sidebar-top-reserve-row"]`;
const PAGE_HEADER_ROW = `[data-testid="app-page-header-content-row"]`;
const PANEL_HEADER_ROW = `[data-framed] [data-testid="thread-secondary-panel-top-chrome"]`;
const BACK_FORWARD = `${TITLE_BAR} > ${BACK_FORWARD_GROUP}`;

const rule = (selector: string, declarations: readonly string[]): string =>
  `${selector} {\n${declarations.map((d) => `  ${d};`).join("\n")}\n}`;

/** Вся таблица: поля острова, чёрный фон, кнопки заголовка в углах острова, одна ось у верхнего и нижнего ряда. */
export function windowChromeCss(): string {
  return [
    rule(ROOT, [
      `--wc-top: ${TOP_FULLSCREEN_PX}px`,
      `--wc-lip: ${LIP_PX}px`,
      // Ширина рейки слева с её рамкой в 1 px — формула bb для --sidebar-rail-width,
      // которую с полосы заголовка не прочитать: она задана на самой панели.
      `--wc-rail: calc(var(--bb-sidebar-control-size) + 24px + 1px)`,
      `--wc-button: 28px`,
      `--wc-gap: 4px`,
      `--wc-inset: 8px`,
      // Шаг между кнопками шапки bb (md:gap-2) и её боковой отступ (px-4).
      `--wc-header-gap: 0.5rem`,
      `--wc-header-pad: 1rem`,
      // Ось верхнего ряда — середина первой строки острова под его рамкой в 1 px.
      `--wc-control-top: calc(var(--wc-top) + 1px + (var(--bb-app-chrome-row-height) - var(--wc-button)) / 2)`,
      `--bb-window-frame-lip: var(--wc-lip)`,
      `--bb-window-frame-top: var(--wc-top)`,
      `padding-top: var(--wc-top)`,
      `background: ${BACKDROP}`,
    ]),
    rule(WINDOWED, [`--wc-top: ${TOP_WINDOWED_PX}px`]),
    // Полоса заголовка остаётся только над островом — за неё по-прежнему тянут окно.
    rule(TITLE_BAR, [`height: var(--wc-top)`, `padding: 0`]),
    rule(`${TITLE_BAR} > div`, [`position: fixed`, `top: var(--wc-control-top)`, `margin: 0`, `transform: none`]),
    // Скрытие левой панели — в левом углу первой строки панели тредов.
    rule(`${TITLE_BAR} > :has(> [data-sidebar="trigger"])`, [`left: calc(var(--wc-rail) + var(--wc-inset))`]),
    // Назад и вперёд — у правого края той же строки. Ширину панели тянут мышью,
    // и задана она на самой панели, а не на корне, поэтому край берётся якорем.
    // У каждой панели — тредов, плагинов, навыков, настроек — своя первая
    // строка; у невидимой панели строка без раскладки, и якорь берётся с видимой.
    rule(ANY_SIDEBAR_TOP_ROW, [`anchor-name: --wc-sidebar-top`, `height: var(--bb-app-chrome-row-height)`]),
    rule(SIDEBAR_TOP_ROW, [
      // «New thread» уходит строкой ниже, под кнопки.
      `height: calc(var(--bb-app-chrome-row-height) + 32px)`,
      `padding-top: var(--bb-app-chrome-row-height)`,
    ]),
    rule(BACK_FORWARD, [`position-anchor: --wc-sidebar-top`, `right: calc(anchor(right) + var(--wc-inset))`]),
    // Панель скрыта — назад и вперёд встают вплотную за кнопкой панели, в углу острова.
    rule(`${COLLAPSED} > ${TITLE_BAR_ID} > ${BACK_FORWARD_GROUP}`, [
      `position-anchor: none`,
      `left: calc(var(--wc-rail) + var(--wc-inset) + var(--wc-button) + var(--wc-gap))`,
      `right: auto`,
    ]),
    rule(`${COLLAPSED} ${PAGE_HEADER_ROW}`, [`padding-left: calc(3 * var(--wc-button) + 3 * var(--wc-gap))`]),
    rule(`${TITLE_BAR} > :has(> [data-testid="window-right-panel-toggle"])`, [`right: calc(var(--wc-lip) + var(--wc-inset))`]),
    // Место под кнопку правой панели — в шапке страницы, пока панель закрыта, и в
    // шапке самой панели: так, чтобы до кнопки был тот же шаг, что между
    // кнопками шапки. Обе шапки отделены от края острова рамкой в 1 px; у шапки
    // страницы боковой отступ px-4 стоит на родителе и остаётся, у шапки
    // панели — на ней самой и заменяется этим.
    rule(`${RIGHT_PANEL_CLOSED} ${PAGE_HEADER_ROW}`, [
      `padding-right: calc(var(--wc-inset) + var(--wc-button) + var(--wc-header-gap) - var(--wc-header-pad) - 1px)`,
    ]),
    rule(PANEL_HEADER_ROW, [`padding-right: calc(var(--wc-inset) + var(--wc-button) + var(--wc-header-gap) - 1px)`]),
    // bb опускает шапки и кнопку панели на 2 px под светофор — без строки
    // заголовка это ломает ось, всё встаёт на середину строки.
    rule(`${TITLE_BAR} [data-sidebar="trigger"],\n[data-framed] ${PAGE_HEADER_ROW},\n${PANEL_HEADER_ROW}`, [`transform: none`]),
    // Рейка слева: дом — на оси верхнего ряда, настройки — на оси нижнего ряда панели тредов.
    rule(`[data-framed] [data-testid="app-nav-rail"] > nav`, [
      `padding-top: calc(0.5rem + 1px)`,
      `padding-bottom: calc((${FOOTER_ROW_PX}px - var(--wc-button)) / 2 + 1px)`,
    ]),
    // Кнопки рейки — с шагом строк тредов внутри проекта: та же высота 28 px и зазор между ними.
    rule(`[data-framed] [data-testid="app-nav-rail"] > nav > div`, [`gap: ${RAIL_GAP}`]),
  ].join("\n");
}
