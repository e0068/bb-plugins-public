// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowDraftSchema, type Flow, type FlowDraft, type StageCatalog, type StageExecutor } from "../shared/contract";
import { resolveFlowDraft } from "./flow-draft";
import { stage } from "./stages-fixtures";

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer" };
const catalog: StageCatalog = { skills: [{ name: "practice" }], executors: [reviewer] };
const draft = (stages: FlowDraft["stages"]): FlowDraft => flowDraftSchema.parse({ id: "default", name: "Default", stages });
const stored: Flow = { id: "default", name: "Default", stages: [stage("practice", { executors: [reviewer], mainAgent: false })] };

describe("снятый Main Agent и пересохранение flow агентом", () => {
  it("снятый владельцем Main Agent переживает пересохранение flow агентом", () => {
    const result = resolveFlowDraft(draft([{ id: "practice", kind: "skill", skill: "practice", executors: ["agent:reviewer"] }]), catalog, () => "abc", stored);
    expect(result.ok && result.flow.stages[0]!.mainAgent).toBe(false);
  });

  it("этап, у которого агент убрал всех исполнителей, снова ведёт Main Agent", () => {
    const result = resolveFlowDraft(draft([{ id: "practice", kind: "skill", skill: "practice" }]), catalog, () => "abc", stored);
    expect(result.ok && "mainAgent" in result.flow.stages[0]!).toBe(false);
  });
});
