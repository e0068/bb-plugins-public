// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { Label, Project, Task } from "../../shared/contract.js";
import type { RowField } from "../common/row-field-preference.js";

// Compact viewport: menus render as drawers whose items are clickable in jsdom.
window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

await loadPluginApp(() => import("../../app"));
const { TableCell, TitleCell } = await import("./cells.js");
const { slugOf } = await import("../../shared/format.js");
type CellContext = import("./cells.js").CellContext;

afterEach(cleanup);

const project: Project = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Shader Lab",
  prefix: "SH",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
} as Project;

const label: Label = { id: "L1", projectId: project.id, name: "tasks-plus", color: "#0a0" } as Label;

const full: Task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: project.id,
  number: 1,
  key: "SH-1",
  title: "Glow presets",
  description: "First paragraph.\n\nSecond.",
  status: "in_review",
  priority: "high",
  type: "bugfix",
  estimate: "m",
  plannedMinutes: 90,
  actualMinutes: 30,
  budget: 12,
  budgetLimit: 20,
  cost: 4.5,
  dueDate: "2026-10-03",
  startDate: "2026-09-28",
  parentTaskId: "01HZZZZZZZZZZZZZZZZZZZZZT9",
  epicId: "01HZZZZZZZZZZZZZZZZZZZZZT8",
  position: 1,
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-26T10:00:00.000Z",
  labelIds: ["L1"],
  assignee: "Vakhnin Sergei",
  source: null,
} as Task;

const empty: Task = {
  ...full,
  id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
  key: "SH-2",
  description: "",
  priority: "none",
  type: null,
  estimate: null,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  epicId: null,
  labelIds: [],
  assignee: null,
} as Task;

const context = (patch: Partial<CellContext> = {}): CellContext => ({
  project,
  labelsById: new Map([["L1", label]]),
  taskKeys: new Map([
    ["01HZZZZZZZZZZZZZZZZZZZZZT9", "SH-9"],
    ["01HZZZZZZZZZZZZZZZZZZZZZT8", "SH-8"],
  ]),
  activeThreads: 0,
  subtasks: { done: 0, total: 0 },
  showEmpty: false,
  onEdit: () => {},
  displays: undefined,
  now: new Date(2026, 9, 4, 12, 0),
  ...patch,
});

function cell(column: RowField, task: Task, ctx: CellContext = context()) {
  return renderSlot({ component: () => <TableCell column={column} task={task} context={ctx} /> }, {}, {});
}

const text = (column: RowField, task: Task, ctx?: CellContext) => {
  const slot = cell(column, task, ctx);
  const value = slot.container.textContent?.trim() ?? "";
  cleanup();
  return value;
};

describe("a cell reads as text with an icon", () => {
  it("status, priority, type and estimate read as text with an icon", () => {
    for (const [column, expected] of [
      ["status", "In Review"],
      ["priority", "High"],
      ["type", "Bugfix"],
      ["estimate", "M"],
    ] as const) {
      const slot = cell(column, full);
      expect(slot.container.textContent).toContain(expected);
      expect(slot.container.querySelector("svg")).not.toBeNull();
      cleanup();
    }
  });

  it("names, dates and amounts read as the board shows them", () => {
    expect(text("project", full)).toContain("Shader Lab");
    expect(text("parent", full)).toContain("SH-9");
    expect(text("assignee", full)).toContain("Vakhnin Sergei");
    expect(text("labels", full)).toContain("tasks-plus");
    expect(text("key", full)).toBe("SH-1");
    expect(text("dueDate", full)).toMatch(/Oct 3/);
    expect(text("startDate", full)).toMatch(/Sep 28/);
    expect(text("plannedMinutes", full)).toMatch(/1h 30m|1:30|90/);
    expect(text("budget", full)).toContain("$12");
    expect(text("cost", full)).toContain("4.5");
    expect(text("description", full)).toBe("First paragraph.");
    expect(text("subtasks", full, context({ subtasks: { done: 1, total: 3 } }))).toContain("1 / 3");
    expect(text("active", full, context({ activeThreads: 1 }))).toContain("Active");
  });

  it("created and edited read with hours and minutes", () => {
    const at = { ...full, createdAt: new Date(2026, 8, 20, 9, 5).toISOString(), updatedAt: new Date(2026, 8, 26, 17, 40).toISOString() } as Task;
    expect(text("createdAt", at)).toBe("Sep 20, 09:05");
    expect(text("updatedAt", at)).toBe("Sep 26, 17:40");
  });

  it("a date column reads in the format its menu chose", () => {
    const at = { ...full, createdAt: new Date(2026, 9, 4, 9, 0).toISOString(), dueDate: "2026-10-05T15:30" } as Task;
    const chosen = context({ displays: { createdAt: { format: "relative" }, dueDate: { format: "date" } } });
    expect(text("createdAt", at, chosen)).toBe("3h ago");
    expect(text("dueDate", at, chosen)).toBe("Oct 5");
  });

  it("a column's icon shows or hides as its menu chose", () => {
    const iconOf = (column: RowField, ctx: CellContext) => {
      const found = cell(column, full, ctx).container.querySelector("svg") !== null;
      cleanup();
      return found;
    };
    expect(iconOf("dueDate", context())).toBe(false);
    expect(iconOf("dueDate", context({ displays: { dueDate: { icon: true } } }))).toBe(true);
    expect(iconOf("type", context({ displays: { type: { icon: false } } }))).toBe(false);
  });

  it("the slug column shows the task's slug", () => {
    expect(text("slug", full)).toBe(slugOf(full.id));
    expect(text("slug", full).length).toBeGreaterThan(0);
  });

  it("an empty value is blank, or a dash when empty values are shown", () => {
    for (const column of ["priority", "parent", "assignee", "labels", "dueDate", "budget", "estimate", "description", "active"] as const) {
      expect(text(column, empty), column).toBe("");
      expect(text(column, empty, context({ showEmpty: true })), column).toBe("—");
    }
  });
});

describe("editing and folding from a cell", () => {
  it("picking a status in the cell edits the task", async () => {
    const onEdit = vi.fn();
    const slot = cell("status", full, context({ onEdit }));
    fireEvent.click(slot.getByRole("button", { name: /Change status/ }));
    const drawer = await slot.findByRole("dialog", { name: "Change status" });
    fireEvent.click(await within(drawer).findByRole("menuitem", { name: /Done/ }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(full, { status: "done" }));
  });

  it("picking a priority in the cell edits the task, an empty priority too", async () => {
    const onEdit = vi.fn();
    const slot = cell("priority", empty, context({ onEdit }));
    fireEvent.click(slot.getByRole("button", { name: /Set priority/ }));
    const drawer = await slot.findByRole("dialog", { name: /priority/i });
    fireEvent.click(await within(drawer).findByRole("menuitem", { name: /Urgent/ }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(empty, { priority: "urgent" }));
  });

  it("the title cell of a parent toggles its children", () => {
    const onToggle = vi.fn();
    const slot = renderSlot(
      { component: () => <TitleCell task={full} depth={1} childCount={2} collapsed={false} onToggle={onToggle} /> },
      {},
      {},
    );
    expect(slot.container.textContent).toContain("Glow presets");
    expect(slot.container.textContent).toContain("2");
    fireEvent.click(slot.getByRole("button", { name: /Collapse sub-tasks/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    cleanup();
    const leaf = renderSlot(
      { component: () => <TitleCell task={empty} depth={0} childCount={0} collapsed={false} onToggle={onToggle} /> },
      {},
      {},
    );
    expect(leaf.queryByRole("button", { name: /sub-tasks/ })).toBeNull();
    cleanup();
    const folded = renderSlot(
      { component: () => <TitleCell task={full} depth={0} childCount={2} collapsed onToggle={onToggle} /> },
      {},
      {},
    );
    expect(folded.getByRole("button", { name: /Expand sub-tasks/ })).toBeDefined();
  });
});

describe("each nesting level of a title steps in by one lead", () => {
  const title = (depth: number, childCount: number) => {
    const slot = renderSlot(
      { component: () => <TitleCell task={full} depth={depth} childCount={childCount} collapsed={false} onToggle={() => {}} /> },
      {},
      {},
    );
    const cell = slot.container.firstElementChild as HTMLElement;
    const lead = cell.querySelector("[data-title-lead]") as HTMLElement | null;
    const view = {
      indent: parseFloat(cell.style.paddingLeft || "0"),
      lead: lead?.getAttribute("data-title-lead") ?? null,
      leadWidth: lead ? Array.from(lead.classList).filter((name) => /^(size|w)-/.test(name)) : [],
    };
    cleanup();
    return view;
  };

  it("a parent leads with its chevron and a sub-task with a tree mark of the same width", () => {
    const parentRow = title(0, 2);
    const child = title(1, 0);
    expect(parentRow.lead).toBe("toggle");
    expect(child.lead).toBe("branch");
    expect(child.leadWidth).toEqual(parentRow.leadWidth);
    expect(child.leadWidth).not.toEqual([]);
  });

  it("a task with no sub-tasks and no parent has no lead", () => {
    expect(title(0, 0).lead).toBeNull();
  });

  it("a top-level row is not indented", () => {
    expect(title(0, 2).indent).toBe(0);
    expect(title(0, 0).indent).toBe(0);
  });

  it("every level, the first included, sits one equal step right of the level above", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), fc.nat(3), fc.nat(3), (depth, above, below) => {
        const step = title(1, above).indent;
        expect(step).toBeGreaterThan(0);
        expect(title(depth + 1, below).indent - title(depth, above).indent).toBeCloseTo(step);
      }),
      { numRuns: 30 },
    );
  });

  it("whether a row has sub-tasks does not move it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (depth) => {
        expect(title(depth, 2).indent).toBe(title(depth, 0).indent);
      }),
      { numRuns: 15 },
    );
  });
});
