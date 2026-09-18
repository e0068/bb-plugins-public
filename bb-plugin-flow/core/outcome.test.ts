import { describe, expect, it } from "vitest";

import type { DecisionBrief, StageOutcome } from "../shared/contract";
import { stageItems } from "./stages";
import { isOutcomeBrief, outcomeAnswered, outcomeItems, outcomeStageName } from "./outcome";

const outcome: StageOutcome = {
  stage: "prototype",
  final: false,
  next: "Спецификация",
  done: ["Место исполнения слева от «Отправить»"],
  pending: [{ text: "Итог этапа — одна секция", why: "делаю следующим шагом" }, { text: "Счётчик на кнопке" }],
  results: [{ label: "prototype.html", target: "memory/assets/x/prototype.html" }],
};

const briefWith = (patch: Partial<DecisionBrief> = {}): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Итог этапа",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome,
  stages: {
    list: [{ id: "prototype", skill: "prototype", name: "HTML-прототип", review: true, executors: [] }],
    minButtonWidth: 160,
  },
  ...patch,
});

describe("пункты итога", () => {
  it("сделанное идёт перед несделанным и помнит причину", () => {
    expect(outcomeItems(outcome)).toEqual([
      { done: true, text: "Место исполнения слева от «Отправить»" },
      { done: false, text: "Итог этапа — одна секция", why: "делаю следующим шагом" },
      { done: false, text: "Счётчик на кнопке" },
    ]);
  });

  it("итог без несделанного даёт только сделанное", () => {
    expect(outcomeItems({ ...outcome, pending: [] }).every((item) => item.done)).toBe(true);
  });
});

describe("название этапа итога", () => {
  it("берётся из снимка настроек брифа", () => {
    expect(outcomeStageName(briefWith())).toBe("HTML-прототип");
  });

  it("этап не из снимка называется своим id", () => {
    expect(outcomeStageName(briefWith({ outcome: { ...outcome, stage: "unknown" } }))).toBe("unknown");
  });
});

describe("этапы в брифе с итогом", () => {
  it("кнопок этапов у брифа с итогом нет", () => {
    expect(stageItems(briefWith())).toEqual([]);
  });

  it("без итога снимок настроек по-прежнему даёт кнопки", () => {
    expect(stageItems(briefWith({ outcome: undefined }))).toHaveLength(1);
  });
});

describe("ответ на итог", () => {
  it("бриф с итогом опознаётся", () => {
    expect(isOutcomeBrief(briefWith())).toBe(true);
    expect(isOutcomeBrief(briefWith({ outcome: undefined }))).toBe(false);
  });

  it("нетронутый итог не отвечен", () => {
    expect(outcomeAnswered({})).toBe(false);
  });

  it("«Продолжить» отвечает итог", () => {
    expect(outcomeAnswered({ outcome: { accepted: true } })).toBe(true);
  });

  it("свой ответ отвечает итог и без «Продолжить»", () => {
    expect(outcomeAnswered({ outcome: { accepted: false, note: "переделай подпись" } })).toBe(true);
  });

  it("пробелы своим ответом не считаются", () => {
    expect(outcomeAnswered({ outcome: { accepted: false, note: "   " } })).toBe(false);
  });
});
