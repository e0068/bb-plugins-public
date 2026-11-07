// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);
const { aTask } = await import("../../test-support/analytics-tasks");

const PROJECT = { id: "01HZZZZZZZZZZZZZZZZZZZZZPA", name: "Plugins" };
const TASKS = [aTask(1, { title: "One" }), aTask(2, { title: "Two" })];

const tile = {
  id: "t1",
  type: "columns",
  title: "By status",
  window: "page",
  x: "status",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: null,
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false, contents: 0.5 },
  table: { columns: ["key", "threads"], sort: null, rows: 5, rowHeight: "regular" },
};

const thread = (n: number) => ({
  id: `rec_${n}`,
  taskId: TASKS[0]!.id,
  threadId: `thr_${n}`,
  presetName: "Code",
  title: `Thread ${n}`,
  liveStatus: "idle",
  archivedAt: null,
  attachedAt: "2026-10-01T10:00:00.000Z",
});

function renderTable() {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "analytics" },
    {
      rpc: {
        listProjects: () => ({
          projects: [{ ...PROJECT, prefix: "TSK", nextTaskNumber: 3, color: "blue", folderId: null, linkedBbProjectId: null, createdAt: "2026-07-15T00:00:00.000Z" }],
        }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listLabels: () => ({ labels: [] }),
        loadReducedColors: () => ({ enabled: false }),
        loadAnalyticsDashboard: () => ({ version: 1, tiles: [tile], rows: [{ id: "r1", height: 480, minHeight: 180, cells: [{ id: "t1", weight: 1 }] }] }),
        saveAnalyticsDashboard: () => ({ ok: true }),
        analyticsSpan: () => ({ firstCreatedMs: Date.now() }),
        analyticsTile: () => ({
          columns: [{ key: "todo", label: "todo" }],
          series: [{ key: "value", label: "Tasks" }],
          values: [[2]],
          cells: [[TASKS.map((task) => task.key)]],
          titles: {},
          switchValues: [],
          total: 2,
          rows: [],
          figures: {},
          projects: [PROJECT],
          logStartMs: null,
        }),
        analyticsTileTasks: () => ({ tasks: TASKS, total: TASKS.length, totals: [] }),
        taskCardMeta: () => ({
          cards: [
            { taskId: TASKS[0]!.id, attachmentCount: 0, taskThreads: [thread(1), thread(2)] },
            { taskId: TASKS[1]!.id, attachmentCount: 0, taskThreads: [] },
          ],
        }),
      } as never,
    },
  );
}

const row = (slot: ReturnType<typeof renderTable>, key: string) => slot.container.querySelector(`[data-task-key="${key}"]`) as HTMLElement;

describe("the Assignee column of a segment table", () => {
  it("shows a task's threads as chips, a task without one blank, and opens a thread on click", async () => {
    const slot = renderTable();
    await waitFor(() => expect(within(row(slot, "TSK-1")).queryAllByRole("button", { name: /Thread/ })).toHaveLength(2));
    expect(within(row(slot, "TSK-2")).queryAllByRole("button", { name: /Thread/ })).toHaveLength(0);
    fireEvent.click(within(row(slot, "TSK-1")).getByRole("button", { name: "Thread 2" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_2" });
  });
});
