// Чистое решение маршрутизации открытия файла по настройке `fileOpener`. Отделено
// от app.tsx, чтобы тестироваться без jsdom и SDK: только выбор «хостовая вкладка
// против встроенной колонки». Какой редактор внутри колонки (Kasimov или штатный)
// — уже дело рендера DocTab, здесь не решается.

export type FileOpener = "md-opener" | "builtin" | "host";

export const DEFAULT_FILE_OPENER: FileOpener = "md-opener";

// Нормализует значение настройки (может прийти undefined или чужой строкой) к
// одному из трёх режимов, падая на дефолт.
export function normalizeOpener(value: unknown): FileOpener {
  return value === "md-opener" || value === "builtin" || value === "host"
    ? value
    : DEFAULT_FILE_OPENER;
}

// true — файл уходит в хостовую вкладку bb; false — во встроенную колонку панели
// (оба режима Kasimov/builtin открывают в колонке).
export function isHostOpen(setting: unknown): boolean {
  return normalizeOpener(setting) === "host";
}
