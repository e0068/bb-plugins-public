import { describe, expect, it } from "vitest";

import {
  decideMcpOwn,
  resolveEnableAllMcp,
  resolveMcpServer,
  resolvePlugin,
  resolveSkill,
  resolveToolSearch,
} from "../src/effective";

describe("resolving levels", () => {
  it("a narrower level overrides a wider one", () => {
    expect(resolvePlugin(["on", "off"])).toBe("off");
    expect(resolvePlugin(["off", "on"])).toBe("on");
  });

  it("a level without a value is skipped", () => {
    expect(resolvePlugin(["on", "inherit"])).toBe("on");
    expect(resolveSkill(["off", "inherit"])).toBe("off");
  });

  it("no value anywhere — falls back to the Claude Code default", () => {
    // No plugin entry in settings — it's off.
    expect(resolvePlugin(["inherit", "inherit"])).toBe("off");
    expect(resolvePlugin([])).toBe("off");
    // A skill without an override is fully visible.
    expect(resolveSkill(["inherit"])).toBe("on");
    // ENABLE_TOOL_SEARCH unset — Claude Code behaves as auto.
    expect(resolveToolSearch(["inherit"])).toBe("auto");
  });

  it("resolves all skill states", () => {
    expect(resolveSkill(["on", "name-only"])).toBe("name-only");
    expect(resolveSkill(["off", "user-invocable-only"])).toBe(
      "user-invocable-only",
    );
  });

  it("resolves tool-search loading modes", () => {
    expect(resolveToolSearch(["on", "auto"])).toBe("auto");
    expect(resolveToolSearch(["auto", "off"])).toBe("off");
  });

  it("MCP server: an explicit value outranks the enableAll default", () => {
    // With no entry, the default depends on enableAll.
    expect(resolveMcpServer(["inherit"], false)).toBe("off");
    expect(resolveMcpServer(["inherit"], true)).toBe("on");
    // An explicit off overrides enableAll; a narrower level overrides a wider one.
    expect(resolveMcpServer(["off"], true)).toBe("off");
    expect(resolveMcpServer(["on", "off"], false)).toBe("off");
  });

  it("enableAll resolves to the last level that set it", () => {
    expect(resolveEnableAllMcp([])).toBe(false);
    expect(resolveEnableAllMcp([true, undefined])).toBe(true);
    expect(resolveEnableAllMcp([true, false])).toBe(false);
  });

  describe("decideMcpOwn — minimal connector entry", () => {
    it("matches the higher levels — drops the override", () => {
      expect(decideMcpOwn(["on"], [undefined, undefined], "on")).toBe("inherit");
      expect(decideMcpOwn([], [undefined], "off")).toBe("inherit");
    });

    it("differs — sets it explicitly", () => {
      expect(decideMcpOwn(["on"], [undefined, undefined], "off")).toBe("off");
      expect(decideMcpOwn([], [undefined], "on")).toBe("on");
    });

    it("enableAll on the level being edited is accounted for when dropping the override", () => {
      // Bug case: enableAll:true in the very file being edited, the server is
      // never set explicitly anywhere → effectively on. Turning it off: inherit
      // would leave it on, so an explicit off is required. enableAllLevels
      // includes the level of the file being edited.
      expect(decideMcpOwn([], [true], "off")).toBe("off");
      // Same enableAll, turning it on — inherit already gives on.
      expect(decideMcpOwn([], [true], "on")).toBe("inherit");
    });
  });
});
