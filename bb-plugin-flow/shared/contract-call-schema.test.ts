// @vitest-environment node
// Схема вызова ask_decision не показывает агенту поля, которые сервер отвергает или не читает в новом брифе;
// схема чтения хранимых брифов их сохраняет, поэтому старые виджеты открываются как раньше.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

type Json = { properties?: Record<string, Json>; items?: Json; anyOf?: Json[]; enum?: string[] };

const callSchema = z.toJSONSchema(askDecisionParamsSchema, { io: "input" }) as Json;
const setupProps = callSchema.properties?.setup?.properties ?? {};
const stageProps = setupProps.stages?.items?.properties ?? {};
const questionProps = callSchema.properties?.questions?.items?.properties ?? {};
const optionProps = questionProps.options?.items?.properties ?? {};

const add = { target: 1, max: 2, risk: 1 };
const scale = { options: [{ id: "a", action: "A" }, { id: "b", action: "B", recommended: true }] };
const fork = { id: "how", question: "Как?", kind: "fork", options: [{ id: "a", action: "A", description: "а", add }, { id: "b", action: "B", description: "б", add }] };

describe("схема вызова ask_decision без отвергаемых полей", () => {
  it.each(["artifacts", "executor", "checker", "testing", "priority", "budgetTarget", "budgetMax"])("setup.%s в схеме вызова нет", (field) => {
    expect(setupProps).not.toHaveProperty(field);
  });

  it("первая часть вызова — Definition of Done и этапы", () => {
    expect(Object.keys(setupProps).sort()).toEqual(["criteria", "stages"]);
  });

  it("у этапа нет add и adds, а состояние — todo или done", () => {
    expect(stageProps).not.toHaveProperty("add");
    expect(stageProps).not.toHaveProperty("adds");
    expect(stageProps.state?.enum).toEqual(["todo", "done"]);
  });

  it("виды вопросов — fork, pick, confirm и yesno для уточнения", () => {
    expect(questionProps.kind?.enum).toEqual(["fork", "pick", "confirm", "yesno"]);
  });

  it("у варианта нет risks прозой, а cost и risk остаются", () => {
    expect(optionProps).not.toHaveProperty("risks");
    expect(optionProps).toHaveProperty("cost");
    expect(optionProps).toHaveProperty("risk");
  });

  it("пункт Definition of Done остаётся строкой или объектом с добавкой и парой «было»/«стало»", () => {
    const item = setupProps.criteria?.items;
    expect(item?.anyOf?.some((variant) => variant.properties?.before !== undefined && variant.properties?.add !== undefined)).toBe(true);
  });
});

describe("вызов с отвергаемым полем падает, а не пропадает молча", () => {
  const call = (setup: Record<string, unknown>) => askDecisionParamsSchema.safeParse({ title: "Бриф", setup: { criteria: ["a"], ...setup }, questions: [fork] });

  it("ряды бюджета и приоритет отбиваются схемой", () => {
    expect(call({}).success).toBe(true);
    expect(call({ budgetTarget: scale }).success).toBe(false);
    expect(call({ budgetMax: scale }).success).toBe(false);
    expect(call({ priority: scale }).success).toBe(false);
  });

  it("add у этапа отбивается, доля — нет", () => {
    expect(call({ stages: [{ id: "implement", state: "todo", add }] }).success).toBe(false);
    expect(call({ stages: [{ id: "implement", state: "todo", share: { percent: 100, risk: 1 } }] }).success).toBe(true);
  });

  it("состояние review и виды toggles и choice отбиваются", () => {
    expect(call({ stages: [{ id: "implement", state: "review" }] }).success).toBe(false);
    for (const kind of ["toggles", "choice"]) expect(askDecisionParamsSchema.safeParse({ title: "Бриф", questions: [{ ...fork, kind }] }).success).toBe(false);
  });

  it("присланные артефакты, исполнитель, ревью и тестирование доезжают до сервера, а не теряются: их отбивает инструмент", () => {
    const parsed = call({ artifacts: [{ id: "task", name: "Задача", state: "missing" }], executor: { recommended: "self" }, checker: { recommended: "none" }, testing: { recommended: "none" } });
    expect(parsed.success).toBe(true);
    const setup = (parsed.success ? parsed.data.setup : {}) as Record<string, unknown>;
    for (const key of ["artifacts", "executor", "checker", "testing"]) expect(setup).toHaveProperty(key);
  });
});

describe("хранимый бриф со старыми полями читается как раньше", () => {
  const stored = {
    id: "dec_old",
    threadId: "thr_1",
    createdAt: "2026-09-13T00:00:00.000Z",
    title: "Старый",
    kind: "brief",
    setup: {
      artifacts: [{ id: "task", name: "Задача", state: "approved", link: { label: "SL-312", target: "docs/tasks/todo/sl-312.md" } }],
      priority: scale,
      executor: { recommended: "self", adds: { subagents: add } },
      checker: { recommended: "agent", models: [{ name: "Opus", recommended: true, add }] },
      testing: { recommended: "none" },
      budgetTarget: scale,
      budgetMax: scale,
      stages: [{ id: "implement", state: "review", add, adds: { "agent:x": add } }],
    },
    questions: [
      { id: "t", question: "Что?", kind: "toggles", options: [{ id: "a", action: "A", risks: "риск" }, { id: "b", action: "B" }] },
      { id: "c", question: "Выбрать?", kind: "choice", allowOwn: true, options: [{ id: "a", action: "A" }, { id: "b", action: "B" }] },
    ],
  };

  it("все отвергаемые поля на месте после разбора", () => {
    const parsed = decisionBriefSchema.parse(stored);
    for (const key of ["artifacts", "priority", "executor", "checker", "testing", "budgetTarget", "budgetMax"]) expect(parsed.setup).toHaveProperty(key);
    expect(parsed.setup?.stages?.[0]).toMatchObject({ state: "review", add });
    expect(parsed.questions.map((q) => q.kind)).toEqual(["toggles", "choice"]);
    expect(parsed.questions[0]?.options[0]?.risks).toBe("риск");
  });
});
