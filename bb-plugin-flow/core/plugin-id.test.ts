// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OWN_PLUGIN_ID } from "./plugin-id";

describe("OWN_PLUGIN_ID", () => {
  it("это имя пакета без префикса bb-plugin- — id, под которым bb ставит плагин", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; bb: { name: string } };
    expect(pkg.name).toBe("bb-plugin-flow");
    expect(OWN_PLUGIN_ID).toBe(pkg.name.slice("bb-plugin-".length));
    expect(pkg.bb.name).toBe("Flow");
  });
});
