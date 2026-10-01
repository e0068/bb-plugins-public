// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, stageReportSchema } from "./contract";

const fork = (a: unknown) => ({
  title: "Бриф",
  questions: [{ id: "how", question: "Как?", kind: "fork", options: [{ id: "a", action: "А", description: "Что", recommended: true, add: a }, { id: "b", action: "Б", description: "Что", add: { target: 1, max: 2, risk: 0 } }] }],
});
const forkAdd = (a: unknown) => askDecisionParamsSchema.parse(fork(a)).questions[0]?.options[0]?.add;

describe("добавка — диапазон, а не пара в строгом порядке", () => {
  it("target и max варианта в любом порядке приводятся к меньшей и большей границе", () => {
    expect(forkAdd({ target: 5, max: 3, risk: 0, minutes: 10 })).toEqual({ target: 3, max: 5, risk: 0, minutes: 10 });
    expect(forkAdd({ target: 3, max: 5, risk: 1 })).toEqual({ target: 3, max: 5, risk: 1 });
  });

  it("экономия у этапа старого брифа приводится так же: меньшая граница — target", () => {
    expect(stageReportSchema.parse({ id: "plan", state: "todo", add: { target: -2, max: -4, risk: 1 } }).add).toEqual({ target: -4, max: -2, risk: 1 });
  });

  it("риск — целое число в обе стороны", () => {
    expect(askDecisionParamsSchema.safeParse(fork({ target: 1, max: 2, risk: 1.5 })).success).toBe(false);
    expect(forkAdd({ target: 0, max: 0, risk: -3 })).toEqual({ target: 0, max: 0, risk: -3 });
  });
});

describe("adds.self у этапа — его add", () => {
  const parse = (patch: Record<string, unknown>) => stageReportSchema.parse({ id: "plan", state: "todo", ...patch });

  it("adds.self без add становится add этапа, разницы исполнителей остаются", () => {
    const parsed = parse({ adds: { self: { target: -2, max: -4, risk: 0 }, "agent:planner": { target: 1, max: 2, risk: -1 } } });
    expect(parsed.add).toEqual({ target: -4, max: -2, risk: 0 });
    expect(parsed.adds).toEqual({ "agent:planner": { target: 1, max: 2, risk: -1 } });
  });

  it("при присланном add побеждает add, а adds.self отбрасывается", () => {
    const parsed = parse({ add: { target: 1, max: 2, risk: 0 }, adds: { self: { target: 5, max: 6, risk: 1 } } });
    expect(parsed.add).toEqual({ target: 1, max: 2, risk: 0 });
    expect(parsed.adds).toBeUndefined();
  });
});
