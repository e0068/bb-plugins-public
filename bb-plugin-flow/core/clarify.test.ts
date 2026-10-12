import { describe, expect, it } from "vitest";

import { isQuickClarify, settleClarifyAnswer } from "./clarify";

const question = (kind: "yesno" | "fork") => ({ id: "q", kind, question: "?", allowOwn: false, options: [] });

describe("уточнение одной строкой", () => {
  it("один вопрос да/нет — одна строка", () => {
    expect(isQuickClarify({ kind: "clarify", questions: [question("yesno")] })).toBe(true);
  });

  it("развилка в уточнении — форма", () => {
    expect(isQuickClarify({ kind: "clarify", questions: [question("fork")] })).toBe(false);
  });

  it("несколько вопросов — форма", () => {
    expect(isQuickClarify({ kind: "clarify", questions: [question("yesno"), question("yesno")] })).toBe(false);
  });

  it("бриф не уточнение", () => {
    expect(isQuickClarify({ kind: "brief", questions: [question("yesno")] })).toBe(false);
  });
});

describe("ответ на уточнение не двигает тред", () => {
  const answer = {
    briefId: "dec_1",
    answers: [{ questionId: "q", optionIds: ["a"] }],
    place: "thread" as const,
    compact: true,
    flow: { id: "flow-x", name: "X" },
    execution: { providerId: "claude-code", model: "opus" },
  };

  it("у уточнения место, сжатие, переход и исполнитель снимаются — агент работает в этом треде дальше", () => {
    expect(settleClarifyAnswer({ kind: "clarify" }, answer as never)).toEqual({ briefId: "dec_1", answers: [{ questionId: "q", optionIds: ["a"] }] });
  });

  it("у брифа ответ остаётся как есть", () => {
    expect(settleClarifyAnswer({ kind: "brief" }, answer as never)).toBe(answer);
  });
});
