// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TASKS_PLUGIN_ID } from "./plugin-id";

describe("TASKS_PLUGIN_ID", () => {
  it("is the id bb derives from the package name", () => {
    const { name } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string };
    expect(`bb-plugin-${TASKS_PLUGIN_ID}`).toBe(name);
  });
});
