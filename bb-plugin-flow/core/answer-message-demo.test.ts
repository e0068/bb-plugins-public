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
  outcome: { stage: "demo", final: false, next: "Спецификация", done: ["Прототип собран"], pending: [], results: [{ label: "prototype.html", target: "memory/assets/x/prototype.html" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const reply = (outcome: DecisionAnswer["outcome"], b: DecisionBrief = brief) => answerMessageText(b, { briefId: b.id, answers: [], outcome });
const next = (text: string) => text.split("\n").find((l) => l.startsWith("Дальше")) ?? "";

describe("реплика агенту на Демонстрацию", () => {
  it("«Продолжить» — этап и следующий этап", () => {
    const text = reply({ accepted: true });
    expect(text).toContain("Демонстрация — продолжить: prototype.html");
    expect(next(text)).toContain("Спецификация");
  });

  it("«Учесть и продолжить» — комментарий и продолжение с ним", () => {
    const text = reply({ accepted: true, note: "Подпись короче" });
    expect(text).toContain("Демонстрация — продолжить с комментарием: prototype.html — «Подпись короче»");
    expect(next(text)).toMatch(/Спецификация.*учти комментарий/);
  });

  it("«На доработку» — переделать и снова показать, дальше по flow не идти", () => {
    const text = reply({ accepted: false, note: "Баннер ниже" });
    expect(text).toContain("Демонстрация — на доработку: prototype.html — «Баннер ниже»");
    expect(next(text)).toMatch(/переделай по комментарию и снова пришли демонстрацию.*дальше по flow не иди/);
  });

  it("финальная Демонстрация с продолжением закрывает работу", () => {
    const { next: _next, ...interim } = brief.outcome!;
    expect(next(reply({ accepted: true }, { ...brief, outcome: { ...interim, final: true } }))).toContain("работа закончена");
  });

  it("Демонстрация без нажатия и без комментария открыта", () => {
    expect(openQuestions(brief, { briefId: brief.id, answers: [] })).toEqual(["outcome"]);
  });
});
