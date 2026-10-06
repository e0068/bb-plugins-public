// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, StageAnswer } from "../shared/contract";
import { forecast, hasForecast, recommendedForecast, scopeOf } from "./budget";
import { add, planner, report, stagedBrief } from "./stages-fixtures";

const item = (text: string, target: number, max: number, minutes: number) => ({ text, add: add(target, max, 0, minutes) });

/** Бриф со скриншота владельца: тред без flow, пункты «Готово, когда», развилка с вариантом «быстро». */
const noFlow: DecisionBrief = {
  id: "dec_noflow",
  threadId: "thr_1",
  title: "Индикаторы загрузки",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  scope: "- логотип вместо колёсика",
  setup: { criteria: [item("Логотип крутится", 4, 6, 20), item("Иначе — колёсико", 2, 3, 10)] },
  questions: [
    {
      id: "how",
      kind: "fork",
      allowOwn: false,
      question: "Как вести?",
      options: [
        { id: "flow", action: "По flow", recommended: true, add: add(0, 0, 0, 0) },
        { id: "skip", action: "Не делать проверку в живом bb", recommended: false, add: add(0, 0, 1, 0) },
        { id: "extra", action: "Ещё и тёмная тема", recommended: false, add: add(3, 4, 0, 15), criteria: ["Тёмная тема"] },
      ],
    },
  ],
};

const chose = (brief: DecisionBrief, optionId: string, extra: Partial<DecisionAnswer> = {}): DecisionAnswer => ({ briefId: brief.id, answers: [{ questionId: "how", optionIds: [optionId] }], ...extra });

const shareReports = [
  report("task", { recommended: true, share: { percent: 10, risk: 0 } }),
  report("spec", { recommended: true, share: { percent: 20, risk: -1 } }),
  report("plan", { recommended: true, share: { percent: 100, risk: 5 }, factors: { [planner.id]: { factor: 0.5, risk: 0 } } }),
];
const withStages: DecisionBrief = stagedBrief(shareReports, { scope: "- база", setup: { stages: shareReports, criteria: noFlow.setup!.criteria! }, questions: noFlow.questions });

const staged = (stages: StageAnswer[], extra: Partial<DecisionAnswer> = {}): DecisionAnswer => ({ ...chose(withStages, "flow"), stages, ...extra });

describe("объём — база из пунктов и выбранные варианты", () => {
  it("бриф без этапов со скриншота даёт сумму пунктов, а не $0", () => {
    const f = forecast(noFlow, chose(noFlow, "flow"));
    expect(f).toMatchObject({ target: 6, max: 9, minutes: 30 });
  });

  it("вариант добавляет к объёму свою цену, «ничего» — ноль", () => {
    expect(forecast(noFlow, chose(noFlow, "extra"))).toMatchObject({ target: 9, max: 13, minutes: 45 });
    expect(forecast(noFlow, chose(noFlow, "skip"))).toMatchObject({ target: 6, max: 9, minutes: 30, risk: 1 });
  });

  it("снятый пункт уходит из объёма", () => {
    const answer = chose(noFlow, "flow", { criteria: { removed: [0], edited: [], added: [] } });
    expect(scopeOf(noFlow, answer)).toMatchObject({ target: 2, max: 3, minutes: 10 });
  });
});

describe("этапы — доли объёма", () => {
  it("снятый пункт уменьшает каждую строку этапа пропорционально", () => {
    const full = forecast(withStages, staged([]));
    const cut = forecast(withStages, staged([], { criteria: { removed: [0], edited: [], added: [] } }));
    const spec = (f: typeof full) => f.lines.find((l) => l.label === "Спецификация")!;
    expect(spec(cut).target! / spec(full).target!).toBeCloseTo(2 / 6);
    expect(cut.target).toBeLessThan(full.target);
  });

  it("этап не в прогоне строки не даёт", () => {
    const f = forecast(withStages, staged([{ id: "plan", run: false, executor: "self", review: true }]));
    expect(f.lines.map((l) => l.label)).not.toContain("План");
  });

  it("доли этапов делают прогноз только вместе с объёмом: без базы «$0» не рисуется", () => {
    const shared = [report("plan", { share: { percent: 100, risk: 0 } })];
    expect(hasForecast(stagedBrief(shared))).toBe(false);
    expect(hasForecast(stagedBrief(shared, { setup: { stages: shared, criteria: noFlow.setup!.criteria! } }))).toBe(true);
    expect(hasForecast(stagedBrief(shared, { approvedScope: add(6, 9, 0, 30) }))).toBe(true);
  });
});

describe("прогноз по рекомендациям", () => {
  it("берёт рекомендованные варианты и этапы", () => {
    expect(recommendedForecast(withStages)).toMatchObject({ target: 7.8, max: 11.7, minutes: 39 });
  });

  it("бриф с пунктами без цены даёт ноль — его и ловит проверка инструмента", () => {
    const bare: DecisionBrief = { ...noFlow, setup: { criteria: ["Логотип крутится"] }, questions: [] };
    expect(recommendedForecast(bare)).toMatchObject({ target: 0, max: 0 });
  });
});

describe("flow без этапа самой работы — объём считается сам", () => {
  const builtins = stagedBrief([report("task", { recommended: true }), report("spec", { recommended: true, share: { percent: 15, risk: -1 } })], {
    scope: "- база",
    setup: { stages: [report("task", { recommended: true }), report("spec", { recommended: true, share: { percent: 15, risk: -1 } })], criteria: noFlow.setup!.criteria! },
  });

  it("объём — строками пунктов, этапы — надбавкой сверху", () => {
    const f = recommendedForecast(builtins);
    expect(f.lines.map((l) => l.label)).toEqual(["Пункт 1", "Пункт 2", "Спецификация"]);
    // Строки складываются в −1r, но итоговый риск ниже нуля не опускается.
    expect(f).toMatchObject({ target: 6.9, max: 10.35, minutes: 35, risk: 0 });
  });

  it("этапы без доли ничего не стоят, но объём остаётся", () => {
    const bare = stagedBrief([report("task", { recommended: true })], { scope: "- база", setup: { stages: [report("task", { recommended: true })], criteria: noFlow.setup!.criteria! } });
    expect(recommendedForecast(bare)).toMatchObject({ target: 6, max: 9, minutes: 30 });
  });
});
