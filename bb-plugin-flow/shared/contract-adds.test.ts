// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionAnswerSchema } from "./contract";

const accepts = (value: unknown) => askDecisionParamsSchema.safeParse(value).success;
const add = (target: number, max: number, risk: number) => ({ target, max, risk });

const forkOption = (id: string, extra: Record<string, unknown>) => ({ id, action: `Вариант ${id}`, description: "Что произойдёт", ...extra });
const fork = (a: Record<string, unknown>, b: Record<string, unknown>) => ({
  title: "Бриф",
  questions: [{ id: "how", question: "Как?", kind: "fork", options: [forkOption("a", { recommended: true, ...a }), forkOption("b", b)] }],
});

describe("добавки к бюджету и риску", () => {
  it("вариант развилки несёт добавку вместо цены и уровня риска", () => {
    expect(accepts(fork({ add: add(3, 5, 2) }, { add: add(1, 2, -1) }))).toBe(true);
  });

  it("пункт критерия — строка или объект с добавкой; пункт-изменение несёт и было, и стало", () => {
    const setup = (criteria: unknown[]) => ({ title: "Бриф", setup: { criteria } });
    expect(accepts(setup(["Тест зелёный", { text: "Кнопка бюджета", before: "Два ряда", after: "Одна кнопка", add: add(4, 7, 2) }]))).toBe(true);
    expect(accepts(setup([{ text: "Кнопка бюджета", before: "Два ряда" }]))).toBe(false);
    expect(accepts(setup([{ text: "Кнопка бюджета", after: "Одна кнопка" }]))).toBe(false);
  });

  it("добавки у артефакта, исполнителя, проверяющего и его моделей", () => {
    const artifacts = [
      { id: "task", name: "Задача", state: "missing", add: add(0.5, 1, 0) },
      { id: "prototype", name: "HTML-прототип", state: "missing" },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true, add: add(2, 3, -2) },
      { id: "plan", name: "План", state: "missing" },
    ];
    expect(
      accepts({
        title: "Бриф",
        setup: {
          artifacts,
          executor: { recommended: "subagents", adds: { self: add(0, 0, 0), subagents: add(3, 5, 1), fanout: add(14, 24, 3) } },
          checker: { recommended: "agent", adds: { self: add(0, 0, 0) }, models: [{ name: "Opus 5", recommended: true, add: add(3, 5, -3) }] },
        },
      }),
    ).toBe(true);
  });

  it("своя цена в ответе — цель и потолок текстом", () => {
    expect(decisionAnswerSchema.safeParse({ briefId: "dec_1", answers: [], budget: { target: "$25", max: "$40" } }).success).toBe(true);
  });
});
