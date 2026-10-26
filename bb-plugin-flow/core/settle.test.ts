import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { onBrief, EMPTY_PROGRESS } from "./progress";
import { recommendedAnswer, settleOf } from "./settle";
import { stage } from "./stages-fixtures";

const AT = "2026-10-13T10:00:00.000Z";
const flow = [builtinStage("questions", []), builtinStage("criteria", []), builtinStage("select", []), stage("task"), builtinStage("demo", []), builtinStage("approve", []), stage("code")];
const asked = { kind: "brief" as const, setup: { stages: [{ id: "questions", state: "todo" as const }, { id: "criteria", state: "todo" as const }, { id: "select", state: "todo" as const }] } };
const demo = { kind: "brief" as const, outcome: { stage: "demo", final: false, done: [], pending: [], results: [] } };

describe("метка брифа, который прогон не держит", () => {
  it("Утверждение впереди — ответ копится до него", () => {
    expect(settleOf(asked, flow, null, false)).toBe("approval");
  });

  it("Утверждения впереди нет — агент решает сам", () => {
    expect(settleOf(asked, flow.filter((s) => s.id !== "approve"), null, false)).toBe("agent");
  });

  it("пройденное или снятое Утверждение впереди не считается", () => {
    expect(settleOf(asked, flow, { stages: { approve: { finishedAt: AT } }, waiting: [] }, false)).toBe("agent");
    expect(settleOf(asked, flow, { stages: { approve: { skipped: true } }, waiting: [] }, false)).toBe("agent");
  });

  it("развилка посреди запущенной работы держит ход по-старому; до запуска вопросы отвечают на этап Вопросов", () => {
    const fork = { kind: "brief" as const, questions: [{}] };
    expect(settleOf(fork, flow, null, false, true)).toBeUndefined();
    expect(settleOf(fork, flow, null, false)).toBe("approval");
    expect(settleOf({ kind: "brief" }, flow, null, false)).toBeUndefined();
  });

  it("Утверждение позади брифа не считается", () => {
    const late = [builtinStage("approve", []), builtinStage("questions", []), stage("task")];
    expect(settleOf({ kind: "brief", setup: { stages: [{ id: "questions", state: "todo" }] } }, late, null, false)).toBe("agent");
  });

  it("Демонстрация перед Утверждением получает поле комментария, без него — ничего", () => {
    expect(settleOf(demo, flow, null, false)).toBe("approval");
    expect(settleOf(demo, flow.filter((s) => s.id !== "approve"), null, false)).toBeUndefined();
  });

  it("уточнение, само Утверждение и тред без flow — без метки", () => {
    expect(settleOf({ ...asked, kind: "clarify" }, flow, null, false)).toBeUndefined();
    expect(settleOf({ kind: "brief", outcome: { ...demo.outcome, stage: "approve" } }, flow, null, true)).toBeUndefined();
    expect(settleOf(asked, [], null, false)).toBeUndefined();
  });
});

describe("прогресс брифа, который прогон не держит", () => {
  const brief: DecisionBrief = {
    id: "dec_1",
    threadId: "thr",
    createdAt: AT,
    title: "Бриф",
    kind: "brief",
    questions: [],
    settle: "approval",
    stages: { list: flow, minButtonWidth: 160 },
    setup: {
      stages: [
        ...asked.setup.stages.map((r) => ({ ...r, recommended: false, executor: "self" })),
        { id: "task", state: "todo", recommended: true, executor: "self" },
        { id: "demo", state: "todo", recommended: false, executor: "self" },
        { id: "approve", state: "todo", recommended: false, executor: "self" },
        { id: "code", state: "todo", recommended: true, executor: "self" },
      ],
    },
  };

  it("свои этапы закрыты отправкой, ждать нечего; этапы впереди — с исполнителем агента, ни один не снят", () => {
    const next = onBrief(EMPTY_PROGRESS, brief, AT);
    for (const id of ["questions", "criteria", "select"]) expect(next.stages[id]).toMatchObject({ startedAt: AT, finishedAt: AT });
    expect(next.waiting).toEqual([]);
    expect(next.stages.task).toMatchObject({ executor: "self" });
    // Снятие предлагает агент, а решает владелец: нерекомендованный этап остаётся в прогоне до ответа с Утверждением.
    expect(next.stages.demo?.skipped).toBeUndefined();
  });

  it("тот же бриф без метки ждёт владельца, как раньше", () => {
    const { settle: _, ...held } = brief;
    expect(onBrief(EMPTY_PROGRESS, held, AT).waiting).toEqual(["questions", "criteria", "select"]);
  });
});

describe("решение агента без Утверждения впереди", () => {
  it("рекомендованные варианты, пункты без правок, рекомендованный прогон", () => {
    const brief: DecisionBrief = {
      id: "dec_2",
      threadId: "thr",
      createdAt: AT,
      title: "Бриф",
      kind: "brief",
      questions: [{ id: "q", kind: "fork", question: "Как?", allowOwn: false, options: [{ id: "a", action: "A", recommended: true, description: "a" }, { id: "b", action: "B", recommended: false, description: "b" }] }],
      stages: { list: flow, minButtonWidth: 160 },
      setup: { criteria: ["Пункт"], stages: [{ id: "task", state: "todo", recommended: true, executor: "self" }, { id: "code", state: "todo", recommended: false, executor: "self" }] },
    };
    expect(recommendedAnswer(brief)).toEqual({
      briefId: "dec_2",
      answers: [{ questionId: "q", optionIds: ["a"] }],
      stages: expect.arrayContaining([expect.objectContaining({ id: "task", run: true }), expect.objectContaining({ id: "code", run: false })]),
      criteria: { removed: [], edited: [], added: [] },
    });
  });
});
