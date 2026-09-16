// Public entry point of the package: MD Opener's presentational component and
// its types. The KasimovEditor wrapper is an internal detail, not re-exported
// (the consumer works through MdDocView and effect injection).
export { MdDocView } from "./MdDocView";
// What the plugin imports and hands down — this package imports neither.
export type { DocLibraries } from "./libraries";
export type { CodeMirrorKit } from "../code-editor";
export type { TabsKit } from "../segmented-control";
export type {
  MdDocViewProps,
  LoadedDoc,
  SaveResult,
  RevealResult,
} from "./MdDocView";
// The rule both renderers share for "does this document open in edit mode".
// A server imports it from "./open-mode" directly, bypassing this barrel.
export { opensInEditMode } from "./open-mode";
// The three modes of a document, the rule for which one it opens in, and the
// one that brings a mode picked earlier back to what the document offers now.
export { availableModes, initialMode, settleMode } from "./doc-mode";
export type { DocMode } from "./doc-mode";
// How far the draft has drifted from the file, in lines — the `+N −M` of the
// header's second row.
export { lineDiff } from "./line-diff";
export type { LineDiffCount } from "./line-diff";
// The engines' markup vocabulary: a plugin that renders an engine itself (not
// through MdDocView) needs the same click guard.
export { LINK_TOKEN_SELECTOR } from "./link-tokens";
// The shared Kasimov settings schema (sizes/gaps/colors/flags). Each plugin
// stores its own values; only the schema and pure transforms live here.
export {
  CSS_FIELDS,
  FLAG_FIELDS,
  DEFAULTS,
  // The preset defaults a plugin registers with buildDescriptors. The panel
  // has to hand the SAME set to parseKasimovSettings, or a document looks one
  // way before useSettings() answers and another way after.
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  parse as parseKasimovSettings,
  toCssVars as kasimovCssVars,
  toFlags as kasimovFlags,
} from "./kasimov-settings";
export type { KasimovSettings, SettingValue } from "./kasimov-settings";
