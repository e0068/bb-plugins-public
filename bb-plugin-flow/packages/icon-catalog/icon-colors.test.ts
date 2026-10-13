import { describe, expect, it } from "vitest";
import { iconValue, parseIcon, PHOSPHOR_FILL, PHOSPHOR_LINE, type Icon } from "./index";

describe("an icon names its set and carries its own colours", () => {
  it("reads ph:<name> as a Phosphor line sign and filled:ph:<name> as its filled one", () => {
    expect(parseIcon("ph:rocket")).toEqual({ kind: "line", name: "rocket", set: "phosphor" });
    expect(parseIcon("filled:ph:rocket")).toEqual({ kind: "filled", name: "rocket", set: "phosphor" });
  });

  it("reads the line colour and the tile colour after the sign", () => {
    expect(parseIcon("Rocket;c=steelblue")).toEqual({ kind: "line", name: "Rocket", color: "steelblue" });
    expect(parseIcon("filled:ph:rocket;c=white;bg=#3b82f6")).toEqual({ kind: "filled", name: "rocket", set: "phosphor", color: "white", background: "#3b82f6" });
    expect(parseIcon("filled:Rocket;bg=indianred")).toEqual({ kind: "filled", name: "Rocket", background: "indianred" });
  });

  it("gives back every coloured icon it reads, unchanged", () => {
    const icons: Icon[] = [
      { kind: "line", name: "Folder01", color: "slateblue" },
      { kind: "line", name: "folder-simple", set: "phosphor", color: "#fff" },
      { kind: "filled", name: "star", set: "phosphor" },
      { kind: "filled", name: "star", set: "phosphor", color: "black", background: "goldenrod" },
      { kind: "filled", name: "Rocket", color: "white" },
    ];
    for (const icon of icons) expect(parseIcon(iconValue(icon))).toEqual(icon);
  });

  it("reads nothing out of a sign the set lacks or a colour that is no colour", () => {
    for (const raw of [
      "ph:NoSuchIcon",
      "ph:Rocket",
      "filled:ph:",
      "Rocket;",
      "Rocket;c=",
      "Rocket;c=red;c=blue",
      "Rocket;bg=red",
      "Rocket;x=red",
      "Rocket;c=red\" onload=\"x",
      "Rocket;c=url(#a)",
      "filled:ph:rocket;bg=#12",
      "🚀;c=red",
    ]) {
      expect(parseIcon(raw), raw).toBeNull();
    }
  });
});

describe("Phosphor's signs", () => {
  it("hold every sign in both weights, each with something to draw", () => {
    expect(PHOSPHOR_LINE.size).toBe(1512);
    expect(PHOSPHOR_FILL.size).toBe(1512);
    expect([...PHOSPHOR_LINE.keys()]).toEqual([...PHOSPHOR_FILL.keys()]);
    for (const [name, paths] of [...PHOSPHOR_LINE, ...PHOSPHOR_FILL]) expect(paths.length > 0 && paths.every((d) => d.length > 0), name).toBe(true);
  });
});
