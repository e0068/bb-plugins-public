/** Путь панели Flow в левом меню: его регистрирует `app.tsx`, по нему лента открывает flow и историю, а строка истории — страницу flow. */
export const FLOWS_PANEL_PATH = "flows";

/** Адрес панели Flow в bb: она живёт на `/plugins/<id плагина>/<путь панели>/*`. */
const PANEL_ROUTE = `/plugins/flow/${FLOWS_PANEL_PATH}`;

/** Адрес страницы flow в bb: хвост — id flow. */
export const flowRoute = (flowId: string): string => `${PANEL_ROUTE}/${encodeURIComponent(flowId)}`;

/**
 * Хвост адреса страницы Flow — то, что панель получает свойством `subPath`: пусто на корне, id flow или история; `null`,
 * когда окно не на странице Flow. Панели тредов адрес не передаётся, поэтому её список читает его из окна.
 */
export const flowsSubPathOf = (pathname: string): string | null => {
  if (pathname !== PANEL_ROUTE && !pathname.startsWith(`${PANEL_ROUTE}/`)) return null;
  const tail = pathname.slice(PANEL_ROUTE.length + 1);
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
};

/** Страница настроек плагина в bb — её открывает и «Settings» в Tools: язык, пороги контекста и разделы Flow. */
export const SETTINGS_ROUTE = "/settings/plugins/flow";
