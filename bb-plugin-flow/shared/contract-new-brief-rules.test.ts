// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

const add = (target: number, max: number, risk: number) => ({ target, max, risk });

const option = (id: string, extra: Record<string, unknown> = { add: add(1, 2, 1) }) => ({ id, action: `Вариант ${id}`, description: "Что произойдёт", ...extra });
const fork = (overrides: Record<string, unknown> = {}) => ({ id: "how", question: "Как?", kind: "fork", options: [option("a"), option("b")], ...overrides });
const params = (overrides: Record<string, unknown> = {}) => ({ title: "Бриф", setup: { executor: { recommended: "self" } }, questions: [fork()], ...overrides });
const accepts = (value: unknown) => askDecisionParamsSchema.safeParse(value).success;
const stored = (overrides: Record<string, unknown>) => ({ id: "dec_1", threadId: "thr_1", createdAt: "2026-09-13T00:00:00.000Z", title: "Старый", kind: "brief", questions: [], ...overrides });

describe("правила нового брифа на валидной фикстуре", () => {
  it("базовая фикстура проходит", () => {
    expect(accepts(params())).toBe(true);
  });

  it("идентификатор вопроса с префиксом setup. отбивается", () => {
    expect(accepts(params({ questions: [fork({ id: "setup.priority" })] }))).toBe(false);
  });

  it("toggles и choice в новом брифе отбиваются инструментом, но читаются из хранилища", () => {
    const toggles = { id: "t", question: "Артефакты", kind: "toggles", options: [{ id: "a", action: "A" }, { id: "b", action: "B" }] };
    const choice = { id: "c", question: "Приоритет", kind: "choice", options: [{ id: "a", action: "A" }, { id: "b", action: "B" }] };
    expect(accepts(params({ questions: [toggles] }))).toBe(false);
    expect(accepts(params({ questions: [choice] }))).toBe(false);
    expect(decisionBriefSchema.safeParse(stored({ questions: [toggles, choice] })).success).toBe(true);
  });

  it("fork и pick из одного варианта отбиваются", () => {
    expect(accepts(params({ questions: [fork({ options: [option("a")] })] }))).toBe(false);
    expect(accepts(params({ questions: [{ id: "p", question: "Какие?", kind: "pick", options: [option("a")] }] }))).toBe(false);
  });

  it("у pick добавка может стоять только у части вариантов: без добавки — «+0»", () => {
    expect(accepts(params({ questions: [{ id: "p", question: "Какие?", kind: "pick", options: [option("a"), option("b", {})] }] }))).toBe(true);
  });
});
