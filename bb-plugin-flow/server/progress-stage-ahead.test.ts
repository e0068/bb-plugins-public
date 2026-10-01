// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_ahead";
const AT = "2026-10-01T10:00:00.000Z";

const setup = async () => {
  const settings: StageSettings = { stages: [stage("plan"), stage("code"), stage("review")], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv);
  registerProgress(bb, progress, { now: () => AT, stages: () => settings, windowCost: async () => undefined, thread: async () => ({ active: false, providerId: null, environmentId: null }) });
  // Бриф убрал план, агент начал код.
  await progress.update(THREAD, () => ({ stages: { plan: { skipped: true }, code: { startedAt: AT } }, waiting: [] }));
  const set = (stageId: string, run: boolean) => harness.callRpc("setStageInRun", { threadId: THREAD, stageId, run });
  const mark = (stageId: string, state: "started" | "done") => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: stageId, state }, { threadId: THREAD }) as Promise<unknown>;
  return { set, mark };
};

const text = (answer: unknown): string => (typeof answer === "string" ? answer : JSON.stringify(answer));

describe("чекбокс этапа не трогает то, что прогон уже миновал", () => {
  it("убранный этап позади идущего не возвращается", async () => {
    const { set } = await setup();
    expect(await set("plan", true)).toEqual({ kind: "failed", reason: "reached" });
  });

  it("возвращённый этап впереди агент получает в ответе на отметку предыдущего", async () => {
    const { set, mark } = await setup();
    await set("review", false);
    await set("review", true);
    expect(text(await mark("code", "done"))).toContain('The owner put stage review "review" back into the run');
  });
});
