// Язык интерфейса и ответа в тред. Настройка плагина хранит подпись варианта,
// а язык системы знает только браузер, поэтому язык решается на фронте и
// уходит на сервер вместе с ответом.

export type Locale = "en" | "ru";

export const LANGUAGE_SYSTEM = "System";

/** Варианты настройки языка в порядке списка; значение по умолчанию — первое. */
export const LANGUAGE_OPTIONS = [LANGUAGE_SYSTEM, "English", "Русский"] as const;

/** Ключ настройки языка в `bb.settings`. */
export const LANGUAGE_SETTING = "language";

/** Вызовы без языка — ответы и снимки, записанные до выбора языка, — русские, как было. */
export const DEFAULT_LOCALE: Locale = "ru";

/** Выбранный язык поверх языка системы; System, пустое и чужое значение берут первый язык системы. */
export const resolveLocale = (setting: unknown, systemLanguages: readonly string[]): Locale => {
  if (setting === "English") return "en";
  if (setting === "Русский") return "ru";
  return systemLanguages[0]?.toLowerCase().startsWith("ru") === true ? "ru" : "en";
};
