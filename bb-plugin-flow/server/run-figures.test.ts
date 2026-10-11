// @vitest-environment node
// План и факт прогона для шагов «План → задача» и «Факт → задача»: бюджет ответа на бриф и итог закрытых этапов.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";
import { priced } from "./priced-fixture";

const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

const host = () => {
  let clock = Date.parse("2026-10-10T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "run1", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const { runFigures, pastRuns } = registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => 2.5 });
  return { harness, kv: bb.storage.kv, runFigures, pastRuns, store, tick: (minutes: number) => void (clock += minutes * 60_000) };
};

const launch = async ({ harness }: ReturnType<typeof host>) => {
  await harness.callAgentTool(ASK_TOOL_NAME, priced({ title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }), { threadId: "thr_a" });
  await harness.callRpc("answerBrief", { id: "dec_run1", messageId: "m", answer: { briefId: "dec_run1", answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
};

describe("runFigures", () => {
  it("тред без прогона чисел не даёт", async () => {
    expect(await host().runFigures("thr_none")).toBeNull();
  });

  it("план — бюджет, с которым владелец отпустил прогон; пока работа не шла, факт нулевой", async () => {
    const h = host();
    await launch(h);
    const answer = await h.store.getAnswer("dec_run1");
    const { minutes, target, max } = answer!.forecast!;
    const figures = await h.runFigures("thr_a");
    expect(figures).toMatchObject({ planned: { minutes, target, max } });
    expect(await figures!.spent()).toMatchObject({ minutes: 0, cost: 0 });
  });

  it("факт — минуты и доллары закрытых этапов прогона", async () => {
    const h = host();
    await launch(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: "thr_a" });
    h.tick(20);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: "thr_a" });
    expect(await (await h.runFigures("thr_a"))!.spent()).toEqual({ run: expect.stringMatching(/^run_/), aliases: [expect.stringMatching(/^thr_a@2026-10-10T10:00/)], minutes: 20, cost: 2.5 });
  });

  it("прошлые прогоны: идущий прогон даёт свой итог под тем же id, что и шагу факта", async () => {
    const h = host();
    await launch(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: "thr_a" });
    h.tick(20);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: "thr_a" });
    const spent = await (await h.runFigures("thr_a"))!.spent();
    expect(await h.pastRuns()).toEqual([{ thread: "thr_a", spent }]);
  });

  it("итог, замороженный при завершении, несёт id прогона — живая запись и заморозка дают один прогон", async () => {
    const h = host();
    await launch(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: "thr_a" });
    h.tick(20);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: "thr_a" });
    await h.harness.callRpc("getFlowProgress", { threadId: "thr_a" });
    const spent = await (await h.runFigures("thr_a"))!.spent();
    const frozen = await h.harness.callRpc("getRunSummary", { briefId: "dec_run1" });
    expect(frozen).toMatchObject({ runId: spent!.run });
    expect(await h.pastRuns()).toEqual([{ thread: "thr_a", spent }]);
  });

  it("итог того же прогона, замороженный прежней версией без id, второй раз не считается", async () => {
    const h = host();
    await launch(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: "thr_a" });
    h.tick(20);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: "thr_a" });
    await h.harness.callRpc("getFlowProgress", { threadId: "thr_a" });
    const { runId: _runId, ...legacy } = (await h.harness.callRpc("getRunSummary", { briefId: "dec_run1" })) as Record<string, unknown>;
    await h.kv.set("flow-run:dec_old", legacy);
    expect(await h.pastRuns()).toHaveLength(1);
  });
});
