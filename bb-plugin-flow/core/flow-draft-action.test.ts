// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type FlowDraft, type StageCatalog } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";

const catalog: StageCatalog = { skills: [{ name: "task-flow" }], executors: [{ id: "agent:tester", kind: "agent", name: "tester", model: "haiku", provider: "claude-code" }] };
const draft = (stages: FlowDraft["stages"]): FlowDraft => flowDraftSchema.parse({ name: "General", stages });
const resolve = (stages: FlowDraft["stages"]) => resolveFlowDraft(draft(stages), catalog, () => "abc");

describe("этап Action в черновике flow от агента", () => {
  it("этап Action получает id, английское название и свои шаги", () => {
    const result = resolve([{ kind: "skill", skill: "task-flow" }, { kind: "action", automation: { source: "flow", steps: ["git.create-pr", "bb.tasks-in-review"] } }]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flow.stages[1]).toEqual({ id: "flow-action", kind: "action", skill: "", name: "Action", executors: [], automation: { source: "flow", steps: ["git.create-pr", "bb.tasks-in-review"] } });
  });

  it("этап Action с исполнителем отклоняется: его шаги запускает владелец", () => {
    const result = resolve([{ kind: "action", automation: { source: "flow", steps: [] }, executors: ["agent:tester"] }]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(" ")).toContain("takes no executor");
  });

  it("два этапа Action в одном flow получают разные id", () => {
    const result = resolve([{ kind: "action", automation: { source: "flow", steps: [] } }, { kind: "action", automation: { source: "flow", steps: ["git.merge"] } }]);
    expect(result.ok && result.flow.stages.map((s) => s.id)).toEqual(["flow-action", "flow-action-2"]);
  });
});
