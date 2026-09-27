// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { SETUP_ROW } from "./rows";

const brief = (required?: DecisionBrief["required"], kind: DecisionBrief["kind"] = "brief"): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind,
  ...(required === undefined ? {} : { required }),
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "missing", recommended: true },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "p.html" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true },
      { id: "plan", name: "План", state: "missing", recommended: true },
    ],
  },
  questions: [],
});

const answer = (artifacts: string[], note?: string) => ({
  briefId: "dec_1",
  answers: [{ questionId: SETUP_ROW.artifacts, optionIds: artifacts }],
  ...(note === undefined ? {} : { note }),
});

const lines = (text: string) => text.split("\n");

describe("следующий шаг агента в ответе на бриф", () => {
  it("остановка на утверждение названа только у документа, который делается и обязателен к утверждению", () => {
    const text = answerMessageText(brief({ make: [], approve: ["plan", "spec", "prototype"] }), answer(["task", "prototype", "plan"]));
    const step = lines(text).at(-1)!;
    expect(step).toContain("на утверждение остановись только с — План");
    expect(step).not.toContain("Спецификация");
    expect(step).not.toContain("HTML-прототип");
  });

  it("без обязательных утверждений строки шага нет", () => {
    expect(answerMessageText(brief({ make: [], approve: [] }), answer(["task", "prototype", "spec", "plan"]))).not.toContain("Дальше");
    expect(answerMessageText(brief(), answer(["spec"]))).not.toContain("Дальше");
  });

  it("общий текст ко всему брифу остаётся последним, шаг утверждения идёт перед ним", () => {
    const text = answerMessageText(brief({ make: [], approve: ["plan"] }), answer(["plan"], "Без спешки"));
    expect(lines(text).at(-1)).toContain("Без спешки");
    expect(lines(text).at(-2)).toBe("Дальше — на утверждение остановись только с — План.");
  });

  it("ответ на уточнение не несёт шага", () => {
    expect(answerMessageText(brief({ make: [], approve: [] }, "clarify"), answer([]))).not.toContain("Дальше —");
  });
});
