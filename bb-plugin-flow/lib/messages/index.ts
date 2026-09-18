// Словарь по языку. Язык решает фронт (`resolveLocale`), сюда он приходит готовым.
import { DEFAULT_LOCALE, type Locale } from "../i18n";
import { en } from "./en";
import { ru, type Messages } from "./ru";

export type { Messages };

export const messages = (locale: Locale = DEFAULT_LOCALE): Messages => (locale === "en" ? en : ru);
