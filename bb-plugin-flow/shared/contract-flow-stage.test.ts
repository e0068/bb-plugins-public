// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowSchema, stageDraftSchema, workStageSchema } from "./contract";

const ref = { id: "nested", kind: "skill", skill: "", name: "Answer", executors: [], flowId: "answer" };
const flow = (stages: unknown[]) => ({ id: "plugin", name: "BB Plugin", stages });

describe("этап «Flow» в схеме", () => {
  it("строка только с flowId принимается и читается как есть", () => {
    expect(workStageSchema.parse(ref)).toEqual(ref);
  });

  it("этап без flowId читается без изменений", () => {
    const plain = { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] };
    expect(workStageSchema.parse(plain)).toEqual(plain);
  });

  it.each([
    ["навык", { skill: "spec" }],
    ["исполнитель", { executors: [{ id: "agent:planner", kind: "agent", name: "planner" }] }],
    ["автоматизация", { automation: { source: "flow", steps: [] } }],
    ["владелец", { parent: "demo" }],
    ["снятый Main Agent", { mainAgent: false }],
  ])("строка с flowId и полем «%s» не принимается", (_, patch) => {
    expect(workStageSchema.safeParse({ ...ref, ...patch }).success).toBe(false);
  });

  it("под-этап, чей владелец — строка «Flow», не принимается", () => {
    const sub = { id: "preview", kind: "skill", skill: "preview", name: "Preview", executors: [], parent: "nested" };
    expect(flowSchema.safeParse(flow([sub, ref])).success).toBe(false);
  });

  it("flow со строкой «Flow» без под-этапов принимается", () => {
    expect(flowSchema.safeParse(flow([ref])).success).toBe(true);
  });

  it("черновик агента несёт flowId", () => {
    expect(stageDraftSchema.parse({ kind: "skill", flowId: "answer" })).toEqual({ kind: "skill", flowId: "answer" });
  });
});
