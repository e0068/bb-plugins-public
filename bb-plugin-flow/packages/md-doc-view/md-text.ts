// Pure layer: the look of a piece of text a consumer assembled — a field of a
// card, a note — drawn by Kasimov's read mode. It is MD Opener's stock preset
// without a document's format margins. The host's typography — size, weight,
// line height, font, color — is taken in md-text.css by the properties
// themselves, not here: the engine reads the variables back as colors and
// sizes for mermaid's theme, so they have to stay real values.
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  cssVarsRule,
  parse,
  toCssVars,
} from "./kasimov-settings";

/** The class of MdText's host; the look below hangs on it. */
export const MD_TEXT_CLASS = "mdt";

/**
 * A field of a card is not a page: no format margins, no column cap. A
 * diagram's panel and the engine's pop-ups take the host's background: the
 * preset leaves them at the engine's dark default, under ink that follows the
 * host's theme. The panel has to be opaque — it also masks edge labels.
 */
const FIELD_LAYOUT: Record<string, string> = {
  "--kasi-pad-x": "0",
  "--kasi-max-width": "none",
  "--kasi-mermaid-bg": "var(--background)",
  "--kasi-surface": "var(--background)",
};

export const mdTextVars: Record<string, string> = {
  ...toCssVars(parse({}, NATIVE_VIEWER_TOKEN_DEFAULTS)),
  ...FIELD_LAYOUT,
};

/** One rule for every MdText on the page — the values never differ between them. */
export const mdTextRule = cssVarsRule(`.${MD_TEXT_CLASS} .mde-root`, mdTextVars)!;
