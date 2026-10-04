// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";

const catalog: StageCatalog = { skills: [{ name: "task-flow" }], executors: [{ id: "agent:tester", kind: "agent", name: "tester", model: "haiku", provider: "claude-code" }] };
const draft = (stages: FlowDraft["stages"]): FlowDraft => flowDraftSchema.parse({ name: "General", stages });
const resolve = (stages: FlowDraft["stages"]) => resolveFlowDraft(draft(stages), catalog, () => "abc");
const problems = (stages: FlowDraft["stages"]) => {
  const result = resolve(stages);
  return result.ok ? [] : result.problems;
};

describe("этап «Flow» в черновике flow от агента", () => {
  it("строка с flowId собирается без навыка: id nested-flow, название — flowId", () => {
    const result = resolve([{ kind: "skill", flowId: "answer" }]);
    expect(result.ok && result.flow.stages).toEqual([{ id: "nested-flow", kind: "skill", skill: "", name: "answer", executors: [], flowId: "answer" }]);
  });

  it("название из черновика сохраняется", () => {
    const result = resolve([{ kind: "skill", flowId: "answer", name: "Ответ" }]);
    expect(result.ok && result.flow.stages[0]?.name).toBe("Ответ");
  });

  it("две строки в одном flow получают разные id", () => {
    const result = resolve([{ kind: "skill", flowId: "answer" }, { kind: "skill", flowId: "code" }]);
    expect(result.ok && result.flow.stages.map((s) => s.id)).toEqual(["nested-flow", "nested-flow-2"]);
  });

  it("строка среди обычных этапов не мешает им", () => {
    const result = resolve([{ kind: "skill", skill: "task-flow" }, { kind: "skill", flowId: "answer" }]);
    expect(result.ok && result.flow.stages.map((s) => s.flowId)).toEqual([undefined, "answer"]);
  });

  it.each([
    ["навыком", { skill: "task-flow" }],
    ["исполнителем", { executors: ["agent:tester"] }],
    ["автоматизацией", { automation: { source: "flow" as const, steps: [] } }],
    ["владельцем", { parent: "demo" }],
  ])("строка вместе с %s отклоняется сообщением с номером этапа", (_, patch) => {
    expect(problems([{ kind: "skill", flowId: "answer", ...patch }]).join(" ")).toContain("stage 1: a flow stage takes no");
  });

  it("flowId у этапа не вида skill отклоняется", () => {
    expect(problems([{ kind: "demo", flowId: "answer" }]).join(" ")).toContain("stage 1: flowId belongs to a stage of kind skill");
  });
});
