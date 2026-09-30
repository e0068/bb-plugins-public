// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { ROOT_SKILL } from "../lib/stage-constants";
import type { FlowSettings, StageCatalog } from "../shared/contract";
import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";
import { createLegacyHeal } from "./legacy-heal";
import { registerFlowSettingsApi } from "./settings-api";

const questions = { id: "questions", kind: "questions" as const, skill: "", name: "Questions", executors: [] };
const stored: FlowSettings = {
  flows: [{ id: "default", name: "Default", stages: [questions, stage("task", { skill: "task-flow", name: "Task" }), stage("spec", { skill: "spec", name: "Spec" })] }],
  minButtonWidth: 170,
  version: 2,
};
const catalogOf = (...skills: string[]): StageCatalog => ({ skills: skills.map((name) => ({ name })), executors: [] });

const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(FLOW_SETTINGS_KEY, stored);
  const flows = await createFlowSettings(bb.storage.kv);
  const heal = createLegacyHeal(bb.storage.kv, flows);
  const ids = () => flows.current().flows[0]!.stages.map((s) => s.id);
  return { bb, harness, flows, heal, ids };
};

describe("чистка этапов прежнего flow по умолчанию на сервере", () => {
  it("убирает этапы без навыка и пишет коллекцию в хранилище", async () => {
    const { bb, heal, ids } = await setup();
    await heal.run(catalogOf(ROOT_SKILL));
    expect(ids()).toEqual(["questions"]);
    expect((await createFlowSettings(bb.storage.kv)).current().flows[0]!.stages.map((s) => s.id)).toEqual(["questions"]);
    expect(heal.done()).toBe(true);
  });

  it("идёт один раз: этап, поставленный после чистки, следующая не трогает", async () => {
    const { flows, heal, ids } = await setup();
    await heal.run(catalogOf(ROOT_SKILL));
    await flows.save(stored);
    await heal.run(catalogOf(ROOT_SKILL));
    expect(ids()).toEqual(["questions", "task", "spec"]);
  });

  it("прошедшая в прежнем процессе чистка не повторяется в новом", async () => {
    const { bb, flows, heal } = await setup();
    await heal.run(catalogOf(ROOT_SKILL));
    await flows.save(stored);
    const next = createLegacyHeal(bb.storage.kv, flows);
    await next.run(catalogOf(ROOT_SKILL));
    expect(flows.current().flows[0]!.stages.map((s) => s.id)).toEqual(["questions", "task", "spec"]);
    expect(next.done()).toBe(true);
  });

  it("непрочитанный каталог ничего не удаляет и откладывает чистку до прочитанного", async () => {
    const { heal, ids } = await setup();
    await heal.run(catalogOf());
    expect(ids()).toEqual(["questions", "task", "spec"]);
    expect(heal.done()).toBe(false);
    await heal.run(catalogOf(ROOT_SKILL, "spec"));
    expect(ids()).toEqual(["questions", "spec"]);
  });

  it("у владельца со всеми навыками коллекция не меняется, а чистка считается прошедшей", async () => {
    const { heal, ids } = await setup();
    await heal.run(catalogOf(ROOT_SKILL, "task-flow", "spec"));
    expect(ids()).toEqual(["questions", "task", "spec"]);
    expect(heal.done()).toBe(true);
  });

  it("страница Flow первым же чтением получает уже вылеченную коллекцию, хоть каталог ещё никто не читал", async () => {
    const { bb, harness, flows, heal } = await setup();
    const catalog = async () => {
      const read = catalogOf(ROOT_SKILL);
      await heal.run(read);
      return read;
    };
    registerFlowSettingsApi(bb, flows, {
      catalog,
      ready: async () => {
      if (!heal.done()) await catalog();
    },
      skillFile: async () => null,
      reveal: async () => ({ revealed: false, error: null }),
    });
    const page = (await harness.callRpc("getFlowSettings", {})) as FlowSettings;
    expect(page.flows[0]!.stages.map((s) => s.id)).toEqual(["questions"]);
  });
});
