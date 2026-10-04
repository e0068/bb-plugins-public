// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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

describe("the Flow field", () => {
  it("a cell names the flow the task ran through, and is blank without one", () => {
    const withFlow = { ...full, flow: { id: "f1", name: "Code" } } as Task;
    expect(text("flow", withFlow)).toBe("Code");
    expect(text("flow", { ...full, flow: null } as Task)).toBe("");
  });
});
