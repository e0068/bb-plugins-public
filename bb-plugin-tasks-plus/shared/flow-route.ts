/**
 * Страница flow в плагине Flow. Tasks+ открывает её якорем, а не навигацией SDK: `toPluginPanel` ведёт только в свои
 * панели, а чужой маршрут хост перехватывает у `<a href>` внутри корня плагина. Id плагина и панели — Flow'а.
 */
export const flowRoute = (id: string): string => `/plugins/flow/flows/${encodeURIComponent(id)}`;
