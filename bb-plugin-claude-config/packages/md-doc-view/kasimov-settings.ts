// Pure shared layer: appearance and flag settings for the Kasimov editor. It
// lives in packages/md-doc-view so both consuming plugins (Cloud Config, MD
// Opener) share ONE schema, while EACH stores ITS OWN values (settings are not
// shared: each plugin has its own bb.settings.define + its own useSettings;
// there is no cross-plugin sync — the owner's decision, decisions/kasimov-settings-separate).
//
// One field table is the single source of truth; from it we derive the
// descriptors for bb.settings.define, a total parse of board values, and the
// mapping to CSS variables (`--kasi-*`) and engine flags. No effects: values
// come from useSettings() (the front end), the functions only transform.
//
// Sizes/gaps/colors/fonts are strings: the SDK has no numeric or color setting
// type (a setting's value is string | boolean | a select string from fixed
// options). Flags are booleans. Defaults match packages/kasimov/kasimov.css by
// value (so an empty/unset setting preserves the current look) — px fields
// store a bare number ("14", not "14px": the unit is appended by
// toCssVars/withUnit, the field doesn't need to carry it).
//
// Fonts/colors additionally carry a select preset (TOKEN_SELECT_FIELDS —
// ready-made fonts and host theme tokens): while it's on "custom", the text
// field behaves as before; any other value is the preset itself.

/** A setting's flat value, as returned by useSettings().values. */
export type SettingValue = string | boolean;

export interface KasimovSettings {
  // Appearance (CSS variables).
  size: string;
  lineHeight: string;
  gap: string;
  radius: string;
  font: string;
  mono: string;
  fg: string;
  fgDim: string;
  bg: string;
  cellBg: string;
  accent: string;
  maxWidth: string;
  colMx: string;
  padX: string;
  paraGap: string;
  listGap: string;
  // Presets (select): a ready-made value replacing the corresponding field
  // above, until set to "custom". See TOKEN_SELECT_FIELDS.
  fontToken: string;
  monoToken: string;
  fgToken: string;
  fgDimToken: string;
  bgToken: string;
  cellBgToken: string;
  accentToken: string;
  // Engine flags.
  followLinks: boolean;
  atLinks: boolean;
  frontmatter: boolean;
  mermaidContrast: boolean;
}

type FlagField = "followLinks" | "atLinks" | "frontmatter" | "mermaidContrast";
type TokenField =
  | "fontToken"
  | "monoToken"
  | "fgToken"
  | "fgDimToken"
  | "bgToken"
  | "cellBgToken"
  | "accentToken";
type CssField = keyof Omit<KasimovSettings, FlagField | TokenField>;

/** A select doesn't override the field while set to this value. */
const CUSTOM_TOKEN = "custom";

interface CssSpec {
  field: CssField;
  /** The setting's key on the bb board (unique within the plugin). */
  key: string;
  /** The CSS custom property the value sets. */
  cssVar: string;
  default: string;
  label: string;
  description?: string;
  /**
   * `"px"` — the field accepts a bare number ("8"), toCssVars appends the
   * unit; a value with a unit already given, or a keyword (px/%/auto/none/…),
   * is left untouched. Don't set this for unitless values (lineHeight) or
   * non-numeric fields (fonts, colors).
   */
  unit?: "px";
}

interface FlagSpec {
  field: FlagField;
  key: string;
  default: boolean;
  label: string;
  description?: string;
}

interface TokenSelectSpec {
  /** The select setting. */
  field: TokenField;
  /** The setting's key on the bb board. */
  key: string;
  /** Which CSS field (from CSS_FIELDS) this select overrides while not "custom". */
  target: CssField;
  label: string;
  description?: string;
  /** Ready-made values like "var(--foo)" / a font stack; "custom" is added separately. */
  options: readonly string[];
}

// bb host tokens found in the design system (shadcn-like CSS custom
// properties, set by the host itself). This list is observed, not official —
// this monorepo has no central registry for them.
const HOST_COLOR_TOKENS = [
  "var(--foreground)",
  "var(--muted-foreground)",
  "var(--background)",
  "var(--card)",
  "var(--primary)",
  "var(--accent)",
  "var(--destructive)",
  "var(--border)",
  "var(--muted)",
  "var(--ring)",
  "var(--success)",
  "var(--attention)",
  "var(--canvas)",
  "var(--ink)",
  // --primary in the bb theme is achromatic; the only colored accent token is
  // --timeline-accent (see packages/md-doc-view/md-doc-view.css, which it's inherited from).
  "var(--timeline-accent)",
] as const;

const FONT_SANS_PRESETS = [
  "var(--font-sans)",
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  "Arial, Helvetica, sans-serif",
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, "Times New Roman", serif',
] as const;

const FONT_MONO_PRESETS = [
  "var(--font-mono)",
  "ui-monospace, SFMono-Regular, Menlo, monospace",
  '"Courier New", Courier, monospace',
  'Consolas, "Liberation Mono", monospace',
] as const;

export const TOKEN_SELECT_FIELDS: readonly TokenSelectSpec[] = [
  {
    field: "fontToken",
    key: "kasimovFontToken",
    target: "font",
    label: "Kasimov: main font — preset",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: main font" field below; var(--font-sans) — the host theme's font`,
    options: FONT_SANS_PRESETS,
  },
  {
    field: "monoToken",
    key: "kasimovMonoToken",
    target: "mono",
    label: "Kasimov: monospace font — preset",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: monospace font" field below; var(--font-mono) — the host theme's font`,
    options: FONT_MONO_PRESETS,
  },
  {
    field: "fgToken",
    key: "kasimovFgToken",
    target: "fg",
    label: "Kasimov: text color — theme token",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: text color" field below`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "fgDimToken",
    key: "kasimovFgDimToken",
    target: "fgDim",
    label: "Kasimov: muted text color — theme token",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: muted text color" field below`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "bgToken",
    key: "kasimovBgToken",
    target: "bg",
    label: "Kasimov: background color (inner panels) — theme token",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: background color" field below`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "cellBgToken",
    key: "kasimovCellBgToken",
    target: "cellBg",
    label: "Kasimov: cell/code color — theme token",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: cell/code color" field below`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "accentToken",
    key: "kasimovAccentToken",
    target: "accent",
    label: "Kasimov: accent color — theme token",
    description: `"${CUSTOM_TOKEN}" — use the "Kasimov: accent color" field below`,
    options: HOST_COLOR_TOKENS,
  },
];

// Defaults — from packages/kasimov/kasimov.css.
export const CSS_FIELDS: readonly CssSpec[] = [
  {
    field: "size",
    key: "kasimovFontSize",
    cssVar: "--kasi-size",
    default: "14",
    label: "Kasimov: text size, px",
    description: "Editor font size, e.g. 14",
    unit: "px",
  },
  {
    field: "lineHeight",
    key: "kasimovLineHeight",
    cssVar: "--kasi-line-height",
    default: "1.5",
    label: "Kasimov: line height",
    description: "Body line height, e.g. 1.5",
  },
  {
    field: "gap",
    key: "kasimovGap",
    cssVar: "--kasi-gap",
    default: "4",
    label: "Kasimov: gap, px",
    description: "Base vertical spacing between blocks, e.g. 4",
    unit: "px",
  },
  {
    field: "radius",
    key: "kasimovRadius",
    cssVar: "--kasi-radius",
    default: "8",
    label: "Kasimov: corner radius, px",
    description: "Corner radius of panels/code, e.g. 8",
    unit: "px",
  },
  {
    field: "font",
    key: "kasimovFont",
    cssVar: "--kasi-font",
    default:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    label: "Kasimov: main font",
    description: "font-family for text",
  },
  {
    field: "mono",
    key: "kasimovMono",
    cssVar: "--kasi-mono",
    default: "ui-monospace, SFMono-Regular, Menlo, monospace",
    label: "Kasimov: monospace font",
    description: "font-family for code",
  },
  {
    field: "fg",
    key: "kasimovFg",
    cssVar: "--kasi-fg",
    default: "#e8e8ea",
    label: "Kasimov: text color",
  },
  {
    field: "fgDim",
    key: "kasimovFgDim",
    cssVar: "--kasi-fg-dim",
    default: "rgba(255, 255, 255, .5)",
    label: "Kasimov: muted text color",
  },
  {
    field: "bg",
    key: "kasimovBg",
    cssVar: "--kasi-bg",
    default: "#0e0e0e",
    label: "Kasimov: background color (inner panels)",
  },
  {
    field: "cellBg",
    key: "kasimovCellBg",
    cssVar: "--kasi-cell-bg",
    default: "#1c1c1e",
    label: "Kasimov: cell/code color",
  },
  {
    field: "accent",
    key: "kasimovAccent",
    cssVar: "--kasi-accent",
    default: "#d1603d",
    label: "Kasimov: accent color (links)",
  },
  {
    field: "maxWidth",
    key: "kasimovMaxWidth",
    cssVar: "--kasi-max-width",
    default: "none",
    label: "Kasimov: max column width, px",
    description: "Column width, e.g. 720; none — full width",
    unit: "px",
  },
  {
    field: "colMx",
    key: "kasimovColMx",
    cssVar: "--kasi-col-mx",
    default: "0",
    label: "Kasimov: column margin, px",
    description: "With a max width set: 0 — left-aligned, auto — centered",
    unit: "px",
  },
  {
    field: "padX",
    key: "kasimovPadX",
    cssVar: "--kasi-pad-x",
    default: "44",
    label: "Kasimov: side padding, px",
    description: "Side \"format margins\" of the editable canvas, e.g. 44",
    unit: "px",
  },
  {
    field: "paraGap",
    key: "kasimovParaGap",
    cssVar: "--kasi-para-gap",
    default: "0",
    label: "Kasimov: paragraph gap, px",
    description: "Vertical spacing between paragraphs/blocks, e.g. 8",
    unit: "px",
  },
  {
    field: "listGap",
    key: "kasimovListGap",
    cssVar: "--kasi-list-gap",
    default: "0",
    label: "Kasimov: list item gap, px",
    description: "Extra vertical spacing between list items, e.g. 4",
    unit: "px",
  },
];

export const FLAG_FIELDS: readonly FlagSpec[] = [
  {
    field: "followLinks",
    key: "kasimovFollowLinks",
    default: true,
    label: "Kasimov: follow links",
    description: "Clicking a live link follows it instead of selecting the token",
  },
  {
    field: "atLinks",
    key: "kasimovAtLinks",
    default: true,
    label: "Kasimov: clickable @import",
    description: "`@path` (Claude @import) is clickable; off — plain text",
  },
  {
    field: "frontmatter",
    key: "kasimovFrontmatter",
    default: true,
    label: "Kasimov: show frontmatter",
    description: "Show the frontmatter block as a grid (the value is preserved)",
  },
  {
    field: "mermaidContrast",
    key: "kasimovMermaidContrast",
    default: false,
    label: "Kasimov: contrast mermaid nodes",
    description: "Filled chip with inverse text; off — \"soft\" nodes (default)",
  },
];

/** Default settings — from the field tables (match kasimov.css). */
export const DEFAULTS: KasimovSettings = {
  ...(Object.fromEntries(
    CSS_FIELDS.map((f) => [f.field, f.default]),
  ) as Record<CssField, string>),
  ...(Object.fromEntries(
    TOKEN_SELECT_FIELDS.map((t) => [t.field, CUSTOM_TOKEN]),
  ) as Record<TokenField, string>),
  ...(Object.fromEntries(
    FLAG_FIELDS.map((f) => [f.field, f.default]),
  ) as Record<FlagField, boolean>),
};

const tokenSpecByTarget = new Map(TOKEN_SELECT_FIELDS.map((t) => [t.target, t]));

/**
 * Preset defaults for "match the native bb viewer" — shared by both consumers
 * (MD Opener and Cloud Config), which used to achieve the same look by
 * hardcoding it on top of Kasimov in the shared
 * packages/md-doc-view/md-doc-view.css (see
 * memory/decisions/kasimov-opener-css-uses-token-defaults.md). One source —
 * not a copy in each server.ts (G1). All 7 TOKEN_SELECT_FIELDS fields are
 * covered explicitly, including `bgToken` (`--kasi-bg` only controls inner
 * panels — mermaid/zoom, not the document background, but the panels are
 * still part of "matching the native look").
 */
export const NATIVE_VIEWER_TOKEN_DEFAULTS: Record<TokenField, string> = {
  fontToken: "var(--font-sans)",
  monoToken: "var(--font-mono)",
  fgToken: "var(--foreground)",
  fgDimToken: "var(--muted-foreground)",
  bgToken: "var(--background)",
  cellBgToken: "var(--muted)",
  accentToken: "var(--timeline-accent)",
};

/**
 * Descriptors for bb.settings.define (a flat key → descriptor object).
 * Order follows CSS_FIELDS; if a field has a preset (TOKEN_SELECT_FIELDS), its
 * select goes IMMEDIATELY BEFORE the text field — the preset's own description
 * promises "the field below", and that has to be literally true, not
 * somewhere at the tail of the list past a dozen other settings.
 *
 * `tokenDefaults` — the preset default (e.g. `NATIVE_VIEWER_TOKEN_DEFAULTS`);
 * without it — `CUSTOM_TOKEN` on every field (the text field takes over).
 */
export function buildDescriptors(
  tokenDefaults: Partial<Record<TokenField, string>> = {},
) {
  const cssEntries = CSS_FIELDS.flatMap((f) => {
    const cssEntry = [
      f.key,
      {
        type: "string" as const,
        label: f.label,
        ...(f.description ? { description: f.description } : {}),
        default: f.default,
      },
    ] as const;
    const t = tokenSpecByTarget.get(f.field);
    if (!t) return [cssEntry];
    const tokenEntry = [
      t.key,
      {
        type: "select" as const,
        label: t.label,
        ...(t.description ? { description: t.description } : {}),
        options: [CUSTOM_TOKEN, ...t.options],
        default: tokenDefaults[t.field] ?? CUSTOM_TOKEN,
      },
    ] as const;
    return [tokenEntry, cssEntry];
  });
  return {
    ...Object.fromEntries(cssEntries),
    ...Object.fromEntries(
      FLAG_FIELDS.map((f) => [
        f.key,
        {
          type: "boolean" as const,
          label: f.label,
          ...(f.description ? { description: f.description } : {}),
          default: f.default,
        },
      ]),
    ),
  };
}

/** Descriptors with shared defaults (CUSTOM_TOKEN for every preset). */
export const descriptors = buildDescriptors();

const allowedTokenValues = new Map(
  TOKEN_SELECT_FIELDS.map((t) => [t.field, new Set<string>([CUSTOM_TOKEN, ...t.options])]),
);

/**
 * Total parse of board values into settings: take a value of the right type,
 * otherwise fall back to the default. `values` can be undefined (still
 * loading) — then everything is default. Junk and extra keys are dropped by
 * the parse itself (only known keys are read). A preset (select) is further
 * narrowed to its own `options` list — a stale value (the token list changed,
 * but the board still holds the old one) falls back to `CUSTOM_TOKEN` instead
 * of flying into CSS as-is.
 */
export function parse(
  values: Record<string, SettingValue> | undefined,
): KasimovSettings {
  const v = values ?? {};
  const css = Object.fromEntries(
    CSS_FIELDS.map((f) => {
      const raw = v[f.key];
      return [f.field, typeof raw === "string" ? raw : f.default];
    }),
  ) as Record<CssField, string>;
  const tokens = Object.fromEntries(
    TOKEN_SELECT_FIELDS.map((t) => {
      const raw = v[t.key];
      const valid = typeof raw === "string" && allowedTokenValues.get(t.field)!.has(raw);
      return [t.field, valid ? (raw as string) : CUSTOM_TOKEN];
    }),
  ) as Record<TokenField, string>;
  const flags = Object.fromEntries(
    FLAG_FIELDS.map((f) => {
      const raw = v[f.key];
      return [f.field, typeof raw === "boolean" ? raw : f.default];
    }),
  ) as Record<FlagField, boolean>;
  return { ...css, ...tokens, ...flags };
}

const BARE_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * A bare number ("8") gets a unit appended; a value with a unit already given,
 * or a keyword (px/%/auto/none/…), is returned as-is — setting fields accept
 * numbers without px, there's no need to write it by hand.
 */
export function withUnit(value: string, unit: "px"): string {
  return BARE_NUMBER.test(value) ? `${value}${unit}` : value;
}

const tokenFieldByTarget = new Map(
  TOKEN_SELECT_FIELDS.map((t) => [t.target, t.field]),
);

/**
 * The final value of a CSS field: the preset (select), if the field has one
 * and it isn't "custom"/empty; otherwise the text field. `parse()` already
 * guarantees the preset ∈ {"custom", ...options}, but `toCssVars` is a
 * standalone pure function over `KasimovSettings`, not just over the result of
 * `parse()` (see the tests that assemble `KasimovSettings` by hand), so ""
 * remains an explicitly checked case rather than relying on someone else's guarantee.
 */
function effectiveCssValue(s: KasimovSettings, f: CssSpec): string {
  const tokenField = tokenFieldByTarget.get(f.field);
  const tokenValue = tokenField ? s[tokenField] : "";
  return tokenValue !== "" && tokenValue !== CUSTOM_TOKEN ? tokenValue : s[f.field];
}

/** CSS custom properties for the host element: only non-empty values (empty = CSS default). */
export function toCssVars(s: KasimovSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CSS_FIELDS) {
    const value = effectiveCssValue(s, f);
    if (value === "") continue;
    out[f.cssVar] = f.unit ? withUnit(value, f.unit) : value;
  }
  return out;
}

/** Characters a variable's name/value could use to escape the boundary of a CSS rule. */
const UNSAFE_CSS = /[{};<>]/;

/**
 * The CSS rule `#hostId .mde-root { --var: value; … }` to inject into
 * document.head (see KasimovEditor). `null` if there's nothing to set.
 *
 * Values arrive as bare strings from the settings board (untyped and not
 * validated by a form — kasimovFontSize etc. can hold anything), so pairs
 * whose name or value could break the rule and leak into neighboring CSS
 * (`{`, `}`, `;`, `<`, `>`) are dropped entirely, rather than checked by the caller.
 */
export function kasimovCssRule(
  hostId: string,
  vars: Record<string, string>,
): string | null {
  const decls = Object.entries(vars)
    .filter(([name, value]) => !UNSAFE_CSS.test(name) && !UNSAFE_CSS.test(value))
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return decls === "" ? null : `#${hostId} .mde-root { ${decls} }`;
}

/** Engine options for KasimovEditor: boolean flags + the string mermaid mode. */
export function toFlags(s: KasimovSettings): {
  followLinks: boolean;
  atLinks: boolean;
  frontmatter: boolean;
  mermaidNodes: "soft" | "contrast";
} {
  return {
    followLinks: s.followLinks,
    atLinks: s.atLinks,
    frontmatter: s.frontmatter,
    // Binary mermaid mode choice → the engine's string option (soft — default).
    mermaidNodes: s.mermaidContrast ? "contrast" : "soft",
  };
}
