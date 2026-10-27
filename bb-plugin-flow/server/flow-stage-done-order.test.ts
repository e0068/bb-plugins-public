// @vitest-environment node
// Закрыть этап прогона агент может, только закрыв этапы прогона перед ним: иначе этап молча уходит из работы,
// а автоматизация за закрытым этапом выпускает в main работу, которой не было.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { pendingAutomation } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import type { FlowProgress, StageSettings, WorkStage } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_done_order";
const T0 = "2026-10-13T10:00:00.000Z";

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const publish: WorkStage = { id: "publish", kind: "skill", skill: "", name: "publish", executors: [], automation: { source: "flow", steps: ["git.create-pr"] } };
const FLOW = [stage("plan"), stage("code"), stage("review"), publish];

/** Прогон, где владелец взял этапы `run` и снял `out`. */
const answered = (run: string[], out: string[] = []): FlowProgress => ({
  stages: Object.fromEntries([...run.map((id) => [id, { skipped: false }]), ...out.map((id) => [id, { skipped: true }])]),
  waiting: [],
});

const setup = async (record: FlowProgress) => {
  const settings: StageSettings = { stages: FLOW, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(`flow-progress:${THREAD}`, record);
  const progress = createProgress(bb.storage.kv, { onChange: () => undefined });
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread: async () => ({ active: false, providerId: "claude-code", environmentId: null }), startTimeoutMs: 50 });
  const mark = async (id: string, state: "started" | "done") => textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD }));
  const current = async () => (await progress.get(THREAD)) ?? { stages: {}, waiting: [] };
  return { mark, current };
};

describe("этап закрывается только после этапов прогона перед ним", () => {
  it("этап, который владелец взял, а агент не тронул, держит закрытие следующего", async () => {
    const t = await setup(answered(["plan", "code", "review"]));
    await t.mark("plan", "started");
    await t.mark("plan", "done");
    const reply = await t.mark("review", "done");
    expect(reply).toMatch(/code/);
    expect(reply).toMatch(/Nothing was marked/);
    expect((await t.current()).stages.review?.finishedAt).toBeUndefined();
  });

  it("этап без записи прогресса держит и начало, и закрытие следующего", async () => {
    const t = await setup({ stages: {}, waiting: [] });
    expect(await t.mark("code", "started")).toMatch(/plan/);
    expect(await t.mark("code", "done")).toMatch(/plan/);
  });

  it("этап, снятый владельцем, закрытие следующего не держит", async () => {
    const t = await setup(answered(["plan", "review"], ["code"]));
    await t.mark("plan", "started");
    await t.mark("plan", "done");
    expect(await t.mark("review", "done")).toMatch(/marked done/);
  });

  it("закрыв открытый этап, агент закрывает следующий", async () => {
    const t = await setup(answered(["plan", "code", "review"]));
    for (const id of ["plan", "code"]) {
      await t.mark(id, "started");
      await t.mark(id, "done");
    }
    expect(await t.mark("review", "done")).toMatch(/marked done/);
  });

  it("автоматизация не наступает за этапом, который закрыли мимо открытого", async () => {
    const t = await setup(answered(["plan", "code", "review"]));
    await t.mark("plan", "started");
    await t.mark("plan", "done");
    await t.mark("review", "done");
    expect(pendingAutomation(FLOW, await t.current())).toBeNull();
  });
});
