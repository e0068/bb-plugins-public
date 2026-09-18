// Язык интерфейса во фронте без обращения к SDK: контекст и хуки частей.
// Провайдер, читающий настройку плагина, — в `locale.tsx`; части берут
// словарь отсюда и не тянут SDK раньше, чем тест поставит его среду.
import { createContext, useContext } from "react";

import { resolveLocale, type Locale } from "../lib/i18n";
import { messages, type Messages } from "../lib/messages";

/** Языки браузера в порядке предпочтения; вне браузера — пусто. */
export const systemLanguages = (): readonly string[] => {
  if (typeof navigator === "undefined") return [];
  return navigator.languages !== undefined && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
};

export const LocaleContext = createContext<Locale | null>(null);

/** Язык ближайшего провайдера; без провайдера — язык браузера. */
export const useLocale = (): Locale => useContext(LocaleContext) ?? resolveLocale(undefined, systemLanguages());

export const useMessages = (): Messages => messages(useLocale());
