// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageText, openQuestions } from "./answer-message";

const brief: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация — прототип",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: false, next: "Спецификация", done: ["Прототип собран"], pending: [], results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const reply = (outcome: DecisionAnswer["outcome"], b: DecisionBrief = brief) => answerMessageText(b, { briefId: b.id, answers: [], outcome });
const next = (text: string) => text.split("\n").find((l) => l.startsWith("Дальше")) ?? "";

describe("реплика агенту на Демонстрацию", () => {
  it("«Продолжить» — заголовок и следующий этап, без ссылок результатов", () => {
    expect(reply({ accepted: true }).split("\n")).toEqual(["Бриф «Демонстрация — прототип» — продолжить.", "Дальше — этап «Спецификация»."]);
  });

  it("«Продолжить» с комментарием — комментарий строкой под заголовком", () => {
    expect(reply({ accepted: true, note: "Кнопку левее" }).split("\n")).toEqual(["Бриф «Демонстрация — прототип» — продолжить.", "«Кнопку левее»", "Дальше — этап «Спецификация»."]);
  });

  it("комментарий — три строки: заголовок с этапом, комментарий, ответить и прислать снова; ссылок и следующего этапа нет", () => {
    expect(reply({ accepted: false, note: "Баннер ниже" }).split("\n")).toEqual([
      "Бриф «Демонстрация — прототип» — комментарий к этапу «Демонстрация»:",
      "«Баннер ниже»",
      "Ответь и пришли демонстрацию снова.",
    ]);
  });

  it("по-английски те же три строки", () => {
    const text = answerMessageText(brief, { briefId: brief.id, answers: [], outcome: { accepted: false, note: "Lower banner" } }, "en");
    expect(text.split("\n")).toEqual(['Brief "Демонстрация — прототип" — comment on the "Демонстрация" stage:', '"Lower banner"', "Answer it and send the demo again."]);
  });

  it("финальная Демонстрация с продолжением закрывает работу", () => {
    const { next: _next, ...interim } = brief.outcome!;
    expect(next(reply({ accepted: true }, { ...brief, outcome: { ...interim, final: true } }))).toContain("работа закончена");
  });

  it("Демонстрация без нажатия и без комментария открыта", () => {
    expect(openQuestions(brief, { briefId: brief.id, answers: [] })).toEqual(["outcome"]);
  });
});
