// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { CHECKLIST_TOOL } from "../core/checklist";
import { onMark } from "../core/progress";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { registerChecklistTool } from "./checklist-tool";
import { createProgress } from "./progress";
import { createStore } from "./store";

// Утверждение с комментариями к виджетам закрыто сразу, но правки по ним агент ещё не сделал: автоматизация за ним
// (в жизни — Archive) ждёт последнего отмеченного пункта чек-листа, а не стартует на закрытии Утверждения.

const THREAD = "thr_checklist";
const T0 = "2026-10-01T10:00:00.000Z";

const auto = (id: string, step: StepId): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps: [step] } });
const stages = [stage("approval"), auto("archive", "bb.archive")];
const items = [
  { id: "c1", where: "Демо", text: "круг крупнее", done: false },
  { id: "c2", where: "Демо", text: "цельный круг", done: false },
];

// `restarted`: чек-лист записан прежним процессом сервера — другим экземпляром хранилища поверх того же kv.
const setup = async (withChecklist: boolean, restarted = false) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv, { onChange: () => undefined });
  const calls: StepId[] = [];
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => (calls.push(id), { ok: true, detail: null })])) as unknown as Steps;
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true as const, detail: null }),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins,
    now: () => T0,
    onError: (error: unknown) => {
      throw error;
    },
  });
  registerChecklistTool(bb, store, (threadId) => void runner.advance(threadId));
  if (withChecklist) await (restarted ? createStore(bb.storage.kv) : store).putChecklist(THREAD, { approvalId: "dec_1", items });
  // Ответ на Утверждение закрывает его этап, как onAnswer в core/progress.ts.
  await progress.update(THREAD, (p) => onMark(onMark(p, "approval", "started", T0), "approval", "done", T0));
  await runner.advance(THREAD);
  return { harness, calls, progress };
};

describe("автоматизация за Утверждением с чек-листом", () => {
  it("без чек-листа стартует, как только Утверждение закрыто", async () => {
    const { calls } = await setup(false);
    await vi.waitFor(() => expect(calls).toEqual(["bb.archive"]));
  });

  it("с открытым чек-листом не стартует, пока агент не отметил все пункты", async () => {
    const { harness, calls, progress } = await setup(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
    expect((await progress.get(THREAD))?.stages.archive?.startedAt).toBeUndefined();

    await harness.callAgentTool(CHECKLIST_TOOL, { done: ["c1"] }, { threadId: THREAD });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);

    await harness.callAgentTool(CHECKLIST_TOOL, { done: ["c2"] }, { threadId: THREAD });
    await vi.waitFor(() => expect(calls).toEqual(["bb.archive"]));
  });

  it("чек-лист, записанный до перезапуска сервера, держит автоматизацию и после него", async () => {
    const { calls } = await setup(true, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
  });
});
