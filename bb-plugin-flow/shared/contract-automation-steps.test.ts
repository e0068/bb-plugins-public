import { describe, expect, it } from "vitest";

import { automationRpcContract, awaitingEntrySchema, flowProgressSchema, progressStageSchema, workStageSchema } from "./contract";

const stage = { id: "publish", kind: "skill" as const, skill: "", name: "Publish", executors: [] };

describe("этап-автоматизация со шагами", () => {
  it("этап Automations без source разбирается как раньше", () => {
    expect(workStageSchema.parse({ ...stage, automation: { id: "click-pr", name: "Pull Request" } }).automation).toEqual({ id: "click-pr", name: "Pull Request" });
  });

  it("этап Automations хранит подписи шагов снимком", () => {
    expect(workStageSchema.parse({ ...stage, automation: { id: "click-pr", name: "Pull Request", steps: ["Open a PR"] } }).automation).toEqual({ id: "click-pr", name: "Pull Request", steps: ["Open a PR"] });
  });

  it("встроенная автоматизация принимает только известные шаги", () => {
    expect(workStageSchema.safeParse({ ...stage, automation: { source: "flow", steps: ["git.create-pr", "bb.archive"] } }).success).toBe(true);
    expect(workStageSchema.safeParse({ ...stage, automation: { source: "flow", steps: ["git.push"] } }).success).toBe(false);
  });

  it("встроенная автоматизация может быть пустой, пока владелец не добавил шаги", () => {
    expect(workStageSchema.safeParse({ ...stage, automation: { source: "flow", steps: [] } }).success).toBe(true);
  });
});

describe("прогресс автоматизации", () => {
  it("прогресс без run разбирается", () => {
    expect(flowProgressSchema.safeParse({ stages: { review: { startedAt: "2026-09-17T10:00:00.000Z" } }, waiting: [] }).success).toBe(true);
  });

  it("run хранит шаги, место и ошибку", () => {
    const run = { steps: [{ id: "git.merge", label: "Merge the PR" }], at: 0, error: "not mergeable" };
    expect(flowProgressSchema.parse({ stages: { publish: { startedAt: "2026-09-17T10:00:00.000Z", run } }, waiting: [] }).stages.publish?.run).toEqual(run);
  });

  it("этап полосы бывает упавшим и несёт шаги автоматизации", () => {
    const view = { id: "publish", kind: "skill", name: "Publish", executor: "self", state: "fail", results: [], minutes: null, cost: null, automation: { steps: [{ id: "git.merge", label: "Merge the PR", state: "fail", error: "not mergeable" }] } };
    expect(progressStageSchema.safeParse(view).success).toBe(true);
  });

  it("ждущий тред вида automation проходит схему", () => {
    expect(awaitingEntrySchema.safeParse({ briefId: "automation:publish", kind: "automation" }).success).toBe(true);
  });

  it("контракт автоматизаций отдаёт повтор и идущие треды", () => {
    expect(automationRpcContract.retryAutomation.output.parse({ started: true })).toEqual({ started: true });
    expect(automationRpcContract.runningThreads.output.parse([{ threadId: "t1", icon: "automation" }])).toEqual([{ threadId: "t1", icon: "automation" }]);
  });
});
