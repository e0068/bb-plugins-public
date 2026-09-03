import { describe, expect, it } from "vitest";
import {
  CSS_FIELDS,
  DEFAULTS,
  FLAG_FIELDS,
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  TOKEN_SELECT_FIELDS,
  buildDescriptors,
  descriptors,
  kasimovCssRule,
  parse,
  toCssVars,
  toFlags,
  withUnit,
  type KasimovSettings,
  type SettingValue,
} from "./kasimov-settings";

const CUSTOM_TOKEN = "custom";

describe("DEFAULTS", () => {
  it("match the field tables' defaults", () => {
    for (const f of CSS_FIELDS) expect(DEFAULTS[f.field]).toBe(f.default);
    for (const f of FLAG_FIELDS) expect(DEFAULTS[f.field]).toBe(f.default);
  });

  it("presets default to custom (the text field takes over, same as before)", () => {
    for (const t of TOKEN_SELECT_FIELDS) expect(DEFAULTS[t.field]).toBe(CUSTOM_TOKEN);
  });

  // Three field tables are the single source of truth for the KasimovSettings
  // shape; a field forgotten in one of the tables (or the interface) must not
  // slip through unnoticed — DEFAULTS/parse are built via `as Record<...>`,
  // which by itself doesn't catch that kind of drift.
  it("DEFAULTS keys equal the union of the three tables' fields (type-drift gate)", () => {
    const expected = [
      ...CSS_FIELDS.map((f) => f.field),
      ...TOKEN_SELECT_FIELDS.map((t) => t.field),
      ...FLAG_FIELDS.map((f) => f.field),
    ];
    expect(new Set(Object.keys(DEFAULTS))).toEqual(new Set(expected));
    expect(Object.keys(DEFAULTS)).toHaveLength(expected.length);
  });
});

describe("descriptors", () => {
  it("string fields — type string, flags — type boolean, with a default", () => {
    for (const f of CSS_FIELDS) {
      const d = descriptors[f.key];
      expect(d).toMatchObject({ type: "string", label: f.label, default: f.default });
    }
    for (const f of FLAG_FIELDS) {
      const d = descriptors[f.key];
      expect(d).toMatchObject({ type: "boolean", label: f.label, default: f.default });
    }
  });

  it("presets — type select, custom first in options, default custom", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      const d = descriptors[t.key] as {
        type: string;
        label: string;
        options: string[];
        default: string;
      };
      expect(d).toMatchObject({ type: "select", label: t.label, default: CUSTOM_TOKEN });
      expect(d.options[0]).toBe(CUSTOM_TOKEN);
      expect(d.options.slice(1)).toEqual(t.options);
    }
  });

  it("setting keys are unique", () => {
    const keys = [...CSS_FIELDS, ...TOKEN_SELECT_FIELDS, ...FLAG_FIELDS].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Order in the object determines order in the Settings UI (see
  // buildDescriptors below): a select preset must go IMMEDIATELY BEFORE its
  // text field — its own description promises "the field below", and that has
  // to be literally true, not somewhere at the tail past a dozen other settings.
  it("a select preset goes right before the text field it overrides", () => {
    const order = Object.keys(descriptors);
    for (const t of TOKEN_SELECT_FIELDS) {
      const target = CSS_FIELDS.find((f) => f.field === t.target)!;
      expect(order.indexOf(target.key)).toBe(order.indexOf(t.key) + 1);
    }
  });
});

describe("buildDescriptors", () => {
  it("with no argument — same as the exported descriptors", () => {
    expect(buildDescriptors()).toEqual(descriptors);
  });

  it("an override changes the default of only the passed field; the rest stay custom", () => {
    const overridden = buildDescriptors({ fgToken: "var(--foreground)" });
    expect(
      (overridden.kasimovFgToken as { default: string }).default,
    ).toBe("var(--foreground)");
    for (const t of TOKEN_SELECT_FIELDS) {
      if (t.field === "fgToken") continue;
      expect((overridden[t.key] as { default: string }).default).toBe(CUSTOM_TOKEN);
    }
  });

  it("an override outside options still lands in the descriptor's default (caller's responsibility)", () => {
    // buildDescriptors is an internal config API (its callers are only the
    // plugins' server.ts, not the settings board), so it isn't obligated to
    // be total over an arbitrary string — unlike parse(), which parses
    // untrusted data from the board.
    const overridden = buildDescriptors({ accentToken: "var(--not-in-list)" });
    expect((overridden.kasimovAccentToken as { default: string }).default).toBe(
      "var(--not-in-list)",
    );
  });

  // NATIVE_VIEWER_TOKEN_DEFAULTS is a public constant shared by both
  // server.ts files (md-opener/claude-config); if the token list is ever
  // trimmed and the constant is forgotten, buildDescriptors() won't reject it
  // (see the test above — an override isn't checked for membership). So this
  // test is the only place that catches the staleness.
  it("NATIVE_VIEWER_TOKEN_DEFAULTS — every value is actually in its field's options", () => {
    for (const [field, value] of Object.entries(NATIVE_VIEWER_TOKEN_DEFAULTS)) {
      const spec = TOKEN_SELECT_FIELDS.find((t) => t.field === field)!;
      expect(spec.options).toContain(value);
    }
  });

  // The Record<TokenField, string> type (not Partial) already makes tsc
  // reject a missing field — this test duplicates the guarantee at runtime so
  // drift is caught even without a tsc run (e.g. a local `vitest --watch`).
  it("NATIVE_VIEWER_TOKEN_DEFAULTS covers every TOKEN_SELECT_FIELDS field, none skipped", () => {
    const expected = TOKEN_SELECT_FIELDS.map((t) => t.field).sort();
    expect(Object.keys(NATIVE_VIEWER_TOKEN_DEFAULTS).sort()).toEqual(expected);
  });
});

describe("parse", () => {
  it("undefined → all defaults", () => {
    expect(parse(undefined)).toEqual(DEFAULTS);
  });

  it("empty object → all defaults", () => {
    expect(parse({})).toEqual(DEFAULTS);
  });

  it("a valid value for each field is applied", () => {
    for (const f of CSS_FIELDS) {
      expect(parse({ [f.key]: "VALUE" })[f.field]).toBe("VALUE");
    }
    for (const t of TOKEN_SELECT_FIELDS) {
      expect(parse({ [t.key]: t.options[0] })[t.field]).toBe(t.options[0]);
    }
    for (const f of FLAG_FIELDS) {
      const flipped = !f.default;
      expect(parse({ [f.key]: flipped })[f.field]).toBe(flipped);
    }
  });

  it("a value of the wrong type falls back to the default (totality)", () => {
    for (const f of CSS_FIELDS) {
      expect(parse({ [f.key]: true })[f.field]).toBe(f.default);
    }
    for (const t of TOKEN_SELECT_FIELDS) {
      expect(parse({ [t.key]: true })[t.field]).toBe(CUSTOM_TOKEN);
    }
    for (const f of FLAG_FIELDS) {
      expect(parse({ [f.key]: "yes" })[f.field]).toBe(f.default);
    }
  });

  it("unknown keys are dropped", () => {
    const values: Record<string, SettingValue> = { junk: "x", other: true };
    expect(parse(values)).toEqual(DEFAULTS);
  });

  // Regression test for a code-review finding: a preset is a string, but not
  // by itself a valid CSS variable value — the board's value must be ∈
  // [CUSTOM_TOKEN, ...options], not an arbitrary string. The options list is
  // observed, not official (see the comment on HOST_COLOR_TOKENS) — it will
  // get edited, and a stale old value on someone's board shouldn't fly into
  // CSS as-is (the same class of silent breakage fixed in the first part of the task).
  it("a preset outside options (a stale value) falls back to custom, not into CSS", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      expect(parse({ [t.key]: "var(--obsolete-token)" })[t.field]).toBe(CUSTOM_TOKEN);
      expect(parse({ [t.key]: "" })[t.field]).toBe(CUSTOM_TOKEN);
    }
  });
});

describe("withUnit", () => {
  it.each([
    ["8", "8px"],
    ["8.5", "8.5px"],
    ["-8", "-8px"],
    ["0", "0px"],
  ])("bare number %s → %s", (raw, expected) => {
    expect(withUnit(raw, "px")).toBe(expected);
  });

  it.each([
    ["8px", "8px"],
    ["8rem", "8rem"],
    ["8%", "8%"],
    ["auto", "auto"],
    ["none", "none"],
    ["", ""],
  ])("a value with a unit/keyword/empty is unchanged: %s", (raw, expected) => {
    expect(withUnit(raw, "px")).toBe(expected);
  });
});

describe("toCssVars", () => {
  it("defaults produce every CSS variable with its value", () => {
    const vars = toCssVars(DEFAULTS);
    for (const f of CSS_FIELDS) {
      const expected = f.unit ? withUnit(f.default, f.unit) : f.default;
      expect(vars[f.cssVar]).toBe(expected);
    }
    expect(Object.keys(vars)).toHaveLength(CSS_FIELDS.length);
  });

  it("an empty field value excludes its variable (empty = CSS default)", () => {
    const s: KasimovSettings = { ...DEFAULTS, size: "" };
    const vars = toCssVars(s);
    expect(vars["--kasi-size"]).toBeUndefined();
    expect(Object.keys(vars)).toHaveLength(CSS_FIELDS.length - 1);
  });

  // Setting fields accept a bare number — the user doesn't have to write the
  // unit by hand; toCssVars appends px wherever size/gap/width expects it.
  // Unitless (lineHeight) and non-numeric (fonts, colors) fields are left
  // alone; a unit/keyword already given (px/auto/none) is left as-is.
  it.each([
    ["size", "18", "--kasi-size", "18px"],
    ["gap", "6", "--kasi-gap", "6px"],
    ["radius", "10", "--kasi-radius", "10px"],
    ["maxWidth", "720", "--kasi-max-width", "720px"],
    ["colMx", "20", "--kasi-col-mx", "20px"],
    ["padX", "32", "--kasi-pad-x", "32px"],
    ["paraGap", "8", "--kasi-para-gap", "8px"],
    ["listGap", "4", "--kasi-list-gap", "4px"],
  ] as const)("%s: bare number %s → %s: %s", (field, raw, cssVar, expected) => {
    const s: KasimovSettings = { ...DEFAULTS, [field]: raw };
    expect(toCssVars(s)[cssVar]).toBe(expected);
  });

  it("a value with a unit/keyword already given is unchanged", () => {
    const s: KasimovSettings = {
      ...DEFAULTS,
      size: "1.2rem",
      maxWidth: "none",
      colMx: "auto",
      padX: "5%",
    };
    const vars = toCssVars(s);
    expect(vars["--kasi-size"]).toBe("1.2rem");
    expect(vars["--kasi-max-width"]).toBe("none");
    expect(vars["--kasi-col-mx"]).toBe("auto");
    expect(vars["--kasi-pad-x"]).toBe("5%");
  });

  it("lineHeight is unitless — a bare number doesn't get px", () => {
    const s: KasimovSettings = { ...DEFAULTS, lineHeight: "1.8" };
    expect(toCssVars(s)["--kasi-line-height"]).toBe("1.8");
  });

  // A preset (select) overrides the text field while not set to "custom" —
  // exactly the behavior the owner asked for: pick a font/token from the
  // list, and the editor takes it instead of what's written in the text field next to it.
  it("a preset other than custom overrides the text field — for every target", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      const cssVar = CSS_FIELDS.find((f) => f.field === t.target)!.cssVar;
      const preset = t.options[0];
      const s: KasimovSettings = {
        ...DEFAULTS,
        [t.target]: "THIS-SHOULD-BE-IGNORED",
        [t.field]: preset,
      };
      expect(toCssVars(s)[cssVar]).toBe(preset);
    }
  });

  it("preset custom — the text field is used, as before — for every target", () => {
    for (const t of TOKEN_SELECT_FIELDS) {
      const cssVar = CSS_FIELDS.find((f) => f.field === t.target)!.cssVar;
      const s: KasimovSettings = {
        ...DEFAULTS,
        [t.target]: "EXPECTED-VALUE",
        [t.field]: CUSTOM_TOKEN,
      };
      expect(toCssVars(s)[cssVar]).toBe("EXPECTED-VALUE");
    }
  });

  // toCssVars is a standalone pure function over KasimovSettings, not just
  // over the result of parse() (which already narrowed the preset to
  // {custom, ...options}); here a hand-assembled object with "" in the preset
  // field checks that the guard branch behaves the same as custom, rather
  // than leaking "" into CSS.
  it("an empty preset value (assembled bypassing parse) also falls back to the text field", () => {
    const s: KasimovSettings = { ...DEFAULTS, fg: "#123456", fgToken: "" };
    expect(toCssVars(s)["--kasi-fg"]).toBe("#123456");
  });
});

describe("toFlags", () => {
  it("reflects the engine's boolean flags across all combinations", () => {
    for (const followLinks of [true, false]) {
      for (const frontmatter of [true, false]) {
        for (const atLinks of [true, false]) {
          const s: KasimovSettings = {
            ...DEFAULTS,
            followLinks,
            frontmatter,
            atLinks,
          };
          expect(toFlags(s)).toMatchObject({ followLinks, frontmatter, atLinks });
        }
      }
    }
  });

  it("mermaidContrast → the engine's string mermaidNodes", () => {
    expect(toFlags({ ...DEFAULTS, mermaidContrast: true }).mermaidNodes).toBe(
      "contrast",
    );
    expect(toFlags({ ...DEFAULTS, mermaidContrast: false }).mermaidNodes).toBe(
      "soft",
    );
  });
});

describe("kasimovCssRule", () => {
  it("an empty set of variables → null", () => {
    expect(kasimovCssRule("kasi-host-1", {})).toBeNull();
  });

  it("assembles a rule by ID selector, targeting .mde-root", () => {
    const rule = kasimovCssRule("kasi-host-1", {
      "--kasi-size": "18px",
      "--kasi-accent": "#0af",
    });
    expect(rule).toBe(
      "#kasi-host-1 .mde-root { --kasi-size: 18px; --kasi-accent: #0af; }",
    );
  });

  // Values arrive as bare strings from the settings board, without form
  // validation — a character that could close the rule early and leak into
  // neighboring CSS is dropped entirely, rather than reaching document.head as-is.
  it.each([
    ["value with }", { "--kasi-size": "1px } * { display: none " }],
    ["value with {", { "--kasi-size": "1px { evil: 1" }],
    ["value with ;", { "--kasi-size": "1px; --evil: 1" }],
    ["value with <", { "--kasi-size": "1<px" }],
    ["value with >", { "--kasi-size": "1>px" }],
    ["variable name with }", { "--kasi-size}x": "18px" }],
  ])("drops the pair: %s", (_label, vars) => {
    expect(kasimovCssRule("kasi-host-1", vars)).toBeNull();
  });

  it("drops only the unsafe pair, safe ones remain", () => {
    const rule = kasimovCssRule("kasi-host-1", {
      "--kasi-size": "1px } * { display: none ",
      "--kasi-accent": "#0af",
    });
    expect(rule).toBe("#kasi-host-1 .mde-root { --kasi-accent: #0af; }");
  });

  it("the result never contains an internal `}` — the closing one is always the only one", () => {
    const adversarial = [
      "1px",
      "1px }",
      "} } }",
      "1px; } * { color:red",
      "normal",
    ];
    for (const value of adversarial) {
      const rule = kasimovCssRule("kasi-host-1", { "--kasi-size": value });
      if (rule === null) continue;
      expect(rule.indexOf("}")).toBe(rule.length - 1);
    }
  });
});
