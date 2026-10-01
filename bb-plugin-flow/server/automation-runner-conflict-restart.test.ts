// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_restart";
const T0 = "2026-10-01T10:00:00.000Z";
const CONFLICT: StepOutcome = { ok: false, error: "code.ts — conflicts with origin/release.", conflicts: ["code.ts"], base: "origin/release" };
const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "land", executors: [], automation: { source: "flow", steps: ["git.fast-forward"] } };

const setup = () => {
  const settings: StageSettings = { stages: [stage("review"), land], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const store = createStore(bb.storage.kv);
  const calls: string[] = [];
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => (calls.push(id), CONFLICT)])) as unknown as Steps;
  const pending: Array<{ run: () => void; cancelled: boolean }> = [];
  const schedule = (run: () => void) => {
    const timer = { run, cancelled: false };
    pending.push(timer);
    return () => void (timer.cancelled = true);
  };
  const live = () => pending.filter((t) => !t.cancelled);
  const fire = () => live().forEach((t) => ((t.cancelled = true), t.run()));
  const agent = { active: false };
  const woken: string[] = [];
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const runnerOf = () =>
    createAutomationRunner({
      progress,
      store,
      stages: () => settings,
      steps,
      external: async () => ({ ok: true as const, detail: null }),
      thread: async () => ({ active: agent.active, providerId: "claude-code", environmentId: null }),
      providers: async () => [],
      kv: bb.storage.kv,
      plugins,
      now: () => T0,
      retry: () => ({ seconds: 30, attempts: 3 }),
      schedule,
      wake: async (_threadId, text) => void woken.push(text),
      onError: () => undefined,
    });
  const runner = runnerOf();
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread: async () => ({ active: agent.active, providerId: null, environmentId: null }), startTimeoutMs: 50 });
  const start = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { calls, live, fire, agent, woken, store, start, runnerOf };
};

describe("конфликт: реплика и перезапуск плагина", () => {
  it("реплика называет ветку, с которой конфликт, а не всегда main", async () => {
    const { woken, start } = setup();
    await start();
    await vi.waitFor(() => expect(woken).toHaveLength(1));
    expect(woken[0]).toContain("origin/release");
    expect(woken[0]).not.toContain("origin/main");
  });

  it("шаг, который после хода агента ждёт владельца, перезапуск плагина не повторяет", async () => {
    const { calls, live, fire, agent, store, start, runnerOf } = setup();
    await start();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    agent.active = true;
    fire();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    agent.active = false;
    fire();
    await vi.waitFor(async () => expect(await store.listAwaiting()).toHaveLength(1));
    const before = calls.length;
    await runnerOf().resume(THREAD);
    expect(live()).toEqual([]);
    expect(calls).toHaveLength(before);
  });

  it("шаг, ждущий хода агента, перезапуск снова ставит ждать этот ход", async () => {
    const { live, start, runnerOf } = setup();
    await start();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    const restarted = runnerOf();
    await restarted.resume(THREAD);
    expect(live().length).toBeGreaterThanOrEqual(1);
  });
});
