// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task, TaskThread } from "../../shared/contract.js";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

await loadPluginApp(() => import("../../app"));
const { TableCell } = await import("./cells.js");
type CellContext = import("./cells.js").CellContext;

afterEach(cleanup);

const task = { id: "P1:t1", projectId: "P1", key: "SH-1", title: "Glow", assignee: null } as unknown as Task;

const thread = (n: number, patch: Partial<TaskThread> = {}): TaskThread => ({
  id: `rec_${n}` as TaskThread["id"],
  taskId: task.id as TaskThread["taskId"],
  threadId: `thr_${n}`,
  presetName: "Code",
  title: `Thread ${n}`,
  liveStatus: "idle",
  archivedAt: null,
  attachedAt: "2026-10-01T10:00:00.000Z",
  ...patch,
});

const context = (threads: readonly TaskThread[], patch: Partial<CellContext> = {}): CellContext => ({
  project: undefined,
  labelsById: new Map(),
  taskKeys: new Map(),
  activeThreads: 0,
  threads,
  subtasks: { done: 0, total: 0 },
  showEmpty: false,
  onEdit: () => {},
  displays: undefined,
  now: new Date(2026, 9, 4, 12, 0),
  ...patch,
});

const render = (ctx: CellContext, onRowClick = vi.fn()) => ({
  onRowClick,
  slot: renderSlot(
    { component: () => (<div onClick={onRowClick}><TableCell column="threads" task={task} context={ctx} /></div>) },
    {},
    {},
  ),
});

describe("the Assignee cell — the threads attached to a task", () => {
  it("draws every thread as a button named by its title", () => {
    const { slot } = render(context([thread(1), thread(2)]));
    expect(slot.getAllByRole("button").map((button) => button.textContent)).toEqual(["Thread 1", "Thread 2"]);
  });

  it("opens the clicked thread, and not the task under the row", () => {
    const { slot, onRowClick } = render(context([thread(1), thread(2)]));
    fireEvent.click(slot.getAllByRole("button")[1]!);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_2" }]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("is blank without a thread, and a dash when empty values are shown", () => {
    expect(render(context([])).slot.container.textContent).toBe("");
    cleanup();
    expect(render(context([], { showEmpty: true })).slot.container.textContent).toBe("—");
  });
});
