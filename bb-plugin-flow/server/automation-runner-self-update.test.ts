// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { STEP_IDS } from "../packages/automation-steps/catalog";
import { selfUpdatePendingKey } from "../packages/automation-steps/index";
import type { PluginsPort, StepId, StepOutcome, Steps } from "../packages/automation-steps/index";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_self";
const T0 = "2026-09-17T10:00:00.000Z";

const flowStage = (id: string, steps: StepId[]): WorkStage => ({
  id,
  kind: "skill",
  skill: "",
  name: id,
  executors: [],
  automation: { source: "flow", steps },
});

/**
 * Мир прогона: шаг `bb.reinstall` откладывает самообновление ровно так, как
 * это делает настоящий шаг — записью в kv, — а `log` собирает порядок всего,
 * что произошло, чтобы было видно, где именно встало обновление.
 */
const setup = (steps: readonly StepId[], over: { applyUpdate?: () => Promise<void>; pending?: string | null; hold?: { step: StepId; thread: string; until: Promise<void> } } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const log: string[] = [];
  const settings: StageSettings = { stages: [stage("review"), flowStage("land", [...steps])], minButtonWidth: 170 };
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const pending = over.pending === undefined ? "flow" : over.pending;
  const fakeSteps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async (threadId: string): Promise<StepOutcome> => {
        log.push(`${id}@${threadId}`);
        if (id === "bb.reinstall" && pending !== null) {
          await bb.storage.kv.set(selfUpdatePendingKey(threadId), pending);
        }
        if (over.hold && over.hold.step === id && over.hold.thread === threadId) await over.hold.until;
        return { ok: true, detail: null };
      },
    ]),
  ) as unknown as Steps;
  const plugins: PluginsPort = {
    list: async () => ({ plugins: [] }),
    applyUpdate: async ({ pluginId }) => {
      log.push(`update:${pluginId}`);
      if (over.applyUpdate) await over.applyUpdate();
    },
    install: async () => undefined,
    remove: async () => undefined,
  };
  const errors: unknown[] = [];
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps: fakeSteps,
    external: async () => ({ ok: true, detail: null }),
    thread: async () => ({ active: false, providerId: "claude-code" }),
    providers: async () => [],
    kv: bb.storage.kv,
    plugins,
    now: () => T0,
    onError: (error) => void errors.push(error),
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread: async () => ({ active: false, providerId: null, environmentId: null }) });
  const stateOf = async (id: string, threadId = THREAD) =>
    ((await harness.callRpc("getFlowProgress", { threadId })) as { stages: Array<{ id: string; state: string }> } | null)?.stages.find((s) => s.id === id)?.state;
  const start = async (threadId = THREAD) => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId });
  };
  const run = async (threadId = THREAD) => {
    await start(threadId);
    await vi.waitFor(async () => expect(await stateOf("land", threadId)).toBe("done"));
  };
  return { run, start, stateOf, log, errors, kv: bb.storage.kv, runner };
};

describe("отложенное самообновление плагина", () => {
  it("применяется после последнего шага цепочки, а не между шагами", async () => {
    const { run, log } = setup(["bb.reinstall", "bb.tasks-done", "bb.archive"]);
    await run();
    expect(log).toEqual([`bb.reinstall@${THREAD}`, `bb.tasks-done@${THREAD}`, `bb.archive@${THREAD}`, "update:flow"]);
  });

  it("ключ снимается, и повторный прогон не обновляет второй раз", async () => {
    const { run, log, kv, runner } = setup(["bb.reinstall"]);
    await run();
    expect(await kv.get(selfUpdatePendingKey(THREAD))).toBeUndefined();
    await runner.advance(THREAD);
    expect(log.filter((entry) => entry.startsWith("update:"))).toEqual(["update:flow"]);
  });

  it("без отложенного обновления плагины не трогаются вовсе", async () => {
    const { run, log } = setup(["bb.reinstall", "bb.archive"], { pending: null });
    await run();
    expect(log).toEqual([`bb.reinstall@${THREAD}`, `bb.archive@${THREAD}`]);
  });

  it("пока идёт цепочка другого треда, обновление ждёт: чужой прогон им не рвётся", async () => {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { run, start, stateOf, log } = setup(["bb.reinstall", "bb.archive"], { hold: { step: "bb.archive", thread: "thr_other", until: held } });
    const other = "thr_other";
    await start(other);
    await vi.waitFor(() => expect(log).toContain(`bb.archive@${other}`));
    await run(THREAD);
    expect(log.filter((entry) => entry.startsWith("update:"))).toEqual([]);
    release();
    await vi.waitFor(async () => expect(await stateOf("land", other)).toBe("done"));
    await vi.waitFor(() => expect(log.filter((entry) => entry.startsWith("update:"))).toEqual(["update:flow"]));
  });

  it("ключ, переживший перезапуск, применяется на resume — обещание шага не теряется", async () => {
    const { log, kv, runner } = setup(["bb.reinstall"], { pending: null });
    await kv.set(selfUpdatePendingKey(THREAD), "flow");
    await runner.resume(THREAD);
    expect(log).toEqual(["update:flow"]);
    expect(await kv.get(selfUpdatePendingKey(THREAD))).toBeUndefined();
  });

  it("ключ треда, доигравшего раньше соседа, подметается тем, кто закончил последним", async () => {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const other = "thr_other";
    const { run, start, stateOf, log, kv } = setup(["bb.reinstall", "bb.archive"], { hold: { step: "bb.archive", thread: other, until: held } });
    await start(other);
    await vi.waitFor(() => expect(log).toContain(`bb.archive@${other}`));
    await run(THREAD);
    release();
    await vi.waitFor(async () => expect(await stateOf("land", other)).toBe("done"));
    // Оба треда отложили обновление одного плагина — он обновляется один раз,
    // и ни одного ключа не остаётся висеть.
    await vi.waitFor(() => expect(log.filter((entry) => entry.startsWith("update:"))).toEqual(["update:flow"]));
    expect(await kv.get(selfUpdatePendingKey(THREAD))).toBeUndefined();
    expect(await kv.get(selfUpdatePendingKey(other))).toBeUndefined();
  });

  it("сбой самообновления уходит в onError и не роняет прогон", async () => {
    const { run, errors, log } = setup(["bb.reinstall"], {
      applyUpdate: async () => {
        throw new Error("plugin is pinned");
      },
    });
    await run();
    expect(log).toEqual([`bb.reinstall@${THREAD}`, "update:flow"]);
    expect(errors.map(String)).toEqual(["Error: plugin is pinned"]);
  });
});
