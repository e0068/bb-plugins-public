// @vitest-environment node
import { describe, expect, it } from "vitest";

import { installedPlugins } from "./catalog";

describe("ключи плагинов Claude Code", () => {
  it("ключ enabledPlugins и имя до @ у каждого включённого плагина", () => {
    const installed = JSON.stringify({ plugins: { "figma@official": [{ installPath: "/p/figma" }], "off@market": [{ installPath: "/p/off" }] } });
    expect(installedPlugins(installed, JSON.stringify({ enabledPlugins: { "off@market": false } }))).toEqual([{ key: "figma@official", plugin: "figma", dir: "/p/figma" }]);
  });
});
