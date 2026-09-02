// Public entry point of the package: MD Opener's presentational component and
// its types. The KasimovEditor wrapper is an internal detail, not re-exported
// (the consumer works through MdDocView and effect injection).
export { MdDocView } from "./MdDocView";
export type {
  MdDocViewProps,
  LoadedDoc,
  SaveResult,
} from "./MdDocView";
// The shared Kasimov settings schema (sizes/gaps/colors/flags). Each plugin
// stores its own values; only the schema and pure transforms live here.
export {
  CSS_FIELDS,
  FLAG_FIELDS,
  DEFAULTS,
  parse as parseKasimovSettings,
  toCssVars as kasimovCssVars,
  toFlags as kasimovFlags,
} from "./kasimov-settings";
export type { KasimovSettings, SettingValue } from "./kasimov-settings";
