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
  it("«Продолжить» — этап и следующий этап", () => {
    const text = reply({ accepted: true });
    expect(text).toContain("Демонстрация — продолжить: prototype.html");
    expect(next(text)).toContain("Спецификация");
  });

  it("«Отправить» — комментарий: ответить на него, демонстрация остаётся открытой, дальше по flow не идти", () => {
    const text = reply({ accepted: false, note: "Баннер ниже" });
    expect(text).toContain("Демонстрация — комментарий: prototype.html — «Баннер ниже»");
    expect(next(text)).toMatch(/ответь на комментарий.*остаётся открытой.*дальше по flow не иди/);
    expect(next(text)).not.toContain("Спецификация");
  });

  it("финальная Демонстрация с продолжением закрывает работу", () => {
    const { next: _next, ...interim } = brief.outcome!;
    expect(next(reply({ accepted: true }, { ...brief, outcome: { ...interim, final: true } }))).toContain("работа закончена");
  });

  it("Демонстрация без нажатия и без комментария открыта", () => {
    expect(openQuestions(brief, { briefId: brief.id, answers: [] })).toEqual(["outcome"]);
  });
});
