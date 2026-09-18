// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { newFlow } from "../core/flows";
import { stageKindOf } from "../lib/stage-constants";
import { createFlowSettings, FLOW_SETTINGS_KEY, LEGACY_STAGE_SETTINGS_KEY } from "./flow-settings";

const host = () => createFakePluginHost({ pluginId: "flow" }).bb;

describe("хранение flow версии 2", () => {
  it("запись старого ключа переезжает во flow Default с видами и Демонстрацией за этапом с Review, старый ключ остаётся", async () => {
    const bb = host();
    const planner = { id: "agent:planner", kind: "agent", name: "planner" };
    const legacy = { stages: [{ id: "plan", skill: "plan", name: "План", review: true, executors: [planner] }], minButtonWidth: 240 };
    await bb.storage.kv.set(LEGACY_STAGE_SETTINGS_KEY, legacy);
    const settings = await createFlowSettings(bb.storage.kv);
    const stages = settings.current().flows[0]!.stages;
    expect(stages.map(stageKindOf)).toEqual(["questions", "criteria", "select", "skill", "demo"]);
    expect(stages[3]).toEqual({ id: "plan", kind: "skill", skill: "plan", name: "План", executors: [planner] });
    expect(settings.current().minButtonWidth).toBe(240);
    expect(await bb.storage.kv.get(FLOW_SETTINGS_KEY)).toEqual(settings.current());
    expect(await bb.storage.kv.get(LEGACY_STAGE_SETTINGS_KEY)).toEqual(legacy);
  });

  it("сохранённая коллекция версии 2 сразу видна и читается новым хранилищем как есть", async () => {
    const bb = host();
    const first = await createFlowSettings(bb.storage.kv);
    const next = { flows: [newFlow("default", "Default"), newFlow("quick", "Quick")], minButtonWidth: 180, version: 2 as const };
    await first.save(next);
    expect(first.current()).toEqual(next);
    expect((await createFlowSettings(bb.storage.kv)).current()).toEqual(next);
  });
});
