// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

const scale = (...actions: string[]) => ({
  options: actions.map((action, i) => ({ id: `o${i}`, action, recommended: i === 1 })),
});

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: "spec",
  name: "Спека",
  state: "missing",
  recommended: true,
  ...overrides,
});

const setup = (overrides: Record<string, unknown> = {}) => ({
  artifacts: [
    artifact({ id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-312", target: "docs/tasks/todo/sl-312.md" } }),
    artifact({ id: "prototype", name: "HTML-прототип", state: "ready", recommended: false, link: { label: "prototype-312", target: "docs/assets/p.html" } }),
    artifact({ id: "spec", name: "Спецификация", state: "stale" }),
    artifact({ id: "plan", name: "План", state: "missing" }),
  ],
  priority: scale("Скорость", "Качество", "Цена"),
  ...overrides,
});

const forkOption = (id: string, recommended = false) => ({
  id,
  action: `Вариант ${id}`,
  recommended,
  description: "Что произойдёт",
  cost: "~1M",
  risk: "M",
});

const fork = (overrides: Record<string, unknown> = {}) => ({
  id: "how",
  question: "Как устроена первая часть?",
  kind: "fork",
  options: [forkOption("a", true), forkOption("b")],
  ...overrides,
});

const params = (overrides: Record<string, unknown> = {}) => ({ title: "Бриф", setup: setup(), questions: [fork()], ...overrides });

const accepts = (value: unknown) => askDecisionParamsSchema.safeParse(value).success;

describe("вторая часть брифа — вопросы", () => {
  it("yesno внутри брифа отбивается, в уточнении проходит", () => {
    const yesno = { id: "y", question: "Так?", kind: "yesno", options: [{ id: "yes", action: "Да" }, { id: "no", action: "Нет" }] };
    expect(accepts({ title: "Бриф", questions: [fork(), yesno] })).toBe(false);
    expect(accepts({ title: "Уточнение", kind: "clarify", questions: [yesno] })).toBe(true);
    expect(accepts({ title: "Уточнение", kind: "clarify", setup: setup(), questions: [yesno] })).toBe(false);
  });
});
