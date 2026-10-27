// @vitest-environment node
// Этап, предложенный агентом к снятию, остаётся в прогоне: агент может его сделать, а если не делает — отказ называет выход.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { FlowProgress, StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_proposed_start";
const FLOW = [stage("spec"), stage("code")];
const record: FlowProgress = { stages: { spec: { skipped: true, proposed: true }, code: { skipped: false } }, waiting: [] };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const setup = async (seed: FlowProgress) => {
  const settings: StageSettings = { stages: FLOW, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(`flow-progress:${THREAD}`, seed);
  const progress = createProgress(bb.storage.kv, { onChange: () => undefined });
  registerProgress(bb, progress, { now: () => "2026-10-13T10:00:00.000Z", stages: () => settings, windowCost: async () => undefined, thread: async () => ({ active: false, providerId: "claude-code", environmentId: null }), startTimeoutMs: 50 });
  const mark = async (id: string, state: "started" | "done") => textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD }));
  return { mark, current: async () => (await progress.get(THREAD)) ?? { stages: {}, waiting: [] } };
};

describe("этап, предложенный к снятию, пока владелец не утвердил", () => {
  it("агент может его начать и закрыть", async () => {
    const t = await setup(record);
    expect(await t.mark("spec", "started")).toMatch(/marked started/);
    expect(await t.mark("spec", "done")).toMatch(/marked done/);
    expect((await t.current()).stages.spec?.finishedAt).toBeDefined();
  });

  it("этап после него не начать — отказ называет утверждение как выход", async () => {
    const t = await setup(record);
    const reply = await t.mark("code", "started");
    expect(reply).toMatch(/spec/);
    expect(reply).toMatch(/approval/);
    expect(reply).toMatch(/Nothing was marked/);
  });

  it("этап, который владелец снял сам, начать нельзя", async () => {
    const t = await setup({ stages: { spec: { skipped: true }, code: { skipped: false } }, waiting: [] });
    expect(await t.mark("spec", "started")).toMatch(/took stage spec out of the run/);
  });
});
