// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TASK_STATUSES, TASK_TYPES, type TaskStatus } from "../../db/types.js";
import type { FlowAnswer, TasksSnapshot } from "../../shared/contract.js";
import {
  Aging,
  Burndown,
  ClosedByType,
  CostByProject,
  CreatedClosed,
  CycleTime,
  EstimateAccuracy,
  KpiStrip,
  StatusChanges,
  WorkInProgress,
} from "./flow-sections";

afterEach(cleanup);

const DAY = 86_400_000;
const counts = (over: Partial<Record<TaskStatus, number>> = {}) =>
  ({ ...Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])), ...over }) as Record<TaskStatus, number>;
const types = (over: Record<string, number> = {}) =>
  ({ ...Object.fromEntries([...TASK_TYPES, "untyped"].map((type) => [type, 0])), ...over }) as FlowAnswer["typesByWeek"][number];

const PROJECTS = [
  { id: "P", name: "Plugins" },
  { id: "Q", name: "Quarry" },
];

function flow(over: Partial<FlowAnswer> = {}): FlowAnswer {
  return {
    statusByBin: {
      P: [counts({ backlog: 10, in_progress: 2 }), counts({ backlog: 8, in_progress: 2 }), counts({ backlog: 6, in_progress: 2, done: 4 })],
      Q: [counts({ todo: 3, in_review: 1 }), counts({ todo: 3, in_review: 2 }), counts({ todo: 3, in_review: 3 })],
    },
    created: [3, 0, 1],
    closed: [1, 2, 4],
    changes: [counts({ done: 1 }), counts(), counts({ in_progress: 2, done: 1 })],
    cycle: [{ estimate: "s", count: 4, medianMs: 2 * DAY, p90Ms: 5 * DAY }],
    medianCycleMs: 2 * DAY,
    accuracy: [{ estimate: "m", minutes: { count: 3, planned: 60, actual: 120, ratio: 2 } }],
    costByProject: [
      { projectId: "Q", cost: 9 },
      { projectId: "P", cost: 3.75 },
    ],
    typesByWeek: [types({ feature: 2 }), types({ bugfix: 1, untyped: 1 })],
    aging: [{ taskId: "t1", key: "P-7", title: "Stuck in review", projectId: "P", status: "in_review", sinceMs: 0 }],
    projects: PROJECTS,
    logStartMs: 0,
    ...over,
  };
}

const snapshot: TasksSnapshot = {
  total: 30,
  byStatus: counts({ backlog: 6, todo: 3, in_progress: 2, in_review: 3, done: 14, canceled: 2 }),
  byPriority: { none: 30, low: 0, medium: 0, high: 0, urgent: 0 },
  byType: { ...types() },
  plannedMinutes: 125,
  actualMinutes: 60,
  budget: 12.5,
  budgetLimit: 40,
  cost: 9.75,
};

const label = (column: number) => `col ${column}`;
const card = (title: string) => screen.getByRole("region", { name: title });

describe("KpiStrip", () => {
  it("shows open work, the period's inflow and outflow, time and money", () => {
    render(<KpiStrip snapshot={snapshot} flow={flow()} />);
    const value = (name: string) => screen.getByText(name).closest("[data-kpi]")!.querySelector("[data-value]")!.textContent;
    expect(value("Open")).toBe("14");
    expect(value("Created")).toBe("4");
    expect(value("Closed")).toBe("7");
    expect(value("Median cycle")).toBe("2.0 d");
    expect(value("Planned time")).toBe("2h 5m");
    expect(value("Cost")).toBe("$9.75");
  });

  it("gives every figure the same width", () => {
    const { container } = render(<KpiStrip snapshot={snapshot} flow={flow()} />);
    const widths = new Set(Array.from(container.querySelectorAll("[data-kpi]")).map((node) => (node as HTMLElement).className));
    expect(widths.size).toBe(1);
  });
});

describe("StatusChanges", () => {
  it("totals the moves of the period", () => {
    render(<StatusChanges flow={flow()} columnLabel={label} />);
    expect(within(card("Status changes")).getByText("4 moves")).toBeTruthy();
  });
});

describe("Burndown", () => {
  it("opens on the project with the most open work and says how much is left", () => {
    render(<Burndown flow={flow()} columnLabel={label} columnsPerDay={1} />);
    expect(within(card("Burndown")).getByText("8 open")).toBeTruthy();
  });

  it("switches to another project by its chip", () => {
    render(<Burndown flow={flow()} columnLabel={label} columnsPerDay={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Quarry" }));
    expect(within(card("Burndown")).getByText("6 open")).toBeTruthy();
  });

  it("forecasts when a burning project empties at its current pace", () => {
    render(<Burndown flow={flow()} columnLabel={label} columnsPerDay={1} />);
    expect(within(card("Burndown")).getByText("−2.0 / day")).toBeTruthy();
    expect(within(card("Burndown")).getByText("empty in ~4 days")).toBeTruthy();
  });

  it("says a growing project is not burning down", () => {
    render(<Burndown flow={flow()} columnLabel={label} columnsPerDay={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Quarry" }));
    expect(within(card("Burndown")).getByText("not burning down")).toBeTruthy();
  });

  it("says so when no project has tasks", () => {
    render(<Burndown flow={flow({ statusByBin: {} })} columnLabel={label} columnsPerDay={1} />);
    expect(within(card("Burndown")).getByText(/No tasks/)).toBeTruthy();
  });
});

describe("CreatedClosed", () => {
  it("nets inflow against outflow over the period", () => {
    render(<CreatedClosed flow={flow()} columnLabel={label} />);
    expect(within(card("Created vs closed")).getByText("net −3")).toBeTruthy();
  });
});

describe("WorkInProgress", () => {
  it("reports what is in progress and in review now", () => {
    render(<WorkInProgress flow={flow()} columnLabel={label} />);
    expect(within(card("Work in progress")).getByText("5 now · 3 in review")).toBeTruthy();
  });
});

describe("CycleTime", () => {
  it("prints each estimate's median", () => {
    render(<CycleTime rows={flow().cycle} />);
    expect(within(card("Cycle time")).getByText("2.0 d")).toBeTruthy();
  });

  it("says so when nothing was measured", () => {
    render(<CycleTime rows={[]} />);
    expect(within(card("Cycle time")).getByText(/No task went from in progress to done/)).toBeTruthy();
  });
});

describe("EstimateAccuracy", () => {
  it("prints each estimate's overrun", () => {
    render(<EstimateAccuracy rows={flow().accuracy} />);
    expect(within(card("Estimate vs actual")).getByText("×2.0")).toBeTruthy();
  });
});

describe("CostByProject", () => {
  it("totals the spend in the ring and lists every project that spent", () => {
    render(<CostByProject costs={flow().costByProject} projects={PROJECTS} />);
    const section = card("Cost by project");
    expect(within(section).getByText("$12.75")).toBeTruthy();
    expect(within(section).getByText("Quarry")).toBeTruthy();
    expect(within(section).getByText("$3.75")).toBeTruthy();
  });
});

describe("Aging", () => {
  it("lists stuck tasks with their age and opens one by its key", () => {
    const onOpenTask = vi.fn();
    render(<Aging entries={flow().aging} projects={PROJECTS} nowMs={3 * DAY} onOpenTask={onOpenTask} />);
    expect(within(card("Aging")).getByText("3.0 d")).toBeTruthy();
    fireEvent.click(screen.getByText("Stuck in review"));
    expect(onOpenTask).toHaveBeenCalledWith("P-7");
  });
});

describe("ClosedByType", () => {
  it("names in the legend only the types that closed something", () => {
    render(<ClosedByType weeks={flow().typesByWeek} weekLabel={label} />);
    const section = card("Closed by type");
    expect(within(section).getByText("feature")).toBeTruthy();
    expect(within(section).getByText("untyped")).toBeTruthy();
    expect(within(section).queryByText("design")).toBeNull();
  });
});
