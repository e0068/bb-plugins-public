// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { STEP_IDS } from "../packages/automation-steps/catalog";
import type { Steps } from "../packages/automation-steps/index";
import { stage } from "../core/stages-fixtures";
import type { AwaitingEntry } from "./store";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_wait";
const T0 = "2026-09-18T12:00:00.000Z";

const okSteps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => ({ ok: true as const, detail: null })])) as unknown as Steps;

const automation = (id: string): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps: ["git.merge"] } });

/** Flow с этапом навыка, автоматизацией за ним и Демонстрацией следом. */
const STAGES: WorkStage[] = [stage("practice", { name: "Работа" }), automation("land"), stage("demo", { kind: "demo", skill: "", name: "Демонстрация" })];

const setup = async (awaiting?: AwaitingEntry) => {
  const settings: StageSettings = { stages: STAGES, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (awaiting !== undefined) await store.putAwaiting(THREAD, awaiting);
  const woken: string[] = [];
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps: okSteps,
    external: async () => ({ ok: true, detail: null }),
    thread,
    providers: async () => [],
    wake: async (threadId) => void woken.push(threadId),
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    onError: (error) => {
      throw error;
    },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  const stateOf = async (id: string) =>
    ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string }> } | null)?.stages.find((s) => s.id === id)?.state;
  const play = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "practice", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
  };
  return { woken, play };
};

describe("доигранная автоматизация и ожидание владельца", () => {
  it("тред ждёт ответа на Демонстрацию — агенту не уходит ничего", async () => {
    const { woken, play } = await setup({ briefId: "dec_demo", kind: "demo" });
    await play();
    expect(woken).toEqual([]);
  });

  it("тред ничего не ждёт — реплика уходит, как раньше", async () => {
    const { woken, play } = await setup();
    await play();
    await vi.waitFor(() => expect(woken).toEqual([THREAD]));
  });

  it("ожидание самой автоматизации пробуждение не подавляет", async () => {
    const { woken, play } = await setup({ briefId: "automation:land", kind: "automation" });
    await play();
    await vi.waitFor(() => expect(woken).toEqual([THREAD]));
  });
});
