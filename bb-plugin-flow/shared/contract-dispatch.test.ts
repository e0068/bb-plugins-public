// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionAnswerSchema, dispatchPlaceSchema, stageOutcomeSchema } from "./contract";

const outcome = {
  stage: "prototype",
  final: false,
  next: "Спецификация",
  done: ["Место исполнения слева от «Отправить»"],
  pending: [{ text: "Итог этапа — одна секция", why: "делаю следующим шагом" }],
  results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }],
};

describe("место исполнения в ответе", () => {
  it("принимает три места", () => {
    expect(["here", "thread", "worktree"].every((place) => dispatchPlaceSchema.safeParse(place).success)).toBe(true);
  });

  it("чужое место не принимается", () => {
    expect(dispatchPlaceSchema.safeParse("elsewhere").success).toBe(false);
  });

  it("ответ без места читается как записанный раньше", () => {
    const parsed = decisionAnswerSchema.parse({ briefId: "dec_1", answers: [] });
    expect(parsed.place).toBeUndefined();
  });

  it("ответ несёт выбранное место", () => {
    const parsed = decisionAnswerSchema.parse({ briefId: "dec_1", answers: [], place: "worktree" });
    expect(parsed.place).toBe("worktree");
  });
});

describe("итог этапа в брифе", () => {
  it("инструмент принимает бриф с итогом этапа", () => {
    const parsed = askDecisionParamsSchema.safeParse({ title: "Итог", outcome });
    expect(parsed.success).toBe(true);
  });

  it("итог без единого пункта не принимается", () => {
    expect(stageOutcomeSchema.safeParse({ ...outcome, done: [], pending: [] }).success).toBe(false);
  });

  it("итог без результатов не принимается", () => {
    expect(stageOutcomeSchema.safeParse({ ...outcome, results: [] }).success).toBe(false);
  });

  it("финальный итог не называет следующий этап", () => {
    expect(stageOutcomeSchema.safeParse({ ...outcome, final: true }).success).toBe(false);
    expect(stageOutcomeSchema.safeParse({ ...outcome, final: true, next: undefined }).success).toBe(true);
  });

  it("итог и этапы в одном брифе не уживаются", () => {
    const parsed = askDecisionParamsSchema.safeParse({
      title: "Итог",
      outcome,
      setup: { stages: [{ id: "prototype", state: "todo" }] },
    });
    expect(parsed.success).toBe(false);
  });

  it("задачи итога несут ключ и признак выполнения", () => {
    const parsed = stageOutcomeSchema.parse({ ...outcome, tasks: [{ key: "BBPL-1", done: true }, { key: "BBPL-2", done: false, note: "ведёт другой тред" }] });
    expect(parsed.tasks?.map((t) => t.done)).toEqual([true, false]);
  });
});
