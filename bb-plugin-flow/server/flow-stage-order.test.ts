// @vitest-environment node
// Агент берётся за этап прогона, только закрыв этапы прогона перед ним, которые ведёт он сам: иначе
// пропущенный этап молча уходит из работы, а прогон потом выглядит пройденным.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { FlowProgress, StageSettings, WorkStage } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_order";
const T0 = "2026-10-13T10:00:00.000Z";

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const publish: WorkStage = { id: "publish", kind: "skill", skill: "", name: "publish", executors: [], automation: { source: "flow", steps: ["git.create-pr"] } };

/** Прогон, где владелец взял этапы `run` и снял `out`. */
const answered = (run: string[], out: string[] = []): FlowProgress => ({
  stages: Object.fromEntries([...run.map((id) => [id, { skipped: false }]), ...out.map((id) => [id, { skipped: true }])]),
  waiting: [],
});

const setup = async (stages: WorkStage[], record: FlowProgress) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(`flow-progress:${THREAD}`, record);
  const progress = createProgress(bb.storage.kv, { onChange: () => undefined });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 50 });
  const mark = async (id: string, state: "started" | "done") => textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD }));
  const track = async (id: string) => (await progress.get(THREAD))?.stages[id];
  return { mark, track };
};

const FLOW = [stage("implement"), stage("testing"), stage("review"), publish];

describe("этап прогона начинается только после закрытых этапов агента перед ним", () => {
  it("тестирование в прогоне не закрыто — ревью не начинается, отказ называет тестирование", async () => {
    const t = await setup(FLOW, answered(["implement", "testing", "review"]));
    await t.mark("implement", "started");
    await t.mark("implement", "done");
    const reply = await t.mark("review", "started");
    expect(reply).toMatch(/testing/);
    expect(reply).toMatch(/Nothing was marked/);
    expect((await t.track("review"))?.startedAt).toBeUndefined();
  });

  it("этап, снятый владельцем с прогона, не держит следующий", async () => {
    const t = await setup(FLOW, answered(["implement", "review"], ["testing"]));
    await t.mark("implement", "started");
    await t.mark("implement", "done");
    expect(await t.mark("review", "started")).toMatch(/marked started/);
  });

  it("на доработке снова начатая реализация держит тестирование, пока не закрыта", async () => {
    const t = await setup(FLOW, answered(["implement", "testing", "review"]));
    for (const id of ["implement", "testing"]) {
      await t.mark(id, "started");
      await t.mark(id, "done");
    }
    await t.mark("implement", "started");
    const reply = await t.mark("testing", "started");
    expect(reply).toMatch(/implement/);
    expect(reply).toMatch(/Nothing was marked/);
  });

  it("откат к пройденному этапу не держат этапы после него", async () => {
    const t = await setup(FLOW, answered(["implement", "testing", "review"]));
    for (const id of ["implement", "testing"]) {
      await t.mark(id, "started");
      await t.mark(id, "done");
    }
    await t.mark("review", "started");
    expect(await t.mark("implement", "started")).toMatch(/marked started/);
  });
});
