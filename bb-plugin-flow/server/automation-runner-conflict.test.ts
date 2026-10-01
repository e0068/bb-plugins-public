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

const THREAD = "thr_conflict";
const T0 = "2026-10-01T10:00:00.000Z";
const CONFLICT: StepOutcome = { ok: false, error: "code.ts — conflicts with origin/main. The merge was aborted.", conflicts: ["code.ts", "docs/architecture/x.md"] };

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "land", executors: [], automation: { source: "flow", steps: ["git.fast-forward", "bb.archive"] } };

const setup = (fastForward: () => StepOutcome) => {
  const settings: StageSettings = { stages: [stage("review"), land], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const store = createStore(bb.storage.kv);
  const calls: string[] = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => (calls.push(id), id === "git.fast-forward" ? fastForward() : { ok: true, detail: null })]),
  ) as unknown as Steps;
  const pending: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const schedule = (run: () => void, ms: number) => {
    const timer = { run, ms, cancelled: false };
    pending.push(timer);
    return () => void (timer.cancelled = true);
  };
  const live = () => pending.filter((t) => !t.cancelled);
  const fire = () => live().forEach((t) => ((t.cancelled = true), t.run()));
  const agent = { active: false };
  const thread = async () => ({ active: agent.active, providerId: "claude-code", environmentId: null });
  const woken: string[] = [];
  const notices: string[] = [];
  let now = Date.parse(T0);
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
    now: () => new Date(now).toISOString(),
    retry: () => ({ seconds: 30, attempts: 3 }),
    schedule,
    wake: async (_threadId, text) => void woken.push(text),
    notify: (notice) => void notices.push(notice.kind),
    onError: () => undefined,
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 50 });
  const start = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  const landOf = async () => (await progress.get(THREAD))?.stages.land;
  const pass = (ms: number) => void (now += ms);
  return { calls, live, fire, agent, woken, notices, store, landOf, start, pass };
};

describe("конфликт слияния будит агента треда, а не таймер", () => {
  it("конфликт — одна побудка со списком файлов, владелец не ждёт, тоста нет", async () => {
    const { woken, notices, store, landOf, start } = setup(() => CONFLICT);
    await start();
    await vi.waitFor(() => expect(woken).toHaveLength(1));
    expect(woken[0]).toContain("code.ts");
    expect(woken[0]).toContain("docs/architecture/x.md");
    expect(woken[0]).toContain("commit the merge");
    expect(await store.listAwaiting()).toEqual([]);
    expect(notices).not.toContain("failed");
    expect((await landOf())?.run?.retryAt).toBeUndefined();
  });

  it("пока ход агента идёт, шаг не повторяется; ход кончился — повтор, и после коммита агента шаг проходит", async () => {
    let merged = false;
    const { calls, fire, live, agent, landOf, start } = setup(() => (merged ? { ok: true, detail: "merged" } : CONFLICT));
    await start();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    agent.active = true;
    for (let i = 0; i < 3; i += 1) {
      fire();
      await vi.waitFor(() => expect(live()).toHaveLength(1));
    }
    expect(calls.filter((id) => id === "git.fast-forward")).toHaveLength(1);
    merged = true;
    agent.active = false;
    fire();
    await vi.waitFor(async () => expect((await landOf())?.finishedAt).toBeDefined());
    expect(calls).toEqual(["git.fast-forward", "git.fast-forward", "bb.archive"]);
  });

  it("агент так и не взялся за ход — шаг всё равно повторяется через пять минут", async () => {
    const { calls, fire, live, pass, start } = setup(() => CONFLICT);
    await start();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    fire();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    expect(calls.filter((id) => id === "git.fast-forward")).toHaveLength(1);
    pass(5 * 60_000);
    fire();
    await vi.waitFor(() => expect(calls.filter((id) => id === "git.fast-forward")).toHaveLength(2));
  });

  it("конфликт остался и после хода агента — шаг ждёт владельца, без таймера и без второй побудки", async () => {
    const { woken, notices, store, live, fire, agent, start } = setup(() => CONFLICT);
    await start();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    agent.active = true;
    fire();
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    agent.active = false;
    fire();
    await vi.waitFor(async () => expect(await store.listAwaiting()).toHaveLength(1));
    expect(woken).toHaveLength(1);
    expect(live()).toEqual([]);
    expect(notices).toContain("failed");
  });
});
