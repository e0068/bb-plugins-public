// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionAnswerSchema, decisionBriefSchema, stageSettingsSchema } from "./contract";

const result = { label: "spec.md", target: "memory/specs/spec.md" };

const params = (stages: unknown[]) => ({ title: "Этапы", setup: { stages } });

describe("этапы работ в схемах", () => {
  it("в прогон рекомендуется только несделанный этап, id этапов не повторяются", () => {
    expect(askDecisionParamsSchema.safeParse(params([{ id: "spec", state: "done", results: [result], recommended: true }])).success).toBe(false);
    expect(askDecisionParamsSchema.safeParse(params([{ id: "a", state: "todo" }, { id: "a", state: "todo" }])).success).toBe(false);
  });

  it("исполнитель по умолчанию — сам, добавки исполнителей — по их id", () => {
    const parsed = askDecisionParamsSchema.parse(params([{ id: "plan", state: "todo", recommended: true, add: { target: 1, max: 2, risk: 0 }, adds: { "agent:planner": { target: 2, max: 3, risk: -1, minutes: 5 } } }]));
    expect(parsed.setup?.stages?.[0]?.executor).toBe("self");
    expect(parsed.setup?.stages?.[0]?.adds?.["agent:planner"]?.minutes).toBe(5);
  });

  it("бриф только с этапами — есть что решать", () => {
    expect(askDecisionParamsSchema.safeParse(params([{ id: "task", state: "todo" }])).success).toBe(true);
  });

  it("настройки: ширина кнопки в пределах 100–400, id этапов и исполнителей в этапе не повторяются", () => {
    const stage = { id: "plan", skill: "plan", name: "План", review: true, executors: [{ id: "agent:planner", kind: "agent", name: "planner" }] };
    expect(stageSettingsSchema.safeParse({ stages: [stage], minButtonWidth: 170 }).success).toBe(true);
    expect(stageSettingsSchema.safeParse({ stages: [stage], minButtonWidth: 99 }).success).toBe(false);
    expect(stageSettingsSchema.safeParse({ stages: [stage, stage], minButtonWidth: 170 }).success).toBe(false);
    expect(stageSettingsSchema.safeParse({ stages: [{ ...stage, executors: [stage.executors[0], stage.executors[0]] }], minButtonWidth: 170 }).success).toBe(false);
  });

  it("записанный бриф несёт снимок этапов, ответ — выбор по этапам", () => {
    const brief = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-15T00:00:00.000Z", title: "Этапы", stages: { list: [], minButtonWidth: 170 }, setup: { stages: [{ id: "task", state: "todo" }] } };
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
    const answer = { briefId: "dec_1", answers: [], stages: [{ id: "task", run: true, executor: "self", review: true, picked: ["run"] }] };
    expect(decisionAnswerSchema.safeParse(answer).success).toBe(true);
    expect(decisionAnswerSchema.safeParse({ ...answer, stages: [{ ...answer.stages[0], picked: ["colour"] }] }).success).toBe(false);
  });
});
