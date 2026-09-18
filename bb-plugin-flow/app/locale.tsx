// Провайдер языка для корней поверхностей — брифа, команды, секций настроек:
// настройка плагина поверх языка браузера.
import type { ReactNode } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";

import { LANGUAGE_SETTING, resolveLocale } from "../lib/i18n";
import { LocaleContext, systemLanguages } from "./locale-context";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { values } = useSettings();
  return <LocaleContext.Provider value={resolveLocale(values?.[LANGUAGE_SETTING], systemLanguages())}>{children}</LocaleContext.Provider>;
}
