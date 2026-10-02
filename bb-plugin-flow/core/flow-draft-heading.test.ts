// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type Flow, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";
import { stage } from "./stages-fixtures";

const catalog: StageCatalog = { skills: [{ name: "lint" }, { name: "practice" }], executors: [] };
const draft = (stages: FlowDraft["stages"]): FlowDraft => flowDraftSchema.parse({ id: "default", name: "Default", stages });

describe("черновик flow с заголовком и иконками", () => {
  it("этап без навыка с под-этапами — заголовок, черновик принят", () => {
    const result = resolveFlowDraft(draft([{ id: "review", kind: "skill", name: "Ревью" }, { id: "lint", kind: "skill", skill: "lint", parent: "review" }]), catalog, () => "abc");
    expect(result.ok && result.flow.stages.map((s) => [s.id, s.skill])).toEqual([["review", ""], ["lint", "lint"]]);
  });

  it("этап без навыка и без под-этапов по-прежнему отклоняется", () => {
    const result = resolveFlowDraft(draft([{ id: "review", kind: "skill", name: "Ревью" }]), catalog, () => "abc");
    expect(result.ok ? [] : result.problems).toEqual(["stage 1: a skill stage needs a skill or an automation"]);
  });

  it("иконка, выбранная владельцем, переживает пересохранение flow агентом", () => {
    const stored: Flow = { id: "default", name: "Default", stages: [stage("practice", { icon: "Rocket" })] };
    const result = resolveFlowDraft(draft([{ id: "practice", kind: "skill", skill: "practice" }]), catalog, () => "abc", stored);
    expect(result.ok && result.flow.stages[0]!.icon).toBe("Rocket");
  });
});
