// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionAnswerSchema, decisionBriefSchema } from "./contract";

type Overrides = Record<string, Record<string, unknown>>;

const link = (label: string) => ({ label, target: `docs/${label}` });

/** Четыре артефакта в порядке брифа: задача, прототип, спецификация, план; `overrides` правит артефакт по id. */
const artifacts = (overrides: Overrides = {}) =>
  [
    { id: "task", name: "Задача", state: "approved", link: link("SL-1") },
    { id: "prototype", name: "HTML-прототип", state: "ready", link: link("prototype.html") },
    { id: "spec", name: "Спецификация", state: "missing", recommended: true },
    { id: "plan", name: "План", state: "missing" },
  ].map((a) => ({ ...a, ...overrides[a.id] }));

const withSetup = (setup: Record<string, unknown>) => ({ title: "Бриф", setup });
const issues = (value: unknown) => askDecisionParamsSchema.safeParse(value).error?.issues ?? [];
const accepts = (value: unknown) => issues(value).length === 0;

describe("артефакты нового брифа — прототип вторым, спецификация третьей", () => {
  it("задача, HTML-прототип, спецификация и план проходят", () => {
    expect(issues(withSetup({ artifacts: artifacts() }))).toEqual([]);
  });

  it("прежний порядок со спецификацией перед прототипом отбивается и называет новый", () => {
    const [task, prototype, spec, plan] = artifacts();
    const old = withSetup({ artifacts: [task, spec, prototype, plan] });
    expect(accepts(old)).toBe(false);
    expect(issues(old).map((i) => i.message).join(" ")).toContain("task, prototype, spec, plan");
  });

  it("без прототипа, с лишним артефактом или чужим именем колонки отбивается", () => {
    expect(accepts(withSetup({ artifacts: artifacts().filter((a) => a.id !== "prototype") }))).toBe(false);
    expect(accepts(withSetup({ artifacts: [...artifacts(), { id: "research", name: "Разбор", state: "missing" }] }))).toBe(false);
    expect(accepts(withSetup({ artifacts: artifacts({ prototype: { name: "Прототип" } }) }))).toBe(false);
  });
  it("отсутствующий со ссылкой отбивается, бриф без первой части проходит", () => {
    expect(accepts(withSetup({ artifacts: artifacts({ spec: { state: "missing", link: link("old.md") } }) }))).toBe(false);
    expect(accepts({ title: "Бриф", questions: [{ id: "c", question: "Так?", kind: "confirm", options: [{ id: "yes", action: "Да" }] }] })).toBe(true);
  });

  it("бриф со старым порядком из хранилища читается как был", () => {
    const [task, prototype, spec, plan] = artifacts();
    const stored = { id: "dec_1", threadId: "thr_1", createdAt: "2026-09-13T00:00:00.000Z", title: "Старый", kind: "brief", setup: { artifacts: [task, spec, prototype, plan] } };
    expect(decisionBriefSchema.safeParse(stored).success).toBe(true);
  });
});

describe("«Готово, когда» пунктами в первой части", () => {
  it("список пунктов проходит и сам по себе — это уже есть что решать", () => {
    expect(issues(withSetup({ criteria: ["Тест зелёный", "Кнопка видна"] }))).toEqual([]);
  });

  it("пустой список и пустой пункт отбиваются", () => {
    expect(accepts(withSetup({ criteria: [] }))).toBe(false);
    expect(accepts(withSetup({ criteria: ["Тест зелёный", "  "] }))).toBe(false);
  });

  it("уточнение с критерием отбивается: у clarify нет первой части", () => {
    const yesno = { id: "q", question: "Так?", kind: "yesno", options: [{ id: "yes", action: "Да" }, { id: "no", action: "Нет" }] };
    expect(accepts({ title: "У", kind: "clarify", setup: { criteria: ["Пункт"] }, questions: [yesno] })).toBe(false);
  });

  it("ответ несёт снятые, переписанные и добавленные пункты; без критерия поле не нужно", () => {
    const answer = { briefId: "dec_1", answers: [], criteria: { removed: [2], edited: [{ index: 0, text: "Новый" }], added: ["Ещё"] } };
    expect(decisionAnswerSchema.safeParse(answer).success).toBe(true);
    expect(decisionAnswerSchema.safeParse({ briefId: "dec_1", answers: [] }).success).toBe(true);
    expect(decisionAnswerSchema.safeParse({ ...answer, criteria: { removed: [-1], edited: [], added: [] } }).success).toBe(false);
  });
});
