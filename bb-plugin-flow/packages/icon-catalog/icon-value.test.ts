import { describe, expect, it } from "vitest";
import { EMOJI, ICON_CATALOG, iconValue, parseIcon, type Icon } from "./index";

const lines: Icon[] = [...ICON_CATALOG.keys()].map((name) => ({ kind: "line", name }));
const filled: Icon[] = [...ICON_CATALOG.keys()].map((name) => ({ kind: "filled", name }));
const emoji: Icon[] = EMOJI.map(({ char }) => ({ kind: "emoji", char }));

describe("an icon is one stored text of three kinds", () => {
  it("reads a catalog name as the line icon a board saved before the kinds existed", () => {
    expect(parseIcon("Rocket")).toEqual({ kind: "line", name: "Rocket" });
  });

  it("reads filled:<name> as the same icon on a tile", () => {
    expect(parseIcon("filled:Rocket")).toEqual({ kind: "filled", name: "Rocket" });
  });

  it("reads an emoji as itself", () => {
    expect(parseIcon("🚀")).toEqual({ kind: "emoji", char: "🚀" });
    expect(parseIcon("👩‍💻")).toEqual({ kind: "emoji", char: "👩‍💻" });
  });

  it("gives back every icon it reads, unchanged", () => {
    for (const icon of [...lines, ...filled, ...emoji]) expect(parseIcon(iconValue(icon))).toEqual(icon);
  });

  it("stores a line icon as its bare name, so an older plugin still draws it", () => {
    expect(iconValue({ kind: "line", name: "Rocket" })).toBe("Rocket");
  });

  it("reads nothing out of what is no icon", () => {
    for (const raw of [undefined, "", " ", "NoSuchIcon", "filled:", "filled:NoSuchIcon", "line:Rocket", "abc", "1️⃣", "🚀 rocket", "🚀".repeat(9)]) {
      expect(parseIcon(raw), String(raw)).toBeNull();
    }
  });
});

describe("the emoji the Emoji tab offers", () => {
  it("holds a few hundred, each once, each with English words to find it by", () => {
    expect(EMOJI.length).toBeGreaterThan(200);
    expect(new Set(EMOJI.map(({ char }) => char)).size).toBe(EMOJI.length);
    for (const { char, words } of EMOJI) expect(words, char).toMatch(/^[a-z]+( [a-z]+)*$/);
  });

  it("are all read back as emoji", () => {
    for (const { char } of EMOJI) expect(parseIcon(char), char).toEqual({ kind: "emoji", char });
  });
});
