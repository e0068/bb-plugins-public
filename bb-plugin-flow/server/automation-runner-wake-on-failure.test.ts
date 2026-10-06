// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import type { RetryPolicy } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_wake_on_failure";
const T0 = "2026-10-05T11:30:00.000Z";

const flowStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });

/** Шаги-фейки: `git.merge` падает всегда. */
const failingMerge = (): Steps =>
  Object.fromEntries(STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => (id === "git.merge" ? { ok: false, error: "timed out after 75 seconds" } : { ok: true, detail: null })])) as unknown as Steps;

const setup = (policy: RetryPolicy, wakeOnFailure: boolean, instruction?: string) => {
  const settings: StageSettings = { stages: [stage("review"), flowStage("land", ["git.merge", "bb.archive"]), stage("demo")], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const timers: Array<() => void> = [];
  const woken: string[] = [];
  const runner = createAutomationRunner({
    progress, store, stages: () => settings, steps: failingMerge(), external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins,
    now: () => T0, retry: () => policy, wakeOnFailure: () => wakeOnFailure,
    ...(instruction === undefined ? {} : { failureInstruction: () => instruction }),
    schedule: (run) => { timers.push(run); return () => undefined; },
    wake: async (_threadId, text) => void woken.push(text),
    onError: (error: unknown) => { throw error; },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  const failed = async () => (await progress.get(THREAD))?.stages.land?.run?.error ?? null;
  const fire = () => timers.splice(0).forEach((run) => run());
  const start = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { woken, failed, fire, start, store };
};

describe("реплика агенту после последней попытки автоповтора", () => {
  it("включена — агент получает реплику, когда последняя попытка упала и шаг ждёт владельца, но не раньше", async () => {
    const { woken, failed, fire, start } = setup({ seconds: 30, attempts: 1 }, true);
    await start();
    await vi.waitFor(async () => expect(await failed()).not.toBeNull());
    expect(woken).toEqual([]);
    fire();
    await vi.waitFor(() => expect(woken).toHaveLength(1));
    expect(woken[0]).toContain('"land"');
    expect(woken[0]).toContain("timed out after 75 seconds");
  });

  it("без автоповтора первая неудача и есть последняя попытка — реплика сразу", async () => {
    const { woken, start } = setup({ seconds: 0, attempts: 3 }, true);
    await start();
    await vi.waitFor(() => expect(woken).toHaveLength(1));
  });

  it("выключена — шаг ждёт владельца молча, как раньше", async () => {
    const { woken, failed, start, store } = setup({ seconds: 0, attempts: 3 }, false);
    await start();
    await vi.waitFor(async () => expect(await failed()).not.toBeNull());
    await vi.waitFor(async () => expect(await store.listAwaiting()).toHaveLength(1));
    expect(woken).toEqual([]);
  });

  it("реплика несёт наказ владельца из настроек вместо наказа по умолчанию", async () => {
    const { woken, start } = setup({ seconds: 0, attempts: 3 }, true, "Почини сам, если понятно, что делать.");
    await start();
    await vi.waitFor(() => expect(woken).toHaveLength(1));
    expect(woken[0]).toContain("Почини сам, если понятно, что делать.");
    expect(woken[0]).toContain("timed out after 75 seconds");
  });
});
