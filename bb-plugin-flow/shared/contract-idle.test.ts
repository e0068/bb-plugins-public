// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowProgressSchema, progressStageSchema, stageTrackSchema } from "./contract";

const TRACK = { startedAt: "2026-09-18T10:00:00.000Z", finishedAt: "2026-09-18T20:18:00.000Z", run: { steps: [{ id: "git.commit", label: "Commit" }], at: 1, error: null } };

const ROW = { id: "publish", kind: "skill", name: "Commit, FF to Main, PR", executor: "self", state: "done", results: [], minutes: 2, cost: null };

describe("простой этапа в записи прогресса", () => {
  it("запись, лежащая в kv сейчас, читается без полей простоя", () => {
    expect(stageTrackSchema.parse(TRACK).idleMs).toBeUndefined();
    expect(flowProgressSchema.safeParse({ stages: { publish: TRACK }, waiting: [] }).success).toBe(true);
  });

  it("накопленный простой и открытый интервал читаются", () => {
    const parsed = stageTrackSchema.parse({ ...TRACK, idleMs: 36_960_000, idleSince: "2026-09-18T10:01:00.000Z" });
    expect(parsed).toMatchObject({ idleMs: 36_960_000, idleSince: "2026-09-18T10:01:00.000Z" });
  });

  it("отрицательный простой не проходит", () => {
    expect(stageTrackSchema.safeParse({ ...TRACK, idleMs: -1 }).success).toBe(false);
  });
});

describe("простой этапа в виде прогресса", () => {
  it("строка этапа несёт минуты простоя", () => {
    expect(progressStageSchema.parse({ ...ROW, idleMinutes: 616 }).idleMinutes).toBe(616);
  });

  it("строка без простоя читается как раньше", () => {
    expect(progressStageSchema.safeParse(ROW).success).toBe(true);
    expect(progressStageSchema.safeParse({ ...ROW, idleMinutes: null }).success).toBe(true);
  });
});
