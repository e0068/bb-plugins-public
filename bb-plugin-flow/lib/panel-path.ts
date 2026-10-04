/** Путь панели Flow в левом меню: его регистрирует `app.tsx`, по нему лента открывает flow и историю, а строка истории — страницу flow. */
export const FLOWS_PANEL_PATH = "flows";

/** Адрес страницы flow в bb: панель живёт на `/plugins/<id плагина>/<путь панели>/*`, хвост — id flow. */
export const flowRoute = (flowId: string): string => `/plugins/flow/${FLOWS_PANEL_PATH}/${encodeURIComponent(flowId)}`;
