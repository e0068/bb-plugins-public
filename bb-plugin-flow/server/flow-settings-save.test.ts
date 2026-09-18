// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stageKindOf } from "../lib/stage-constants";
import { createFlowSettings } from "./flow-settings";

describe("сохранение коллекции flow", () => {
  it("записанная без версии коллекция читается той же: удалённый Выбор этапов не возвращается", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const first = await createFlowSettings(bb.storage.kv);
    const stages = [{ id: "task", kind: "skill" as const, skill: "task-flow", name: "Задача", executors: [] }];
    await first.save({ flows: [{ id: "default", name: "Default", stages }], minButtonWidth: 170 });
    const again = await createFlowSettings(bb.storage.kv);
    expect(again.current().flows[0]!.stages.map(stageKindOf)).toEqual(["skill"]);
    expect(again.current().version).toBe(2);
  });
});
