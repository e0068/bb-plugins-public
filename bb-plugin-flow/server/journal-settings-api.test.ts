// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createJournalDirStore } from "./dir-settings";
import { registerJournalSettingsApi } from "./journal-settings-api";

const setup = () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      projects: {
        list: async () => [
          { id: "proj_1", name: "bb-plugins" },
          { id: "proj_2", name: "Corpus" },
        ],
      },
    },
  });
  const dirs = createJournalDirStore(bb.storage.kv);
  registerJournalSettingsApi(bb, dirs);
  return { harness, dirs };
};

describe("RPC настроек пути журнала", () => {
  it("getJournalProjects сшивает список проектов с настроенными путями", async () => {
    const { harness, dirs } = setup();
    await dirs.set("proj_1", "memory/decisions");
    expect(await harness.callRpc("getJournalProjects", {})).toEqual([
      { id: "proj_1", name: "bb-plugins", path: "memory/decisions" },
      { id: "proj_2", name: "Corpus", path: null },
    ]);
  });

  it("setJournalDir сохраняет и отражается в следующем getJournalProjects", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("setJournalDir", { projectId: "proj_2", path: "docs/decisions" })).toEqual({ kind: "saved", path: "docs/decisions" });
    expect(await harness.callRpc("getJournalProjects", {})).toEqual([
      { id: "proj_1", name: "bb-plugins", path: null },
      { id: "proj_2", name: "Corpus", path: "docs/decisions" },
    ]);
  });

  it("setJournalDir с абсолютным путём — invalid, не сохраняет", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("setJournalDir", { projectId: "proj_1", path: "/etc" })).toEqual({ kind: "invalid", reason: "absolute" });
  });
});
