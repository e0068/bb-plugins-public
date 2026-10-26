// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { selfUpdatePendingKey } from "@bb-plugins/automation-steps/index";
import type { PluginsPort, StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_local";
const T0 = "2026-10-25T10:00:00.000Z";

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "land", executors: [], automation: { source: "flow", steps: ["git.pull-main"] } };

/** Шаг Pull Main откладывает пересборку Flow, как настоящий; `log` — что сделали с плагинами хоста. */
const setup = (source: string) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const log: string[] = [];
  const settings: StageSettings = { stages: [stage("review"), land], minButtonWidth: 170 };
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const steps = Object.fromEntries(
    STEP_IDS.map((id: StepId) => [
      id,
      async (threadId: string): Promise<StepOutcome> => {
        if (id === "git.pull-main") await bb.storage.kv.set(selfUpdatePendingKey(threadId), "flow");
        return { ok: true, detail: null };
      },
    ]),
  ) as unknown as Steps;
  const plugins: PluginsPort = {
    list: async () => ({ plugins: [{ id: "flow", source, version: "0.6.173" }] }),
    applyUpdate: async ({ pluginId }) => void log.push(`update:${pluginId}`),
    install: async (args) => void log.push(`install:${args.source}`),
    remove: async () => undefined,
  };
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    thread: async () => ({ active: false, providerId: "claude-code" }),
    providers: async () => [],
    kv: bb.storage.kv,
    plugins,
    now: () => T0,
    onError: () => undefined,
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread: async () => ({ active: false, providerId: null, environmentId: null }) });
  const run = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(() => expect(log).not.toEqual([]));
  };
  return { run, log };
};

describe("Flow из папки основной копии после цепочки", () => {
  it("пересобирается установкой из той же папки, а не обновлением, которое папку не перечитывает", async () => {
    const { run, log } = setup("path:/repo/bb-plugin-flow");
    await run();
    expect(log).toEqual(["install:path:/repo/bb-plugin-flow"]);
  });

  it("Flow из git обновляется, как раньше", async () => {
    const { run, log } = setup("git:https://github.com/e0068/bb-plugins.git@main");
    await run();
    expect(log).toEqual(["update:flow"]);
  });
});
