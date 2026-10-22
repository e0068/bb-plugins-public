import { describe, expect, it } from "vitest";

import type { DecisionAnswer } from "../shared/contract";
import { settleClarifyAnswer, turnOf } from "./clarify";

const answer: DecisionAnswer = {
  briefId: "dec_1",
  answers: [{ questionId: "q", optionIds: ["a"] }],
  place: "thread",
  compact: true,
  flow: { id: "flow-x", name: "X" },
};

describe("ход агента по статусу треда", () => {
  it("идёт, пока тред запускается, работает или останавливается", () => {
    (["pending", "starting", "active", "stopping"] as const).forEach((status) => expect(turnOf(status)).toBe("running"));
  });

  it("кончился у простаивающего треда и после сбоя хода", () => {
    (["idle", "error"] as const).forEach((status) => expect(turnOf(status)).toBe("ended"));
  });
});

describe("ответ на уточнение после хода агента", () => {
  it("сжатие остаётся, место и переход в другой flow снимаются", () => {
    expect(settleClarifyAnswer({ kind: "clarify" }, answer, "ended")).toEqual({ briefId: "dec_1", answers: answer.answers, compact: true });
  });

  it("посреди хода сжатие снимается", () => {
    expect(settleClarifyAnswer({ kind: "clarify" }, answer, "running").compact).toBeUndefined();
  });

  it("ответ брифа не трогается при любом ходе", () => {
    expect(settleClarifyAnswer({ kind: "brief" }, answer, "running")).toBe(answer);
  });
});
