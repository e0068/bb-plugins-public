import { describe, expect, it } from "vitest";
import { touchedPluginIds } from "./plugin-paths";

describe("touchedPluginIds", () => {
  it("no changed paths — nothing touched", () => {
    expect(touchedPluginIds([])).toEqual([]);
  });

  it("paths outside any bb-plugin-* directory are ignored", () => {
    expect(touchedPluginIds(["docs/INDEX.md", "README.md", "packages/plugin-base/tsconfig.json"])).toEqual([]);
  });

  it("a path inside a plugin directory yields that plugin's id", () => {
    expect(touchedPluginIds(["bb-plugin-plugins-monitor/server.ts"])).toEqual(["plugins-monitor"]);
  });

  it("several files in the same plugin directory yield the id once", () => {
    expect(
      touchedPluginIds([
        "bb-plugin-zz-pull-request/server.ts",
        "bb-plugin-zz-pull-request/app.tsx",
        "bb-plugin-zz-pull-request/src/core/plugin-paths.ts",
      ]),
    ).toEqual(["zz-pull-request"]);
  });

  it("files across several plugin directories yield each id once, first-seen order", () => {
    expect(
      touchedPluginIds([
        "bb-plugin-tasks-plus/server.ts",
        "docs/INDEX.md",
        "bb-plugin-plugins-monitor/app.tsx",
        "bb-plugin-tasks-plus/app.tsx",
      ]),
    ).toEqual(["tasks-plus", "plugins-monitor"]);
  });
});
