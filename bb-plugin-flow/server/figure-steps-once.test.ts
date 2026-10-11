// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { FlowSettings } from "../shared/contract";
import { FIGURE_STEPS_PLACED_KEY, placeFigureStepsOnce } from "./figure-steps-once";
import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";

const stored: FlowSettings = {
  flows: [{ id: "f", name: "F", stages: [stage("task"), { ...stage("finalize"), skill: "", automation: { source: "flow", steps: ["bb.tasks-done", "git.commit"] } }] }],
  minButtonWidth: 170,
  version: 2,
};

const setup = async () => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(FLOW_SETTINGS_KEY, stored);
  return { kv: bb.storage.kv, flows: await createFlowSettings(bb.storage.kv) };
};
const finalizeSteps = (flows: Awaited<ReturnType<typeof setup>>["flows"]) => {
  const automation = flows.current().flows[0]!.stages[1]!.automation;
  return automation && "source" in automation ? automation.steps : [];
};

describe("placeFigureStepsOnce", () => {
  it("Flow из main ставит шаг факта и больше к этому не возвращается", async () => {
    const { kv, flows } = await setup();
    await placeFigureStepsOnce(kv, flows, async () => "path:/Users/me/Projects/bb-plugins/bb-plugin-flow");
    expect(finalizeSteps(flows)).toEqual(["bb.tasks-fact", "bb.tasks-done", "git.commit"]);
    expect(await kv.get(FIGURE_STEPS_PLACED_KEY)).toBe(true);
  });

  it("превью из дерева треда коллекцию не трогает и отметки не ставит", async () => {
    const { kv, flows } = await setup();
    await placeFigureStepsOnce(kv, flows, async () => "path:/Users/me/.bb/worktrees/thr_x-1/bb-plugins/bb-plugin-flow");
    expect(finalizeSteps(flows)).toEqual(["bb.tasks-done", "git.commit"]);
    expect(await kv.get(FIGURE_STEPS_PLACED_KEY)).toBeUndefined();
  });

  it("владелец снял шаг после установки — он не возвращается", async () => {
    const { kv, flows } = await setup();
    await kv.set(FIGURE_STEPS_PLACED_KEY, true);
    await placeFigureStepsOnce(kv, flows, async () => "git:https://github.com/e0068/bb-plugins.git");
    expect(finalizeSteps(flows)).toEqual(["bb.tasks-done", "git.commit"]);
  });
});
