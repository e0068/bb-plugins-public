// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, type AutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_race";
const T0 = "2026-10-01T10:00:00.000Z";
const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "land", executors: [], automation: { source: "flow", steps: ["git.merge"] } };

describe("отмена посреди записи упавшего шага", () => {
  it("отмена, пришедшая, пока исполнитель читает запись упавшего шага, не оставляет ни прогона, ни ожидания, ни автоповтора", async () => {
    const settings: StageSettings = { stages: [stage("review"), land], minButtonWidth: 170 };
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    let advance: (threadId: string) => void = () => undefined;
    const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
    const store = createStore(bb.storage.kv);
    const timers: Array<() => void> = [];
    let runner: AutomationRunner | null = null;
    let cancelOnRead = false;
    // Шаг падает, и следующее чтение записи — уже чтение упавшего шага: на нём и приходит отмена.
    const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => ((cancelOnRead = true), { ok: false, error: "timed out" })])) as unknown as Steps;
    // Отмена владельца приходит ровно между падением шага и записью об этом.
    const racing = {
      ...progress,
      get: async (threadId: string) => {
        const record = await progress.get(threadId);
        if (cancelOnRead) {
          cancelOnRead = false;
          runner!.cancel(threadId);
          await progress.remove(threadId);
        }
        return record;
      },
    };
    const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
    const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
    runner = createAutomationRunner({ progress: racing, store, stages: () => settings, steps, external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins, now: () => T0, retry: () => ({ seconds: 30, attempts: 3 }), schedule: (run) => (timers.push(run), () => undefined), onError: () => undefined });
    advance = (threadId) => void runner!.advance(threadId);
    registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 50 });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(() => expect(cancelOnRead).toBe(false));
    await vi.waitFor(async () => expect(await progress.get(THREAD)).toBeNull());
    expect(timers).toEqual([]);
    expect(await store.listAwaiting()).toEqual([]);
  });
});
