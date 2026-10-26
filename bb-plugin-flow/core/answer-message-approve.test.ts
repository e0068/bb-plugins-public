import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageParts, answerMessageText } from "./answer-message";
import { outcomeKind } from "./outcome";

const approval: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Утверждение — Definition of Done",
  createdAt: "2026-10-10T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: {
    stage: "approve",
    final: false,
    next: "Execution",
    done: ["Definition of Done — восемь пунктов"],
    pending: [],
    results: [{ label: "task.md", target: "docs/tasks/in_progress/task.md" }],
  },
  stages: {
    list: [
      { id: "criteria", kind: "criteria", skill: "", name: "Definition of Done", executors: [] },
      { id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] },
      { id: "practice", skill: "code", name: "Execution", executors: [] },
    ],
    minButtonWidth: 160,
  },
};

const demo: DecisionBrief = { ...approval, outcome: { ...approval.outcome!, stage: "practice" } };

const answer = (outcome: DecisionAnswer["outcome"]): DecisionAnswer => ({ briefId: "dec_1", answers: [], outcome });

describe("вид итога", () => {
  it("итог этапа «Утверждение» — утверждение", () => {
    expect(outcomeKind(approval)).toBe("approve");
  });

  it("итог любого другого этапа — Демонстрация", () => {
    expect(outcomeKind(demo)).toBe("demo");
  });
});

describe("ответ агенту на Утверждение", () => {
  it("«Продолжить» без комментария — утверждено, дальше следующий этап", () => {
    expect(answerMessageText(approval, answer({ accepted: true }))).toBe(["Утверждение «Утверждение — Definition of Done» — утверждено.", "Дальше — этап «Execution»."].join("\n"));
  });

  it("комментарий — не утверждено: виджеты вернулись, главный — комментарий; переделать этап, прислать доработанные виджеты и только потом утверждение", () => {
    const text = answerMessageText(approval, answer({ accepted: false, note: "пункты длинные" }));
    expect(text).toContain("«пункты длинные»");
    expect(text).toContain("Не утверждено: виджеты от прошлого утверждения свёрнуты и вернулись тебе");
    expect(text).toContain("Главный — комментарий владельца к утверждению, остальные его ответы тоже в силе");
    expect(text).toContain("Переделай этап перед утверждением");
    expect(text).toContain("пришли новые виджеты, доработанные по комментариям");
    expect(text).toContain("и только потом утверждение");
    expect(text).not.toContain("демонстрацию");
  });

  it("комментарий к Демонстрации-отчёту следующего шага не несёт: ответов на неё сервер не берёт", () => {
    expect(answerMessageText(demo, answer({ accepted: false, note: "кнопка мелкая" }))).not.toContain("flow_stage");
  });
});

describe("комментарий ко всему брифу без Утверждения", () => {
  it("не держит работу: агент спрашивает о неясном и делает понятное", () => {
    const plain: DecisionBrief = { ...approval, outcome: undefined, setup: { criteria: ["Тесты зелёные"] } };
    const text = answerMessageText(plain, { briefId: "dec_1", answers: [], note: "перепиши короче" });
    expect(text).toContain("Комментарий ко всем вопросам выше работу не держит: о неясном спроси, понятное делай.");
    expect(answerMessageParts(plain, { briefId: "dec_1", answers: [], note: "перепиши короче" }).owner.split("\n").at(-1)).toBe("Ко всем вопросам: перепиши короче");
  });
});
