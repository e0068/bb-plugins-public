// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";
import type { FlowSettings, WorkStage } from "../shared/contract";

const chain = (id: string, steps: string[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps: steps as never } });

const settings = (stages: WorkStage[]): FlowSettings => ({ flows: [{ id: "default", name: "Default", stages }], minButtonWidth: 170 });

describe("порядок шагов при сохранении коллекции", () => {
  it("рабочий порядок сохраняется: PR открывает первая цепочка, мёрджит вторая", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = await createFlowSettings(bb.storage.kv);
    const ok = settings([chain("a", ["git.commit", "git.fast-forward", "git.create-pr"]), chain("b", ["files.bump-patch", "git.merge"])]);
    await expect(store.save(ok)).resolves.toMatchObject({ version: 2 });
  });

  it("бамп раньше открытия PR не сохраняется, и в kv ничего не ложится", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = await createFlowSettings(bb.storage.kv);
    const before = await bb.storage.kv.get(FLOW_SETTINGS_KEY);
    const broken = settings([chain("a", ["git.commit", "files.bump-patch", "git.create-pr"])]);
    await expect(store.save(broken)).rejects.toThrow(/Bump patch.*Default.*Open a PR/s);
    expect(await bb.storage.kv.get(FLOW_SETTINGS_KEY)).toEqual(before);
    expect(store.current()).not.toEqual(broken);
  });

  it("мёрдж без открытия PR вовсе — тот же отказ", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = await createFlowSettings(bb.storage.kv);
    await expect(store.save(settings([chain("a", ["git.merge"])]))).rejects.toThrow(/Merge the PR/);
  });
});
