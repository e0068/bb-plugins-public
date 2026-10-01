// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GanttChart, ganttLines, ganttWeeks, planSpan, type GanttRowData } from "./gantt-chart";

afterEach(cleanup);

const DAY = 86_400_000;
const local = (year: number, month: number, day: number, hour = 0) => new Date(year, month - 1, day, hour).getTime();

const row = (over: Partial<GanttRowData> = {}): GanttRowData => ({
  taskId: "a",
  key: "TSK-1",
  title: "Flow",
  projectId: "P",
  parentTaskId: null,
  status: "in_progress",
  createdMs: local(2026, 9, 14),
  startDate: null,
  dueDate: null,
  segments: [],
  ...over,
});

describe("planSpan — the planned stretch on the viewer's calendar", () => {
  it("runs from the start day's midnight through the end of the due day", () => {
    expect(planSpan(row({ startDate: "2026-09-21", dueDate: "2026-09-23" }))).toEqual({ fromMs: local(2026, 9, 21), toMs: local(2026, 9, 24) });
  });

  it("starts at creation when only a due date is set, and is one day when only a start is", () => {
    expect(planSpan(row({ dueDate: "2026-09-23" }))).toEqual({ fromMs: local(2026, 9, 14), toMs: local(2026, 9, 24) });
    expect(planSpan(row({ startDate: "2026-09-21" }))).toEqual({ fromMs: local(2026, 9, 21), toMs: local(2026, 9, 22) });
  });

  it("is the due day alone when the task was made after it, and nothing without dates", () => {
    expect(planSpan(row({ createdMs: local(2026, 9, 30), dueDate: "2026-09-23" }))).toEqual({ fromMs: local(2026, 9, 23), toMs: local(2026, 9, 24) });
    expect(planSpan(row())).toBeNull();
  });
});

describe("ganttLines — what each row draws in a window", () => {
  const from = local(2026, 9, 21);
  const to = local(2026, 9, 28);
  const lived = row({
    taskId: "lived",
    startDate: "2026-09-20",
    dueDate: "2026-09-22",
    segments: [
      { status: "todo", fromMs: local(2026, 9, 19), toMs: local(2026, 9, 22, 12) },
      { status: "in_progress", fromMs: local(2026, 9, 22, 12), toMs: local(2026, 9, 26) },
    ],
  });
  const planOnly = row({ taskId: "planned", startDate: "2026-09-24", dueDate: "2026-09-24" });

  it("lays the plan and the facts over each other, cut at the window's edges", () => {
    const [line] = ganttLines([lived], from, to, "both");
    expect(line!.plan).toEqual({ left: 0, width: (local(2026, 9, 23) - from) / (to - from) });
    expect(line!.fact.map((entry) => entry.status)).toEqual(["todo", "in_progress"]);
    expect(line!.fact[0]!.bar.left).toBe(0);
    expect(line!.fact[1]!.bar.left + line!.fact[1]!.bar.width).toBeCloseTo((local(2026, 9, 26) - from) / (to - from), 9);
  });

  it("draws the plan alone, the facts alone, or both, as the mode says", () => {
    expect(ganttLines([lived, planOnly], from, to, "plan").map((line) => [line.row.taskId, line.fact.length, line.plan !== null])).toEqual([
      ["lived", 0, true],
      ["planned", 0, true],
    ]);
    expect(ganttLines([lived, planOnly], from, to, "fact").map((line) => [line.row.taskId, line.fact.length, line.plan])).toEqual([["lived", 2, null]]);
  });

  it("leaves out a row with nothing inside the window", () => {
    const before = row({ segments: [{ status: "todo", fromMs: from - 3 * DAY, toMs: from - DAY }] });
    expect(ganttLines([before], from, to, "both")).toEqual([]);
  });

  it("keeps every bar inside the lane", () => {
    for (const line of ganttLines([lived, planOnly], from, to, "both")) {
      for (const bar of [line.plan, ...line.fact.map((entry) => entry.bar)]) {
        if (bar === null) continue;
        expect(bar.left).toBeGreaterThanOrEqual(0);
        expect(bar.width).toBeGreaterThan(0);
        expect(bar.left + bar.width).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

describe("ganttWeeks — the Monday lines across a Gantt", () => {
  it("puts a line at each Monday inside the window, a label on each while they are few", () => {
    const weeks = ganttWeeks(local(2026, 9, 17), local(2026, 10, 9), 12);
    expect(weeks.map((week) => new Date(week.mondayMs).getDate())).toEqual([21, 28, 5]);
    expect(weeks.every((week) => week.labelled)).toBe(true);
    expect(weeks[0]!.at).toBeCloseTo((local(2026, 9, 21) - local(2026, 9, 17)) / (local(2026, 10, 9) - local(2026, 9, 17)), 9);
  });

  it("labels no more weeks than asked, spread evenly", () => {
    const weeks = ganttWeeks(local(2025, 9, 1), local(2026, 9, 1), 12);
    expect(weeks.length).toBeGreaterThan(50);
    expect(weeks.filter((week) => week.labelled).length).toBeLessThanOrEqual(12);
  });
});

describe("GanttChart", () => {
  const from = local(2026, 9, 21);
  const to = local(2026, 9, 28);
  const rows = [
    row({ segments: [{ status: "in_progress", fromMs: from, toMs: to }] }),
    row({ taskId: "b", key: "TSK-2", title: "Board", segments: [{ status: "todo", fromMs: from, toMs: to }] }),
  ];

  it("names each task and opens it on a click", () => {
    const onOpenTask = vi.fn();
    render(<GanttChart rows={rows} fromMs={from} toMs={to} mode="fact" onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByRole("button", { name: /TSK-2/ }));
    expect(onOpenTask).toHaveBeenCalledWith("TSK-2");
    expect(document.querySelectorAll("[data-gantt-row]")).toHaveLength(2);
  });

  it("draws bare lanes when compact, as a card has room for", () => {
    render(<GanttChart rows={rows} fromMs={from} toMs={to} mode="fact" compact />);
    expect(screen.queryByText("Flow")).toBeNull();
    expect(document.querySelectorAll("[data-gantt-row]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-gantt-fact]")).toHaveLength(2);
  });

  it("says so when the window holds nothing to draw", () => {
    render(<GanttChart rows={[]} fromMs={from} toMs={to} mode="plan" />);
    expect(screen.getByText(/Nothing to draw/)).toBeTruthy();
  });
});

describe("the moment a task is done", () => {
  const from = local(2026, 9, 21);
  const to = local(2026, 9, 28);
  const worked = [{ status: "in_progress" as const, fromMs: local(2026, 9, 22), toMs: local(2026, 9, 24) }];

  it("marks a done task where its line ends", () => {
    const [line] = ganttLines([row({ status: "done", segments: worked })], from, to, "fact");
    expect(line!.doneAt).toBe((local(2026, 9, 24) - from) / (to - from));
  });

  it("marks no task that is not done, whatever its line", () => {
    const [line] = ganttLines([row({ status: "in_review", segments: worked })], from, to, "fact");
    expect(line!.doneAt).toBeNull();
  });

  it("marks nothing when the task was done before the window opens", () => {
    const early = [{ status: "todo" as const, fromMs: local(2026, 9, 10), toMs: local(2026, 9, 12) }];
    const [line] = ganttLines([row({ status: "done", startDate: "2026-09-22", segments: early })], from, to, "plan");
    expect(line!.doneAt).toBeNull();
  });

  it("draws the Done mark on a done task's lane and none on an open one", () => {
    render(
      <GanttChart
        rows={[row({ status: "done", segments: worked }), row({ taskId: "b", key: "TSK-2", segments: worked })]}
        fromMs={from}
        toMs={to}
        mode="fact"
        compact
      />,
    );
    expect(document.querySelectorAll("[data-gantt-done]")).toHaveLength(1);
  });
});

describe("the tooltip of a Gantt row", () => {
  const from = local(2026, 9, 21);
  const to = local(2026, 9, 28);
  const planned = row({
    key: "TSK-7",
    title: "Ship the tooltip",
    status: "in_review",
    startDate: "2026-09-22",
    dueDate: "2026-09-25",
    segments: [{ status: "in_review", fromMs: from, toMs: to }],
  });
  const hover = () => fireEvent.pointerMove(document.querySelector("[data-gantt-row]")!, { pointerType: "mouse" });

  it("names the task, its status and its plan", async () => {
    render(<GanttChart rows={[planned]} fromMs={from} toMs={to} mode="both" compact />);
    hover();
    const tip = await screen.findByTestId("gantt-row-tip");
    expect(tip.textContent).toContain("TSK-7");
    expect(tip.textContent).toContain("Ship the tooltip");
    expect(tip.textContent).toContain("In review");
    expect(tip.textContent).toMatch(/Sep 22.*→.*Sep 25/);
  });

  it("opens the task on a click", async () => {
    const onOpenTask = vi.fn();
    render(<GanttChart rows={[planned]} fromMs={from} toMs={to} mode="both" compact onOpenTask={onOpenTask} />);
    hover();
    fireEvent.click(within(await screen.findByTestId("gantt-row-tip")).getByRole("button"));
    expect(onOpenTask).toHaveBeenCalledWith("TSK-7");
  });

  it("says there is no plan when the task has no dates", async () => {
    render(<GanttChart rows={[row({ segments: [{ status: "todo", fromMs: from, toMs: to }] })]} fromMs={from} toMs={to} mode="fact" compact />);
    hover();
    expect((await screen.findByTestId("gantt-row-tip")).textContent).toContain("No plan");
  });
});

describe("the row under the pointer", () => {
  const from = local(2026, 9, 21);
  const to = local(2026, 9, 28);
  const rows = [
    row({ segments: [{ status: "in_progress", fromMs: from, toMs: to }] }),
    row({ taskId: "b", key: "TSK-2", title: "Board", segments: [{ status: "todo", fromMs: from, toMs: to }] }),
  ];
  const lanes = () => Array.from(document.querySelectorAll("[data-gantt-row]"));
  const lit = () => lanes().map((lane) => lane.querySelector("[data-gantt-hover]") !== null);

  it("lights its lane on a card and goes dark when the pointer leaves", () => {
    render(<GanttChart rows={rows} fromMs={from} toMs={to} mode="fact" compact />);
    expect(lit()).toEqual([false, false]);
    fireEvent.pointerEnter(lanes()[1]!);
    expect(lit()).toEqual([false, true]);
    fireEvent.pointerLeave(lanes()[1]!);
    expect(lit()).toEqual([false, false]);
  });

  it("on the analytics screen lights the lane and the name together, whichever the pointer is on", () => {
    render(<GanttChart rows={rows} fromMs={from} toMs={to} mode="fact" />);
    const name = screen.getByRole("button", { name: /TSK-2/ });
    fireEvent.pointerEnter(name.parentElement!);
    expect(lit()).toEqual([false, true]);
    expect(name.className).toContain("bg-state-hover");
    fireEvent.pointerLeave(name.parentElement!);
    fireEvent.pointerEnter(lanes()[0]!);
    expect(lit()).toEqual([true, false]);
    expect(screen.getByRole("button", { name: /TSK-1/ }).className).toContain("bg-state-hover");
    expect(name.className).not.toContain("bg-state-hover");
  });
});
