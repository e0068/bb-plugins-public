import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GLYPH_OVERRIDES, glyphOverrideCss, svgDataUri } from "./row-glyph-css";

describe("svgDataUri", () => {
  // The URI is inlined inside a double-quoted CSS url(), so anything that
  // could close that string early — a quote, or the `#` that starts a
  // fragment — must not survive encoding.
  it("no encoded document carries a raw quote, # or angle bracket", () => {
    fc.assert(
      fc.property(fc.string(), (body) => {
        const uri = svgDataUri(`<svg>${body}</svg>`);
        const payload = uri.slice("data:image/svg+xml,".length);
        expect(payload).not.toMatch(/["<>#]/);
      }),
    );
  });

  it("encoding is reversible — the drawing survives the trip verbatim", () => {
    fc.assert(
      fc.property(fc.string(), (svg) => {
        const uri = svgDataUri(svg);
        expect(decodeURIComponent(uri.slice("data:image/svg+xml,".length))).toBe(svg);
      }),
    );
  });
});

describe("glyphOverrideCss", () => {
  const css = glyphOverrideCss(GLYPH_OVERRIDES);

  it("pins every rule to the sidebar's own trailing-indicator slot", () => {
    for (const line of css.split("\n")) {
      expect(line).toContain("[data-sidebar-thread-trailing-indicator]");
    }
  });

  // Both halves of the selector matter: the icon name alone could match
  // another plugin's glyph in the same slot, and the label is this plugin's
  // own text — together they name exactly our own drawing.
  it("each override matches on both the host icon name and our own label", () => {
    for (const { icon, label } of GLYPH_OVERRIDES) {
      expect(css).toContain(`[data-icon="${icon}"][aria-label="${label}"]`);
    }
  });

  it("draws the replacement as a mask over currentColor, in both property spellings", () => {
    expect(css).toContain("background-color:currentColor");
    expect(css).toContain("mask-image:url(");
    expect(css).toContain("-webkit-mask-image:url(");
  });

  it("hides the host's own paths, or the replacement would sit on top of them", () => {
    for (const { icon, label } of GLYPH_OVERRIDES) {
      expect(css).toContain(`[data-icon="${icon}"][aria-label="${label}"]>*{display:none}`);
    }
  });

  it("nothing to override → no CSS at all, so an empty <style> is never injected", () => {
    expect(glyphOverrideCss([])).toBe("");
  });
});

describe("GLYPH_OVERRIDES", () => {
  // The label is what ties the CSS to the glyph; a typo here silently stops
  // the override without breaking anything visible in a test of either side.
  it("covers exactly the two pre-PR git glyphs, by their status labels", () => {
    expect(GLYPH_OVERRIDES.map(({ label }) => label)).toEqual([
      "Uncommitted changes",
      "Committed changes",
    ]);
  });
});
