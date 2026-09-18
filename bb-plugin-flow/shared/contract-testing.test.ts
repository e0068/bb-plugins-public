// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

const parse = (value: unknown) => askDecisionParamsSchema.safeParse(value);
const accepts = (value: unknown) => parse(value).success;
const withSetup = (setup: Record<string, unknown>) => ({ title: "Бриф", setup });
const executor = (recommended: string, adds?: Record<string, unknown>) => ({ executor: { recommended, ...(adds === undefined ? {} : { adds }) } });

describe("добавка — разница с базой по деньгам, риску и времени", () => {
  it("add принимает отрицательные деньги при max не ниже target", () => {
    expect(accepts(withSetup(executor("subagents", { subagents: { target: -4, max: -2, risk: 1 } })))).toBe(true);
    expect(accepts(withSetup(executor("subagents", { subagents: { target: -2, max: -4, risk: 1 } })))).toBe(false);
  });

  it("add принимает minutes любого знака и отклоняет дробные", () => {
    expect(accepts(withSetup(executor("workflow", { workflow: { target: 3, max: 5, risk: 0, minutes: -15 } })))).toBe(true);
    expect(accepts(withSetup(executor("workflow", { workflow: { target: 3, max: 5, risk: 0, minutes: 20 } })))).toBe(true);
    expect(accepts(withSetup(executor("workflow", { workflow: { target: 3, max: 5, risk: 0, minutes: 2.5 } })))).toBe(false);
  });
});

describe("границы добавки", () => {
  const fork = (a: unknown) => ({
    title: "Бриф",
    questions: [{ id: "how", question: "Как?", kind: "fork", options: [{ id: "a", action: "А", description: "Что", recommended: true, add: a }, { id: "b", action: "Б", description: "Что", add: { target: 1, max: 2, risk: 0 } }] }],
  });

  it("потолок не ниже цели, риск — целое число в обе стороны", () => {
    expect(accepts(fork({ target: 5, max: 3, risk: 0 }))).toBe(false);
    expect(accepts(fork({ target: 1, max: 2, risk: 1.5 }))).toBe(false);
    expect(accepts(fork({ target: 0, max: 0, risk: -3 }))).toBe(true);
  });

  it("два рекомендованных в ряду бюджета записанного брифа отбиваются схемой хранилища", () => {
    const twice = { options: [{ id: "a", action: "$1", recommended: true }, { id: "b", action: "$2", recommended: true }] };
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-13T00:00:00.000Z", title: "Старый", setup: { budgetMax: twice } };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(false);
  });
});

describe("тестирование и ревью", () => {
  const models = [{ name: "Fable 5.1", recommended: true, add: { target: 8, max: 15, risk: -2, minutes: 10 } }];

  it("testing принимает ту же форму, что checker, с моделями", () => {
    expect(accepts(withSetup({ checker: { recommended: "agent", models }, testing: { recommended: "agent", adds: { self: { target: 1, max: 2, risk: 1 } }, models } }))).toBe(true);
    expect(accepts(withSetup({ ...executor("self"), testing: { recommended: "agent" } }))).toBe(false);
  });

  it("ревью и тестирование рекомендуют none", () => {
    expect(accepts(withSetup({ checker: { recommended: "none" }, testing: { recommended: "none" } }))).toBe(true);
  });

  it("workflow в testing без исполнителя workflow отклоняется", () => {
    expect(accepts(withSetup({ ...executor("self"), testing: { recommended: "workflow" } }))).toBe(false);
    expect(accepts(withSetup({ ...executor("fanout"), testing: { recommended: "workflow" } }))).toBe(true);
  });
});

describe("приоритета больше нет", () => {
  const priority = { options: [{ id: "speed", action: "Скорость" }, { id: "quality", action: "Качество", recommended: true }] };

  it("новый бриф с priority отклоняется сообщением priority is gone", () => {
    const result = parse(withSetup({ priority, ...executor("self") }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("priority is gone");
  });

  it("записанный бриф с priority читается хранилищем", () => {
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-14T10:00:00.000Z", title: "Бриф", setup: { priority } };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(true);
  });
});
