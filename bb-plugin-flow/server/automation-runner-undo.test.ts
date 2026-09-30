// @vitest-environment node
// Откат автоматизации при доработке: агент начинает закрытый этап снова — Flow исполняет шаги отката закрытой
// автоматизации за ним в том же вызове flow_stage, до ответа агенту.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_undo";
const T0 = "2026-09-30T10:00:00.000Z";
type Script = { id: string; name: string; content: string };

const PREVIEW: Script = { id: "preview", name: "preview.sh", content: "echo preview" };
const RESTORE: Script = { id: "restore", name: "restore.sh", content: "echo restore" };

const demo: WorkStage = { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] };

const setup = (automation: NonNullable<WorkStage["automation"]>, script: (s: Script) => Promise<StepOutcome>) => {
  const ran: string[] = [];
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => (ran.push(id), { ok: true, detail: null })])) as unknown as Steps;
  const settings: StageSettings = { stages: [stage("review"), { id: "ship", kind: "skill", skill: "", name: "Ship", executors: [], automation }, demo], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const runner = createAutomationRunner({
    progress,
    store: createStore(bb.storage.kv),
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    script: async (_threadId, s) => (ran.push(`script:${s.id}`), script(s)),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    onError: (e) => {
      throw e;
    },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, undo: runner.undo });
  const mark = (id: string, state: "started" | "done") => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD }) as Promise<string>;
  const view = async () => (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string }> };
  const shipDone = async () => {
    await mark("review", "started");
    await mark("review", "done");
    await vi.waitFor(async () => expect((await view()).stages.find((s) => s.id === "ship")?.state).toBe("done"));
  };
  return { ran, mark, view, shipDone };
};

const withUndo = { source: "flow" as const, steps: ["script:preview" as const], undo: ["script:restore" as const], scripts: [PREVIEW, RESTORE] };

describe("откат автоматизации при доработке", () => {
  it("доработка до закрытой автоматизации исполняет её шаги отката до ответа агенту", async () => {
    const { ran, mark, shipDone } = setup(withUndo, async (s) => ({ ok: true, detail: `${s.name} ok` }));
    await shipDone();
    expect(ran).toEqual(["script:preview"]);
    const reply = await mark("review", "started");
    expect(ran).toEqual(["script:preview", "script:restore"]);
    expect(reply).toContain("Undo of Ship");
    expect(reply).toContain("restore.sh ok");
  });

  it("упавший откат не роняет отметку: агент узнаёт причину из ответа", async () => {
    const { mark, view, shipDone } = setup(withUndo, async (s) => (s.id === "restore" ? { ok: false, error: "bb is down" } : { ok: true, detail: null }));
    await shipDone();
    const reply = await mark("review", "started");
    expect(reply).toContain("Stage review marked started.");
    expect(reply).toContain("bb is down");
    expect((await view()).stages.find((s) => s.id === "review")?.state).toBe("now");
  });

  it("автоматизация без шагов отката при доработке ничего не исполняет", async () => {
    const { ran, mark, shipDone } = setup({ source: "flow", steps: ["script:preview"], scripts: [PREVIEW] }, async () => ({ ok: true, detail: null }));
    await shipDone();
    const reply = await mark("review", "started");
    expect(ran).toEqual(["script:preview"]);
    expect(reply).not.toContain("Undo");
  });

  it("первый старт этапа — не доработка: откат не идёт", async () => {
    const { ran, mark } = setup(withUndo, async () => ({ ok: true, detail: null }));
    await mark("review", "started");
    expect(ran).toEqual([]);
  });
});
