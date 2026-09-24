// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { isRunFinished, runSummary } from "./run-summary";
import { EMPTY_PROGRESS, onBrief } from "./progress";
import { report, stage, stagedBrief } from "./stages-fixtures";

const at = (minutes: number): string => new Date(Date.parse("2026-09-19T10:00:00.000Z") + minutes * 60_000).toISOString();

const code = stage("code", { name: "Реализация" });
const review = stage("review", { name: "Ревью", executors: [{ id: "agent:reviewer", kind: "agent", name: "reviewer", model: "opus" }] });
const plan = stage("plan", { name: "План" });
const STAGES: WorkStage[] = [code, review, plan];

const done = (from: number, to: number, patch: Record<string, unknown> = {}) => ({ startedAt: at(from), finishedAt: at(to), ...patch });

/** Прогон, где реализация и ревью закрыты, а план вычеркнут. */
const finished: FlowProgress = {
  stages: {
    code: done(0, 40, { activeMinutes: 30, cost: 12 }),
    review: done(45, 60, { activeMinutes: 15, cost: 4, executor: "agent:reviewer" }),
    plan: { skipped: true },
  },
  waiting: [],
};

describe("завершённость прогона", () => {
  it("все этапы закрыты или вычеркнуты — прогон завершён", () => {
    expect(isRunFinished(finished, STAGES)).toBe(true);
  });

  it("остался незакрытый этап — прогон идёт", () => {
    expect(isRunFinished({ ...finished, stages: { ...finished.stages, plan: {} } }, STAGES)).toBe(false);
  });

  it("этап ждёт владельца — прогон идёт", () => {
    expect(isRunFinished({ ...finished, waiting: ["review"] }, STAGES)).toBe(false);
  });

  it("упавшая автоматизация — прогон не завершён", () => {
    const failed: FlowProgress = { stages: { ...finished.stages, code: { startedAt: at(0), run: { steps: [{ id: "git.commit", label: "Commit" }], at: 0, error: "не прошло" } } }, waiting: [] };
    expect(isRunFinished(failed, STAGES)).toBe(false);
  });

  it("ни один этап не начинался — это не завершённый прогон, а тред до работы", () => {
    expect(isRunFinished({ stages: { code: { skipped: true }, review: { skipped: true }, plan: { skipped: true } }, waiting: [] }, STAGES)).toBe(false);
    expect(isRunFinished({ stages: {}, waiting: [] }, STAGES)).toBe(false);
  });
});

describe("сводка прогона", () => {
  const summary = runSummary(finished, STAGES)!;

  it("окно прогона — от начала первого этапа до конца последнего", () => {
    expect(summary).toMatchObject({ startedAt: at(0), finishedAt: at(60) });
  });

  it("минуты — активные этапов, простой — время между этапами", () => {
    expect(summary).toMatchObject({ minutes: 45, idleMinutes: 15, wallMinutes: 60 });
  });

  it("деньги — сумма по этапам прогона", () => {
    expect(summary.cost).toBe(16);
  });

  it("этапы считаются без вычеркнутых, а вычеркнутые — отдельным числом", () => {
    expect(summary).toMatchObject({ stages: 2, skipped: 1 });
  });

  it("исполнители: сам и субагент, у каждого свои этапы и деньги", () => {
    expect(summary.executors).toEqual([
      { id: "self", kind: "self", name: "self", stages: 1, cost: 12 },
      { id: "agent:reviewer", kind: "agent", name: "reviewer", model: "opus", stages: 1, cost: 4 },
    ]);
  });

  it("пустая запись — сводки нет", () => {
    expect(runSummary({ stages: {}, waiting: [] }, STAGES)).toBeNull();
  });
});

describe("бриф, под которым встаёт итог", () => {
  it("запись помнит последний бриф треда, коснувшийся прогресса", () => {
    const brief = stagedBrief([report("code", { state: "todo" })], { id: "dec_last", stages: { list: STAGES, minButtonWidth: 170 } });
    expect(onBrief(EMPTY_PROGRESS, brief, at(0)).lastBriefId).toBe("dec_last");
  });
});
