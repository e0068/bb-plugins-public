// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionBriefSchema } from "./contract";

const issues = (value: unknown): string[] => {
  const parsed = askDecisionParamsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

const staged = (stage: Record<string, unknown>) => ({ title: "Бриф", setup: { stages: [{ id: "spec", state: "todo", ...stage }] } });

const option = (id: string, add: Record<string, number>, recommended = false) => ({ id, action: id, description: "Что будет", recommended, add });
const fork = (b: Record<string, number>) => ({
  title: "Бриф",
  questions: [{ id: "how", question: "Как?", kind: "fork", options: [option("a", { target: 0, max: 0, risk: 0 }, true), option("b", b)] }],
});

describe("доля этапа и множитель исполнителя", () => {
  it("этап несёт долю объёма, исполнитель — множитель", () => {
    expect(issues(staged({ share: { percent: 20, risk: -1 }, factors: { "agent:planner": { factor: 0.8, risk: 0 } } }))).toEqual([]);
  });

  it("множитель исполнителя больше нуля, доля — не меньше нуля", () => {
    expect(issues(staged({ share: { percent: 20, risk: 0 }, factors: { "agent:planner": { factor: 0, risk: 0 } } }))).not.toEqual([]);
    expect(issues(staged({ share: { percent: -5, risk: 0 } }))).not.toEqual([]);
  });

  it("новый бриф не несёт долларов на этапе — только долю", () => {
    expect(issues(staged({ add: { target: 3, max: 5, risk: -1 } })).join(" ")).toContain("share");
    expect(issues(staged({ share: { percent: 20, risk: 0 }, adds: { "agent:planner": { target: 1, max: 2, risk: 0 } } })).join(" ")).toContain("factors");
  });

  it("хранилище читает старый бриф с долларами на этапах", () => {
    const old = { id: "dec_old", threadId: "thr_1", createdAt: "2026-09-01T00:00:00.000Z", title: "Старый", kind: "brief", questions: [], setup: { stages: [{ id: "spec", state: "todo", add: { target: 3, max: 5, risk: -1 } }] } };
    expect(decisionBriefSchema.safeParse(old).success).toBe(true);
  });
});

describe("вариант добавляет к объёму свою цену от нуля", () => {
  it("цена и минуты варианта не бывают отрицательными, риск — бывает", () => {
    expect(issues(fork({ target: 2, max: 3, risk: -1, minutes: 10 }))).toEqual([]);
    expect(issues(fork({ target: -2, max: -1, risk: 0 })).join(" ")).toContain("from zero");
    expect(issues(fork({ target: 0, max: 0, risk: 0, minutes: -20 })).join(" ")).toContain("from zero");
  });
});

describe("«Что я понял»", () => {
  it("бриф принимает текст понятого объёма и без него", () => {
    expect(issues({ title: "Бриф", scope: "- база\n  - пункт", setup: { criteria: ["Пункт"] } })).toEqual([]);
    expect(issues({ title: "Бриф", setup: { criteria: ["Пункт"] } })).toEqual([]);
  });
});
