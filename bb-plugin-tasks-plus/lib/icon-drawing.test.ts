import { describe, expect, it } from "vitest";
import { colorsOf, iconChoices, iconDrawing, recolored } from "./icon-drawing";

const paints = (raw: string, bearer?: string) => {
  const drawing = iconDrawing(raw, null, bearer);
  return drawing?.kind === "glyph" ? { ink: drawing.ink, tile: drawing.tile } : drawing;
};

describe("the colours an icon is drawn in", () => {
  it.each([
    ["Rocket", "steelblue", { ink: { color: "steelblue" }, tile: undefined }],
    ["Rocket;c=indianred", "steelblue", { ink: { color: "indianred" }, tile: undefined }],
    ["Rocket", undefined, { ink: undefined, tile: undefined }],
    ["Rocket;c=white", "steelblue", { ink: "foreground", tile: undefined }],
    ["filled:Rocket", "steelblue", { ink: { color: "white" }, tile: { color: "steelblue" } }],
    ["filled:Rocket", "black", { ink: "background", tile: "foreground" }],
    ["filled:ph:rocket", "steelblue", { ink: { color: "steelblue" }, tile: undefined }],
    ["filled:ph:rocket;bg=goldenrod", "steelblue", { ink: { color: "white" }, tile: { color: "goldenrod" } }],
    ["filled:ph:rocket;c=black;bg=goldenrod", undefined, { ink: { color: "black" }, tile: { color: "goldenrod" } }],
  ])("%s on a %s bearer", (raw, bearer, expected) => {
    expect(paints(raw, bearer)).toEqual(expected);
  });
});

describe("recolouring an icon", () => {
  it("keeps the sign and swaps the colours, and leaves an emoji as it is", () => {
    expect(recolored("filled:ph:star;c=red;bg=blue", { color: "white" })).toBe("filled:ph:star;c=white");
    expect(recolored("ph:star", { color: "red", background: "blue" })).toBe("ph:star;c=red");
    expect(recolored("🚀", { color: "red" })).toBe("🚀");
    expect(colorsOf("filled:ph:star;c=red;bg=blue")).toEqual({ color: "red", background: "blue" });
    expect(colorsOf("🚀")).toEqual({});
  });
});

describe("the choices of each tab", () => {
  it("lists Hugeicons before Phosphor on Line, only Phosphor's filled signs on Filled, every emoji with no query", () => {
    const line = iconChoices("line", "rocket").map(({ value }) => value);
    expect(line.indexOf("Rocket")).toBeLessThan(line.indexOf("ph:rocket"));
    expect(iconChoices("filled", "rocket").every(({ value }) => value.startsWith("filled:ph:"))).toBe(true);
    expect(iconChoices("emoji", "").length).toBeGreaterThan(200);
  });
});

describe("a black or white icon on a black or white tile", () => {
  it.each(["filled:ph:rocket;c=white;bg=black", "filled:ph:rocket;c=black;bg=white"])("%s keeps its line the tile's opposite on either theme", (raw) => {
    expect(paints(raw)).toEqual({ ink: "background", tile: "foreground" });
  });
});
