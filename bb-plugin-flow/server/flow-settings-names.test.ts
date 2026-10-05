// @vitest-environment node
// Имя flow — имя его файла в папке синхронизации, поэтому оно уникально; а
// синхронизация узнаёт о каждом сохранении слушателем.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";

const stages = [{ id: "task", kind: "skill" as const, skill: "task-flow", name: "Задача", executors: [] }];
const flow = (id: string, name: string) => ({ id, name, stages });

describe("имена flow в коллекции", () => {
  it("сохранение с повтором имени без учёта регистра отказывает и коллекцию не меняет", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const settings = await createFlowSettings(bb.storage.kv);
    const before = settings.current();
    await expect(settings.save({ flows: [flow("a", "Code"), flow("b", "code")], minButtonWidth: 170 })).rejects.toThrow(/code/);
    expect(settings.current()).toBe(before);
  });

  it("записанная раньше коллекция с повтором имён читается с номерами и пишется сразу", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    await bb.storage.kv.set(FLOW_SETTINGS_KEY, { version: 2, flows: [flow("a", "Code"), flow("b", "Code")], minButtonWidth: 170 });
    const settings = await createFlowSettings(bb.storage.kv);
    expect(settings.current().flows.map((f) => f.name)).toEqual(["Code", "Code 2"]);
    expect(((await bb.storage.kv.get(FLOW_SETTINGS_KEY)) as { flows: Array<{ name: string }> }).flows.map((f) => f.name)).toEqual(["Code", "Code 2"]);
  });
});

describe("слушатель сохранения", () => {
  it("каждое сохранение доходит до слушателя уже записанной коллекцией", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const settings = await createFlowSettings(bb.storage.kv);
    const heard: string[][] = [];
    settings.onSaved((saved) => heard.push(saved.flows.map((f) => f.name)));
    await settings.save({ flows: [flow("a", "Code")], minButtonWidth: 170 });
    await settings.save({ flows: [flow("a", "Code"), flow("b", "Bug")], minButtonWidth: 170 });
    expect(heard).toEqual([["Code"], ["Code", "Bug"]]);
  });

  it("отказ сохранения до слушателя не доходит", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const settings = await createFlowSettings(bb.storage.kv);
    const heard: unknown[] = [];
    settings.onSaved((saved) => heard.push(saved));
    await settings.save({ flows: [flow("a", "A"), flow("b", "a")], minButtonWidth: 170 }).catch(() => undefined);
    expect(heard).toEqual([]);
  });
});
