// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { BriefSetup, DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { CARRY_ROWS, carriedFor, carryOf } from "./carry";
import { SETUP_ROW } from "./rows";

const briefWith = (setup: Record<string, unknown>, carried?: Record<string, string[]>): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  setup: setup as BriefSetup,
  questions: [],
  ...(carried === undefined ? {} : { carried }),
});

const models = [{ name: "Fable 5.1", recommended: true }, { name: "Opus 5", recommended: false }];
const setup = {
  artifacts: [{ id: "task", name: "Задача", state: "missing", recommended: true }],
  executor: { recommended: "self" },
  checker: { recommended: "agent", models },
  testing: { recommended: "none" },
};

const answer = (answers: DecisionAnswer["answers"], budget?: DecisionAnswer["budget"]): DecisionAnswer => ({ briefId: "dec_1", answers, ...(budget === undefined ? {} : { budget }) });

describe("что переносится", () => {
  it("переносятся исполнитель, ревью и тестирование", () => {
    expect(CARRY_ROWS).toEqual([SETUP_ROW.executor, SETUP_ROW.checker, SETUP_ROW.testing]);
  });

  it("переносится строка, выбранная владельцем", () => {
    const carried = carryOf(briefWith(setup), answer([
      { questionId: SETUP_ROW.executor, optionIds: ["subagents"], picked: ["subagents"] },
      { questionId: SETUP_ROW.checker, optionIds: ["agent:Fable 5.1"], picked: ["agent:Fable 5.1"] },
      { questionId: SETUP_ROW.testing, optionIds: ["none"] },
    ]));
    expect(carried).toEqual({ [SETUP_ROW.executor]: ["subagents"], [SETUP_ROW.checker]: ["agent:Fable 5.1"] });
  });

  it("нетронутая рекомендация и нетронутое перенесённое не переносятся", () => {
    const brief = briefWith(setup, { [SETUP_ROW.executor]: ["workflow"] });
    expect(carryOf(brief, answer([{ questionId: SETUP_ROW.executor, optionIds: ["workflow"] }, { questionId: SETUP_ROW.checker, optionIds: ["agent:Fable 5.1"] }]))).toEqual({});
  });

  it("артефакты и своя цена не переносятся", () => {
    const carried = carryOf(briefWith(setup), answer([{ questionId: SETUP_ROW.artifacts, optionIds: [], picked: ["task"] }], { target: "$20" }));
    expect(carried).toEqual({});
  });
});

describe("что ложится на новый бриф", () => {
  it("перенос модели, которой нет в новом брифе, не ложится", () => {
    const brief = briefWith({ ...setup, checker: { recommended: "agent", models: [{ name: "Opus 5", recommended: true }] } }, { [SETUP_ROW.checker]: ["agent:Fable 5.1"], [SETUP_ROW.executor]: ["subagents"] });
    expect(carriedFor(brief)).toEqual({ [SETUP_ROW.executor]: ["subagents"] });
  });

  it("ревью в рамках workflow ложится только при исполнителе workflow", () => {
    expect(carriedFor(briefWith(setup, { [SETUP_ROW.testing]: ["workflow"] }))).toEqual({});
    expect(carriedFor(briefWith(setup, { [SETUP_ROW.testing]: ["workflow"], [SETUP_ROW.executor]: ["fanout"] }))).toEqual({ [SETUP_ROW.testing]: ["workflow"], [SETUP_ROW.executor]: ["fanout"] });
    expect(carriedFor(briefWith({ ...setup, executor: { recommended: "workflow" } }, { [SETUP_ROW.testing]: ["workflow"] }))).toEqual({ [SETUP_ROW.testing]: ["workflow"] });
  });

  it("строка, которой нет в брифе, не ложится", () => {
    expect(carriedFor(briefWith({ executor: { recommended: "self" } }, { [SETUP_ROW.checker]: ["self"] }))).toEqual({});
  });
});

describe("перенос в реплике агенту", () => {
  const brief = briefWith(setup, { [SETUP_ROW.checker]: ["self"] });

  it("реплика называет перенесённое значение «перенесено из прошлого брифа»", () => {
    const text = answerMessageText(brief, answer([
      { questionId: SETUP_ROW.executor, optionIds: ["self"] },
      { questionId: SETUP_ROW.checker, optionIds: ["self"] },
      { questionId: SETUP_ROW.testing, optionIds: ["none"] },
    ]));
    expect(text).toContain("3. Ревью — Сам (перенесено из прошлого брифа)");
  });

  it("тронутое владельцем значение реплика переносом не называет", () => {
    const text = answerMessageText(brief, answer([
      { questionId: SETUP_ROW.executor, optionIds: ["self"] },
      { questionId: SETUP_ROW.checker, optionIds: ["self"], picked: ["self"] },
      { questionId: SETUP_ROW.testing, optionIds: ["none"] },
    ]));
    expect(text).toContain("3. Ревью — Сам (рекомендовал Сторонний агент на Fable 5.1, выбрано Сам)");
  });
});
