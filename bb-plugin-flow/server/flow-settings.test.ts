// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { DEFAULT_STAGES, newFlow } from "../core/flows";
import { createFlowSettings, FLOW_SETTINGS_KEY, LEGACY_STAGE_SETTINGS_KEY } from "./flow-settings";

const host = () => createFakePluginHost({ pluginId: "flow" }).bb;

describe("хранение flow", () => {
  it("без записей — один flow Default с этапами по умолчанию", async () => {
    const settings = await createFlowSettings(host().storage.kv);
    expect(settings.current().flows).toEqual([{ id: "default", name: "Default", stages: DEFAULT_STAGES }]);
  });

  it("битая запись коллекции даёт умолчания", async () => {
    const bb = host();
    await bb.storage.kv.set(FLOW_SETTINGS_KEY, { flows: [] });
    expect((await createFlowSettings(bb.storage.kv)).current().flows.map((f) => f.id)).toEqual(["default"]);
  });

});
