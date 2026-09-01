// Публичный вход пакета: презентационный компонент MD Opener и его типы. Обёртка
// KasimovEditor — внутренняя деталь, наружу не реэкспортируется (потребитель
// работает через MdDocView и инъекцию эффектов).
export { MdDocView } from "./MdDocView";
export type {
  MdDocViewProps,
  LoadedDoc,
  SaveResult,
} from "./MdDocView";
// Общая схема настроек Kasimov (кегли/отступы/цвета/флаги). Значения каждый
// плагин хранит свои; здесь только схема и чистые преобразования.
export {
  CSS_FIELDS,
  FLAG_FIELDS,
  DEFAULTS,
  parse as parseKasimovSettings,
  toCssVars as kasimovCssVars,
  toFlags as kasimovFlags,
} from "./kasimov-settings";
export type { KasimovSettings, SettingValue } from "./kasimov-settings";
