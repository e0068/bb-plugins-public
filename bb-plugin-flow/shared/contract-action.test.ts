// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import { automationRpcContract, awaitingEntrySchema, decisionAnswerSchema, dispatchPlaceSchema, flowProgressSchema, progressStageSchema, stageDraftSchema, workStageSchema } from "./contract";

const answer = { briefId: "dec_1", answers: [] };

describe("схемы этапа Action и дочернего треда", () => {
  it("этап вида action проходит схему работ и черновик flow", () => {
    const stage = actionStage([]);
    expect(workStageSchema.parse(stage).kind).toBe("action");
    expect(stageDraftSchema.parse({ kind: "action", automation: { source: "flow", steps: ["git.create-pr"] } }).kind).toBe("action");
  });

  it("идущий шаг помечен в прогоне признаком busy", () => {
    const progress = flowProgressSchema.parse({
      stages: { publish: { startedAt: "2026-09-17T10:00:00.000Z", run: { steps: [{ id: "git.create-pr", label: "Create PR" }], at: 0, error: null, busy: true } } },
      waiting: ["publish"],
    });
    expect(progress.stages.publish?.run?.busy).toBe(true);
    expect(flowProgressSchema.parse({ stages: { publish: { run: { steps: [], at: 0, error: null } } }, waiting: [] }).stages.publish?.run?.busy).toBeUndefined();
  });

  it("шаг, который ждёт нажатия, — состояние wait", () => {
    const stage = {
      id: "publish",
      kind: "action" as const,
      name: "Publish",
      executor: "self" as const,
      state: "now" as const,
      results: [],
      minutes: null,
      cost: null,
      automation: { steps: [{ id: "git.create-pr", label: "Create PR", state: "wait" as const, error: null }] },
    };
    expect(progressStageSchema.parse(stage).automation?.steps[0]?.state).toBe("wait");
  });

  it("место исполнения — этот тред, новый или дочерний", () => {
    expect(dispatchPlaceSchema.parse("child")).toBe("child");
    expect(decisionAnswerSchema.parse({ ...answer, place: "child" }).place).toBe("child");
  });

  it("тред ждёт владельца на этапе Action", () => {
    expect(awaitingEntrySchema.parse({ briefId: "action:publish", kind: "action" }).kind).toBe("action");
  });

  it("запуск шага Action описан отдельным методом RPC", () => {
    expect(automationRpcContract.runActionStep.input.parse({ threadId: "thr_1", stage: "publish" })).toEqual({ threadId: "thr_1", stage: "publish" });
    expect(automationRpcContract.runActionStep.output.parse({ started: true })).toEqual({ started: true });
  });
});
