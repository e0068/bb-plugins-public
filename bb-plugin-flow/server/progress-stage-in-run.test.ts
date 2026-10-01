// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_run";
const AT = "2026-10-01T10:00:00.000Z";

const setup = async () => {
  const settings: StageSettings = { stages: [stage("review"), stage("code"), stage("demo")], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv);
  const thread = async () => ({ active: false, providerId: null, environmentId: null });
  registerProgress(bb, progress, { now: () => AT, stages: () => settings, windowCost: async () => undefined, thread });
  await progress.update(THREAD, () => ({ stages: { review: { startedAt: AT, finishedAt: AT } }, waiting: [] }));
  const stateOf = async (id: string) => ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string }> }).stages.find((s) => s.id === id)?.state;
  const set = (stageId: string, run: boolean, threadId = THREAD) => harness.callRpc("setStageInRun", { threadId, stageId, run });
  return { harness, progress, stateOf, set };
};

describe("чекбокс этапа в баннере меняет состав прогона", () => {
  it("снятый этап виден убранным, возвращённый — впереди", async () => {
    const { stateOf, set } = await setup();
    expect(await set("code", false)).toEqual({ kind: "set" });
    expect(await stateOf("code")).toBe("skip");
    expect(await set("code", true)).toEqual({ kind: "set" });
    expect(await stateOf("code")).toBe("todo");
  });

  it("закрытый этап не снимается", async () => {
    const { stateOf, set } = await setup();
    await set("review", false);
    expect(await stateOf("review")).toBe("done");
  });

  it("тред без прогона отбивается", async () => {
    const { set } = await setup();
    expect(await set("code", false, "thr_other")).toEqual({ kind: "failed", reason: "no-run" });
  });

  it("тред, отдавший работу, состав чужого прогона не меняет", async () => {
    const { progress, stateOf, set } = await setup();
    await progress.handOver(THREAD, "thr_new", []);
    expect(await set("code", false)).toEqual({ kind: "failed", reason: "carried" });
    expect(await stateOf("code")).toBe("todo");
  });
});

describe("агент не начинает этап, убранный владельцем", () => {
  it("flow_stage started на убранном этапе — отказ, этап не отмечен", async () => {
    const { harness, stateOf, set } = await setup();
    await set("code", false);
    const answer = (await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "code", state: "started" }, { threadId: THREAD })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toContain("The owner took stage code out of the run");
    expect(await stateOf("code")).toBe("skip");
  });

  it("возвращённый этап агент начинает как обычно", async () => {
    const { harness, stateOf, set } = await setup();
    await set("code", false);
    await set("code", true);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "code", state: "started" }, { threadId: THREAD });
    expect(await stateOf("code")).toBe("now");
  });
});
