// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stageKindOf } from "../lib/stage-constants";
import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";

const host = () => createFakePluginHost({ pluginId: "flow" }).bb;

const v1 = {
  flows: [{ id: "default", name: "Default", stages: [{ id: "clarify", skill: "", name: "Clarification", review: false, executors: [] }, { id: "task", skill: "task-flow", name: "Задача", review: true, executors: [] }] }],
  minButtonWidth: 170,
};

describe("перенос сохранённой коллекции flow", () => {
  it("коллекция без версии переносится и записывается версией 2", async () => {
    const bb = host();
    await bb.storage.kv.set(FLOW_SETTINGS_KEY, v1);
    const settings = await createFlowSettings(bb.storage.kv);
    expect(settings.current().version).toBe(2);
    expect(settings.current().flows[0]!.stages.map(stageKindOf)).toEqual(["questions", "select", "skill", "demo"]);
    expect(await bb.storage.kv.get(FLOW_SETTINGS_KEY)).toEqual(settings.current());
  });

  it("удалённый владельцем Выбор этапов не возвращается при следующем чтении", async () => {
    const bb = host();
    await bb.storage.kv.set(FLOW_SETTINGS_KEY, v1);
    const first = await createFlowSettings(bb.storage.kv);
    const current = first.current();
    await first.save({ ...current, flows: current.flows.map((f) => ({ ...f, stages: f.stages.filter((s) => stageKindOf(s) !== "select") })) });
    const again = await createFlowSettings(bb.storage.kv);
    expect(again.current().flows[0]!.stages.map(stageKindOf)).not.toContain("select");
  });
});
