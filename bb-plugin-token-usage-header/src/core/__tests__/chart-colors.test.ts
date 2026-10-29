import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  agentColor,
  CHART_COLOR_SCHEMES,
  modelColor,
  modelFamily,
  parseChartColorScheme,
  type ChartColorScheme,
} from "../chart-colors";

describe("modelFamily — which Claude family an exact model id belongs to", () => {
  it.each([
    ["claude-fable-5-1", "fable"],
    ["claude-opus-4-8", "opus"],
    ["claude-sonnet-4", "sonnet"],
    ["claude-haiku-4-5-20251001", "haiku"],
    ["CLAUDE-OPUS-4-8", "opus"],
  ])("%s is %s", (id, family) => {
    expect(modelFamily(id)).toBe(family);
  });

  it.each([["gpt-5-codex"], ["kimi-for-coding"], ["moonshot/kimi-k2"], ["opus-clone"], [""], [null], [undefined]])(
    "%s belongs to no Claude family",
    (id) => {
      expect(modelFamily(id)).toBeUndefined();
    },
  );
});

describe("modelColor — the one table from model to colour", () => {
  it("paints Fable white in the dark theme and light grey in the light one, where white would vanish on the card", () => {
    expect(modelColor("claude-fable-5-1", "dark")).toBe("#ffffff");
    expect(modelColor("claude-fable-5-1", "light")).toBe("#d4d4d8");
  });

  it("paints Opus yellow, Sonnet orange and Haiku dark orange, the same in both themes", () => {
    for (const mode of ["dark", "light"] as const) {
      expect(modelColor("claude-opus-4-8", mode)).toBe("#facc15");
      expect(modelColor("claude-sonnet-4", mode)).toBe("#f97316");
      expect(modelColor("claude-haiku-4-5", mode)).toBe("#c2410c");
    }
  });

  it("has no colour for a model outside the Claude families", () => {
    expect(modelColor("gpt-5-codex", "dark")).toBeUndefined();
    expect(modelColor(undefined, "light")).toBeUndefined();
  });
});

describe("parseChartColorScheme — a stored value becomes a scheme, whatever it holds", () => {
  it.each(CHART_COLOR_SCHEMES)("keeps the stored %s", (scheme) => {
    expect(parseChartColorScheme(scheme, false)).toBe(scheme);
    expect(parseChartColorScheme(scheme, true)).toBe(scheme);
  });

  it("falls back to Reduced Colors for an owner who had it on before schemes existed", () => {
    expect(parseChartColorScheme(undefined, true)).toBe("reduced");
  });

  it("falls back to the palette when nothing is stored and Reduced Colors was off", () => {
    expect(parseChartColorScheme(undefined, false)).toBe("palette");
  });

  it("treats an unknown stored value as nothing stored", () => {
    expect(parseChartColorScheme("rainbow", true)).toBe("reduced");
    expect(parseChartColorScheme(42, false)).toBe("palette");
  });
});

describe("agentColor — which colour an agent's columns get", () => {
  const base = { theme: "dark", fallback: "#3b82f6" } as const;

  it("paints a Claude agent by its model under the model scheme", () => {
    expect(agentColor({ ...base, scheme: "model", model: "claude-opus-4-8", manual: undefined })).toBe("#facc15");
  });

  it("paints an agent of another provider with the palette colour under the model scheme", () => {
    expect(agentColor({ ...base, scheme: "model", model: "gpt-5-codex", manual: undefined })).toBe("#3b82f6");
    expect(agentColor({ ...base, scheme: "model", model: undefined, manual: undefined })).toBe("#3b82f6");
  });

  it("lets a colour picked in the legend beat the model", () => {
    expect(agentColor({ ...base, scheme: "model", model: "claude-opus-4-8", manual: "#112233" })).toBe("#112233");
  });

  it("leaves the palette colour alone under the palette and Reduced Colors schemes", () => {
    for (const scheme of ["palette", "reduced"] as const) {
      expect(agentColor({ ...base, scheme, model: "claude-opus-4-8", manual: undefined })).toBe("#3b82f6");
    }
  });

  it("is total: any scheme, theme and model gives a colour, and a manual pick always wins under the model scheme", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ChartColorScheme>(...CHART_COLOR_SCHEMES),
        fc.constantFrom("light", "dark"),
        fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
        fc.oneof(fc.constant("#abcdef"), fc.constant(undefined)),
        (scheme, theme, model, manual) => {
          const color = agentColor({ scheme, theme, model, manual, fallback: manual ?? "#3b82f6" });
          expect(color).toMatch(/^#[0-9a-f]{6}$/i);
          if (scheme === "model" && manual) expect(color).toBe(manual);
        },
      ),
    );
  });
});
