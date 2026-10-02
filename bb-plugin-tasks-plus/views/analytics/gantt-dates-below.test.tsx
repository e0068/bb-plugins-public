// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GanttChart, type GanttRowData } from "./gantt-chart";

afterEach(cleanup);

const local = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime();
const from = local(2026, 9, 10);
const to = local(2026, 10, 1);
const rows: GanttRowData[] = ["a", "b"].map((taskId, index) => ({
  taskId,
  key: `TSK-${index + 1}`,
  title: taskId,
  projectId: "P",
  parentTaskId: null,
  status: "in_progress",
  createdMs: from,
  startDate: null,
  dueDate: null,
  segments: [{ status: "in_progress", fromMs: from, toMs: to }],
  doneMs: null,
}));

describe("GanttChart's dates", () => {
  it("writes the week dates in a row under the lanes, none over them", () => {
    const { container } = render(<GanttChart rows={rows} fromMs={from} toMs={to} mode="fact" />);
    const labels = Array.from(container.querySelectorAll("[data-week-label]"));
    expect(labels.length).toBeGreaterThan(0);
    const lastRow = Array.from(container.querySelectorAll("[data-gantt-row]")).at(-1)!;
    labels.forEach((label) => expect(lastRow.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    container.querySelectorAll("[data-week-break]").forEach((line) => expect(line.textContent).toBe(""));
  });

  it("never scrolls sideways", () => {
    const { container } = render(<GanttChart rows={rows} fromMs={from} toMs={to} mode="fact" />);
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller?.className).toContain("overflow-x-hidden");
  });
});
