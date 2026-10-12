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
    expect(reply({ accepted: true }).split("\n")).toEqual(["Демонстрация «Демонстрация — прототип» — продолжить.", "Дальше — этап «Спецификация»."]);
  });

  it("«Продолжить» с комментарием — комментарий строкой под заголовком", () => {
    expect(reply({ accepted: true, note: "Кнопку левее" }).split("\n")).toEqual(["Демонстрация «Демонстрация — прототип» — продолжить.", "«Кнопку левее»", "Дальше — этап «Спецификация»."]);
  });

  it("комментарий — заголовок с этапом и комментарий; указаний агенту нет: ответов на Демонстрацию сервер не берёт", () => {
    expect(reply({ accepted: false, note: "Баннер ниже" }).split("\n")).toEqual(["Комментарии к демонстрации «Демонстрация — прототип» — этап «Демонстрация»:", "«Баннер ниже»"]);
  });

  it("финальная Демонстрация с продолжением закрывает работу", () => {
    const { next: _next, ...interim } = brief.outcome!;
    expect(next(reply({ accepted: true }, { ...brief, outcome: { ...interim, final: true } }))).toContain("работа закончена");
  });

  it("Демонстрация без нажатия и без комментария открыта", () => {
    expect(openQuestions(brief, { briefId: brief.id, answers: [] })).toEqual(["outcome"]);
  });
});

describe("flow, выбранный кнопкой ряда у виджета без итога", () => {
  const questions: DecisionBrief = { id: "dec_q", threadId: "thr_1", title: "Что чиним", createdAt: "2026-10-12T10:00:00.000Z", kind: "brief", questions: [{ id: "q", kind: "confirm", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }] };
  const answer: DecisionAnswer = { briefId: "dec_q", answers: [{ questionId: "q", optionIds: ["yes"] }], flow: { id: "bug", name: "Bug" } };

  it("реплика называет переход и не повторяет прогон прежнего flow", () => {
    const text = answerMessageText(questions, answer);
    expect(text).toContain("Тред переведён на flow «Bug» кнопкой Flow");
    expect(text).not.toContain("Прогон:");
  });

  it("по-английски то же", () => {
    expect(answerMessageText(questions, answer, "en")).toContain('moved to flow "Bug" with the Flow button');
  });
});
