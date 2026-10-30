// @vitest-environment node
// Вопрос по демо задаётся в самой демонстрации: она берёт вопросы, когда ответ копится до Утверждения впереди, и отвечает ими как обычный бриф.
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { answeredAsQuestions, memberOf, reportOnlyIssues } from "./outcome";

const AT = "2026-10-29T10:00:00.000Z";
const fork = { id: "go", kind: "fork" as const, question: "Чинить?", allowOwn: false, options: [{ id: "yes", action: "Чинить", description: "Да.", recommended: true }] };
const stages = { list: [builtinStage("demo", []), builtinStage("approve", ["demo"])], minButtonWidth: 190 };
const outcome = { stage: "demo", final: false, done: [], pending: [], results: [] };
const demo = (questions: DecisionBrief["questions"]): DecisionBrief => ({ id: "D", threadId: "thr", createdAt: AT, title: "Демо", kind: "brief", questions, stages, outcome });

describe("демонстрация и вопросы", () => {
  it("с Утверждением впереди вопросы допустимы, без него отбиваются прежним отказом", () => {
    expect(reportOnlyIssues({}, 1, true)).toEqual([]);
    expect(reportOnlyIssues({}, 1, false)).toEqual(["a demo is a report: questions go as a clarify, a flow switch as outcome.nextFlow on an approval"]);
  });

  it("nextFlow у демонстрации отбивается и тогда, когда вопросы допустимы", () => {
    expect(reportOnlyIssues({ nextFlow: "flow-bug" }, 1, true)).toEqual(["outcome.nextFlow goes on an approval: the owner moves the work with its button"]);
  });
});

describe("виджет группы Утверждения в виде, в котором он отвечает", () => {
  it("демо с вопросами отвечает брифом без итога и без этапов, вопросы на месте", () => {
    const answering = memberOf(demo([fork]));
    expect(answering.outcome).toBeUndefined();
    expect(answering.stages).toBeUndefined();
    expect(answering.questions).toEqual([fork]);
    expect(answering.id).toBe("D");
  });

  it("демо без вопросов и бриф без итога остаются как есть", () => {
    const bare = demo([]);
    expect(memberOf(bare)).toBe(bare);
    const plain: DecisionBrief = { ...demo([fork]), outcome: undefined };
    expect(memberOf(plain)).toBe(plain);
  });

  it("Утверждение с вопросами остаётся Утверждением", () => {
    const approval: DecisionBrief = { ...demo([fork]), outcome: { ...outcome, stage: "approve" } };
    expect(memberOf(approval)).toBe(approval);
  });
});

describe("ответ демонстрации, ушедший вопросами с Утверждением", () => {
  it("у такого ответа итога нет: вердикта показывать не с чего", () => {
    expect(answeredAsQuestions(demo([fork]), { })).toBe(true);
    expect(answeredAsQuestions(demo([fork]), { outcome: { accepted: true } })).toBe(false);
    expect(answeredAsQuestions({ outcome: undefined }, {})).toBe(false);
  });
});
