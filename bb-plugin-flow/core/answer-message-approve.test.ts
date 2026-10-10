import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
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
  it("«Утвердить» без комментария — утверждено, дальше следующий этап", () => {
    expect(answerMessageText(approval, answer({ accepted: true }))).toBe(["Бриф «Утверждение — Definition of Done» — утверждено.", "Дальше — этап «Execution»."].join("\n"));
  });

  it("комментарий — не утверждено: переделать этап перед утверждением и прислать его снова", () => {
    const text = answerMessageText(approval, answer({ accepted: false, note: "пункты длинные" }));
    expect(text).toContain("«пункты длинные»");
    expect(text).toContain("Не утверждено: переделай этап перед утверждением");
    expect(text).not.toContain("демонстрацию");
  });

  it("комментарий к Демонстрации по-прежнему просит прислать её снова", () => {
    expect(answerMessageText(demo, answer({ accepted: false, note: "кнопка мелкая" }))).toContain("Ответь и пришли демонстрацию снова.");
  });
});

describe("комментарий ко всему брифу без Утверждения", () => {
  it("не держит работу: агент спрашивает о неясном и делает понятное", () => {
    const plain: DecisionBrief = { ...approval, outcome: undefined, setup: { criteria: ["Тесты зелёные"] } };
    const text = answerMessageText(plain, { briefId: "dec_1", answers: [], note: "перепиши короче" });
    expect(text).toContain("Комментарий ко всему брифу ниже работу не держит: о неясном спроси, понятное делай.");
    expect(text.split("\n").at(-1)).toBe("Ко всему брифу: перепиши короче");
  });
});
