import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "../server";

describe("bb tasks help — plan dates", () => {
  it("names the day-with-time form of --start and --due", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    for (const command of ["create", "update"]) {
      const result = await harness.runCli([command, "--help"]);
      expect(result.stdout).toContain("--due YYYY-MM-DD[THH:mm]");
      expect(result.stdout).toContain("--start YYYY-MM-DD[THH:mm]");
    }
    await harness.dispose();
  });
});
