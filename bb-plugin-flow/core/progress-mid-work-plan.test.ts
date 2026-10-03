// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief, FlowProgress } from "../shared/contract";
import { onAnswer } from "./progress";

const running: FlowProgress = {
  stages: { task: { startedAt: "2026-10-03T10:00:00.000Z", finishedAt: "2026-10-03T10:05:00.000Z" } },
  waiting: [],
  planned: { minutes: 175, target: 35, max: 63 },
  lastBriefId: "dec_launch",
};

const midWork: DecisionBrief = {
  id: "dec_mid",
  threadId: "thr_1",
  title: "Через какой канал",
  createdAt: "2026-10-03T11:00:00.000Z",
  kind: "brief",
  launched: true,
  approvedBudget: { minutes: 175, target: 35, max: 63 },
  questions: [],
};

const answer = { briefId: midWork.id, answers: [] };

describe("план прогона после уточнения посреди работы", () => {
  it("ответ на бриф посреди работы ставит прогону новый итог", () => {
    const next = onAnswer(running, midWork, answer, "2026-10-03T11:01:00.000Z", { minutes: 235, target: 45, max: 78 });
    expect(next.planned).toEqual({ minutes: 235, target: 45, max: 78 });
  });

  it("ответ на бриф посреди работы не трогает ни этапов, ни ожидания", () => {
    const { planned: _, ...rest } = onAnswer(running, midWork, answer, "2026-10-03T11:01:00.000Z", { minutes: 235, target: 45, max: 78 });
    const { planned: __, ...before } = running;
    expect(rest).toEqual(before);
  });

  it("ответ на бриф посреди работы без прогноза оставляет прогресс как был", () => {
    expect(onAnswer(running, midWork, answer, "2026-10-03T11:01:00.000Z")).toEqual(running);
  });
});
