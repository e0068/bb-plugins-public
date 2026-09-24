// @vitest-environment node
import { describe, expect, it } from "vitest";

import { runHistoryEntrySchema } from "./contract";

const summary = { startedAt: "2026-09-20T10:00:00.000Z", finishedAt: "2026-09-20T11:00:00.000Z", minutes: 42, wallMinutes: 60, idleMinutes: 18, cost: 12.5, stages: 1, skipped: 0, executors: [] };
const entry = { briefId: "dec_a", threadId: "thr_a", title: "Тред А", exists: true, summary, stages: [], done: 1, total: 1, planned: null, environmentId: null };

describe("строка истории прогонов", () => {
  it("замороженный итог с брифом, названием и признаком треда проходит схему", () => {
    expect(runHistoryEntrySchema.safeParse(entry).success).toBe(true);
    expect(runHistoryEntrySchema.safeParse({ ...entry, title: null, exists: false }).success).toBe(true);
  });

  it("строка без брифа или без признака треда — нет", () => {
    const { briefId: _brief, ...noBrief } = entry;
    const { exists: _exists, ...noExists } = entry;
    expect(runHistoryEntrySchema.safeParse(noBrief).success).toBe(false);
    expect(runHistoryEntrySchema.safeParse(noExists).success).toBe(false);
  });
});
