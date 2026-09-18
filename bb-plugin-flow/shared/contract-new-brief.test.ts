// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionAnswerSchema, decisionBriefSchema } from "./contract";

const add = (target: number, max: number, risk: number) => ({ target, max, risk });
const scale = (...actions: string[]) => ({ options: actions.map((action, i) => ({ id: `o${i}`, action, recommended: i === 1 })) });

const setup = (overrides: Record<string, unknown> = {}) => ({
  artifacts: [
    { id: "task", name: "Задача", state: "approved", link: { label: "SL-312", target: "memory/tasks/todo/sl-312.md" } },
    { id: "prototype", name: "HTML-прототип", state: "ready", link: { label: "p.html", target: "memory/assets/p.html" } },
    { id: "spec", name: "Спецификация", state: "stale", recommended: true },
    { id: "plan", name: "План", state: "missing", recommended: true },
  ],
  executor: { recommended: "self" },
  ...overrides,
});

const forkOption = (id: string, extra: Record<string, unknown> = { add: add(1, 2, 1) }) => ({ id, action: `Вариант ${id}`, description: "Что произойдёт", ...extra });
const fork = (options: unknown[] = [forkOption("a"), forkOption("b")]) => ({ id: "how", question: "Как устроена первая часть?", kind: "fork", options });
const params = (overrides: Record<string, unknown> = {}) => ({ title: "Бриф", setup: setup(), questions: [fork()], ...overrides });
const accepts = (value: unknown) => askDecisionParamsSchema.safeParse(value).success;

describe("новый бриф — схема инструмента", () => {
  it("бриф с первой частью и развилкой проходит, только первая часть — тоже, пустой — нет", () => {
    expect(accepts(params())).toBe(true);
    expect(accepts(params({ questions: [] }))).toBe(true);
    expect(accepts({ title: "Пусто" })).toBe(false);
    expect(accepts({ title: "Пусто", setup: {} })).toBe(false);
  });

  it("два ряда бюджета больше не принимаются: бюджет складывается из добавок", () => {
    expect(accepts(params({ setup: setup({ budgetTarget: scale("—", "$15", "$30") }) }))).toBe(false);
    expect(accepts(params({ setup: setup({ budgetMax: scale("—", "$30", "$60") }) }))).toBe(false);
  });

  it("записанный раньше бриф с двумя рядами бюджета хранилище читает", () => {
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-13T00:00:00.000Z", title: "Старый", kind: "brief", setup: setup({ budgetTarget: scale("—", "$15"), budgetMax: scale("—", "$30") }), questions: [] };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(true);
  });

  it("в одном вопросе добавка у всех вариантов или ни у одного", () => {
    const priced = forkOption("b", { cost: "~1M", risk: "M" });
    expect(accepts(params({ questions: [fork([forkOption("a"), priced])] }))).toBe(false);
    expect(accepts(params({ questions: [fork([forkOption("a", { cost: "~1M", risk: "S" }), priced])] }))).toBe(true);
  });

  it("развилка без добавки требует уровень риска из шкалы XS…XXL", () => {
    expect(accepts(params({ questions: [fork([forkOption("a", { cost: "~1M" }), forkOption("b", { cost: "~1M", risk: "M" })])] }))).toBe(false);
    for (const risk of ["XS", "S", "M", "L", "XL", "XXL"])
      expect(accepts(params({ questions: [fork([forkOption("a", { cost: "~1M", risk }), forkOption("b", { cost: "~1M", risk: "M" })])] }))).toBe(true);
  });

  it("pick держит несколько рекомендованных и требует описания; confirm несёт ровно один вариант", () => {
    const option = (id: string) => ({ id, action: `Правка ${id}`, recommended: true, description: "Что поменяется" });
    expect(accepts(params({ questions: [{ id: "p", question: "Какие правки?", kind: "pick", options: [option("a"), option("b")] }] }))).toBe(true);
    const { description: _d, ...bare } = option("b");
    expect(accepts(params({ questions: [{ id: "p", question: "Какие правки?", kind: "pick", options: [option("a"), bare] }] }))).toBe(false);
    const confirm = (options: unknown[]) => ({ id: "c", question: "Правильно ли я понял?", kind: "confirm", options });
    expect(accepts(params({ questions: [confirm([{ id: "yes", action: "Да" }])] }))).toBe(true);
    expect(accepts(params({ questions: [confirm([{ id: "yes", action: "Да" }, { id: "no", action: "Нет" }])] }))).toBe(false);
  });

  it("разбор сохраняет добавки, своя цена и пункт-изменение не теряются", () => {
    const parsed = askDecisionParamsSchema.parse({
      title: "Бриф",
      setup: {
        executor: { recommended: "subagents", adds: { subagents: add(3, 5, 1) } },
        checker: { recommended: "agent", adds: { self: add(0, 0, 1) }, models: [{ name: "Opus 5", recommended: true, add: add(3, 5, -3) }] },
        criteria: [{ text: "Кнопка", before: "Два ряда", after: "Одна кнопка", add: add(5, 9, 3) }],
      },
      questions: [fork()],
    });
    expect(parsed.setup?.executor?.adds?.subagents).toEqual(add(3, 5, 1));
    expect(parsed.setup?.checker?.adds?.self).toEqual(add(0, 0, 1));
    expect(parsed.setup?.checker?.models?.[0]?.add).toEqual(add(3, 5, -3));
    expect(parsed.setup?.criteria?.[0]).toEqual({ text: "Кнопка", before: "Два ряда", after: "Одна кнопка", add: add(5, 9, 3) });
    expect(parsed.questions[0]?.options[0]?.add).toEqual(add(1, 2, 1));
    expect(decisionAnswerSchema.parse({ briefId: "dec_1", answers: [], budget: { target: "$25", max: "$40" } }).budget).toEqual({ target: "$25", max: "$40" });
  });
});
