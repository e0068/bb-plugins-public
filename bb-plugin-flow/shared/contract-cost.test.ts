// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

const option = (id: string, cost: string) => ({ id, action: `Вариант ${id}`, description: "Что произойдёт", cost, risk: "S" });
const brief = (kind: string, cost: string) => ({ title: "Бриф", questions: [{ id: "q", question: "Как?", kind, options: [option("a", cost), option("b", "~1M")] }] });

const sentence = "Меньше текущей спецификации: остаются снос списка, раскладка и граница падения; 200k–400k";

describe("цена варианта — короткая оценка", () => {
  it("цена в 40 символов проходит, в 41 — отбивается с подсказкой перенести пояснение в description", () => {
    expect(askDecisionParamsSchema.safeParse(brief("fork", "x".repeat(40))).success).toBe(true);
    const result = askDecisionParamsSchema.safeParse(brief("fork", "x".repeat(41)));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("description");
  });

  it("длинная цена отбивается и у pick", () => {
    expect(askDecisionParamsSchema.safeParse(brief("pick", sentence)).success).toBe(false);
  });

  it("сохранённый бриф с длинной ценой читается", () => {
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-13T00:00:00.000Z", kind: "brief", ...brief("fork", sentence) };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(true);
  });
});
