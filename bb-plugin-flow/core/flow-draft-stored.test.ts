// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type Flow, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";
import { stage } from "./stages-fixtures";

const catalog: StageCatalog = { skills: [{ name: "flow" }, { name: "practice" }], executors: [] };
const stored: Flow = { id: "default", name: "Default", stages: [stage("task", { skill: "task-flow", name: "Task" }), stage("practice")] };
const draft = (stages: FlowDraft["stages"], id = "default"): FlowDraft => flowDraftSchema.parse({ id, name: "Default", stages });
const problemsOf = (d: FlowDraft, previous: Flow | undefined) => {
  const result = resolveFlowDraft(d, catalog, () => "abc", previous);
  return result.ok ? [] : result.problems;
};

describe("черновик flow поверх сохранённого", () => {
  it("этап, который уже был в сохранённом flow, сохраняется, хоть его навыка и нет в каталоге", () => {
    const result = resolveFlowDraft(draft([{ id: "task", kind: "skill", skill: "task-flow", name: "Task" }, { id: "practice", kind: "skill", skill: "practice" }, { kind: "demo" }]), catalog, () => "abc", stored);
    expect(result.ok && result.flow.stages.map((s) => s.id)).toEqual(["task", "practice", "demo"]);
  });

  it("новый этап с навыком не из каталога по-прежнему отклоняется", () => {
    expect(problemsOf(draft([{ id: "task-2", kind: "skill", skill: "task-flow" }]), stored)).toEqual(['stage 1: the skill "task-flow" is not in the catalog']);
    expect(problemsOf(draft([{ id: "task", kind: "skill", skill: "spec" }]), stored)).toEqual(['stage 1: the skill "spec" is not in the catalog']);
  });
});
