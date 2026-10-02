// @vitest-environment node
import { describe, expect, it } from "vitest";

import { planSpan, type GanttRowData } from "./gantt-chart";

const local = (hour: number, minute = 0) => new Date(2026, 9, 1, hour, minute).getTime();

const row = (startDate: string | null, dueDate: string | null): GanttRowData => ({
  taskId: "a",
  key: "TSK-1",
  title: "Flow",
  projectId: "P",
  parentTaskId: null,
  status: "todo",
  createdMs: new Date(2026, 8, 30).getTime(),
  startDate,
  dueDate,
  segments: [],
  doneMs: null,
});

describe("planSpan — plan dates with a time", () => {
  it("runs from the start time to the due time", () => {
    expect(planSpan(row("2026-10-01T15:00", "2026-10-01T15:45"))).toEqual({ fromMs: local(15), toMs: local(15, 45) });
  });

  it("sets two tasks of one day apart by their hours", () => {
    const first = planSpan(row("2026-10-01T15:00", "2026-10-01T15:45"))!;
    const second = planSpan(row("2026-10-01T16:20", "2026-10-01T17:30"))!;
    expect(second.fromMs).toBeGreaterThan(first.toMs);
    expect(second.toMs - second.fromMs).not.toBe(first.toMs - first.fromMs);
  });

  it("runs a timed start alone to the end of its day", () => {
    expect(planSpan(row("2026-10-01T15:00", null))).toEqual({ fromMs: local(15), toMs: new Date(2026, 9, 2).getTime() });
  });
});
