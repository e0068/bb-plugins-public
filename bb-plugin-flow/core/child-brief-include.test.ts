import { describe, expect, it } from "vitest";

import { stage } from "./stages-fixtures";
import type { DecisionBrief } from "../shared/contract";
import { childAnswerOf, unusableStages } from "./child-brief";

const brief: DecisionBrief = {
  id: "dec_i",
  threadId: "thr_c",
  title: "Выбор этапов",
  createdAt: "2026-10-28T09:00:00.000Z",
  kind: "brief",
  questions: [],
  setup: {
    stages: [
      { id: "reproduce", state: "done", recommended: false, executor: "self" },
      { id: "implement", state: "todo", recommended: true, executor: "self", share: { percent: 100, risk: 0 } },
      { id: "review", state: "todo", recommended: false, executor: "self", share: { percent: 20, risk: -1 } },
    ],
  },
  stages: { list: [stage("reproduce"), stage("implement"), stage("review")], minButtonWidth: 170 },
};

const runOf = (include?: string[]) => Object.fromEntries((childAnswerOf(brief, undefined, include).stages ?? []).map((s) => [s.id, s.run]));

describe("этапы, которые родитель берёт в прогон потомка", () => {
  it("без списка прогон рекомендованный; названный этап встаёт в прогон, остальные не меняются", () => {
    expect(runOf()).toEqual({ reproduce: false, implement: true, review: false });
    expect(runOf(["review"])).toEqual({ reproduce: false, implement: true, review: true });
  });

  it("взять нельзя этап не из брифа и уже пройденный; незавершённый можно", () => {
    expect(unusableStages(brief, ["review", "implement"])).toEqual([]);
    expect(unusableStages(brief, ["nope", "reproduce", "review"])).toEqual(["nope", "reproduce"]);
  });
});
