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
// The screen lays its rows out by its measured width.
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
const { nextSort } = await import("./segment-table");

const PROJECT = { id: "01HZZZZZZZZZZZZZZZZZZZZZPA", name: "Plugins" };
const TASKS = [aTask(1, { title: "One", cost: 5 }), aTask(2, { title: "Two", cost: 1 }), aTask(3, { title: "Three", cost: 9 })];

type Asked = { rpc: string; input: any }[];

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
  table: { columns: ["key", "title", "cost"], sort: null, rows: 2, rowHeight: "regular" },
};

function renderTable(asked: Asked) {
  const log = (rpc: string, answer: (input: any) => unknown) => (input: any) => {
    asked.push({ rpc, input });
    return answer(input);
  };
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "analytics" },
    {
      rpc: {
        listProjects: () => ({
          projects: [{ ...PROJECT, prefix: "TSK", nextTaskNumber: 4, color: "blue", folderId: null, linkedBbProjectId: null, createdAt: "2026-07-15T00:00:00.000Z" }],
        }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listLabels: () => ({ labels: [] }),
        loadReducedColors: () => ({ enabled: false }),
        loadAnalyticsDashboard: () => ({ version: 1, tiles: [tile], rows: [{ id: "r1", height: 480, minHeight: 180, cells: [{ id: "t1", weight: 1 }] }] }),
        saveAnalyticsDashboard: log("saveAnalyticsDashboard", () => ({ ok: true })),
        analyticsSpan: () => ({ firstCreatedMs: Date.now() }),
        analyticsTile: () => ({
          columns: [{ key: "todo", label: "todo" }],
          series: [{ key: "value", label: "Tasks" }],
          values: [[3]],
          cells: [[TASKS.map((task) => task.key)]],
          titles: {},
          switchValues: [],
          total: 3,
          rows: [],
          figures: {},
          projects: [PROJECT],
          logStartMs: null,
        }),
        analyticsTileTasks: log("analyticsTileTasks", (input) => ({ tasks: TASKS.slice(0, input.limit), total: TASKS.length })),
      } as never,
    },
  );
}

const asks = (asked: Asked) => asked.filter((entry) => entry.rpc === "analyticsTileTasks").map((entry) => entry.input);
const rows = (slot: ReturnType<typeof renderTable>) => Array.from(slot.container.querySelectorAll("[data-task-key]")).map((row) => row.getAttribute("data-task-key"));

describe("the table of a segment under a tile's chart", () => {
  it("shows the tile's columns in order and its first rows, and the next ones on Show more", async () => {
    const asked: Asked = [];
    const slot = renderTable(asked);
    await waitFor(() => expect(rows(slot)).toEqual(["TSK-1", "TSK-2"]));
    expect(Array.from(slot.container.querySelectorAll("th")).map((th) => th.textContent)).toEqual(["Key", "Title", "Cost"]);
    expect(asks(asked).at(-1)).toMatchObject({ pick: null, sort: null, limit: 2 });
    fireEvent.click(slot.getByRole("button", { name: "Show 1 more" }));
    await waitFor(() => expect(rows(slot)).toEqual(["TSK-1", "TSK-2", "TSK-3"]));
    expect(asks(asked).at(-1)).toMatchObject({ limit: 3 });
  });

  it("sorts by a clicked header and keeps the sort in the tile", async () => {
    const asked: Asked = [];
    const slot = renderTable(asked);
    await waitFor(() => expect(rows(slot)).toHaveLength(2));
    fireEvent.click(within(slot.container.querySelector("thead")!).getByRole("button", { name: "Cost" }));
    await waitFor(() => expect(asks(asked).at(-1)).toMatchObject({ sort: { column: "cost", direction: "asc" } }));
    const saved = asked.filter((entry) => entry.rpc === "saveAnalyticsDashboard").at(-1)!.input;
    expect(saved.tiles[0].table.sort).toEqual({ column: "cost", direction: "asc" });
  });

  it("asks for the tasks of a clicked segment", async () => {
    const asked: Asked = [];
    const slot = renderTable(asked);
    await waitFor(() => expect(rows(slot)).toHaveLength(2));
    fireEvent.click(slot.container.querySelector('[data-segment="0:value"]')!);
    await waitFor(() => expect(asks(asked).at(-1)).toMatchObject({ pick: { column: 0, series: "value" } }));
  });
});

describe("nextSort — a click on a header", () => {
  it("runs unsorted → ascending → descending → unsorted, and starts another column ascending", () => {
    expect(nextSort(null, "cost")).toEqual({ column: "cost", direction: "asc" });
    expect(nextSort({ column: "cost", direction: "asc" }, "cost")).toEqual({ column: "cost", direction: "desc" });
    expect(nextSort({ column: "cost", direction: "desc" }, "cost")).toBeNull();
    expect(nextSort({ column: "cost", direction: "desc" }, "key")).toEqual({ column: "key", direction: "asc" });
  });
});

describe("the table of a segment in a narrow tile", () => {
  it("never squeezes the title out: the table is as wide as its other columns and the title's least width, and scrolls", async () => {
    const { defaultColumnWidth } = await import("../table/columns");
    const { TITLE_MIN_PX } = await import("./segment-table");
    const slot = renderTable([]);
    await waitFor(() => expect(rows(slot)).toHaveLength(2));
    const table = slot.container.querySelector("table")!;
    expect(table.style.minWidth).toBe(`${defaultColumnWidth("key") + defaultColumnWidth("cost") + TITLE_MIN_PX}px`);
  });

  it("counts the tasks only once they are known", async () => {
    const slot = renderTable([]);
    expect(slot.container.querySelector("[data-segment-contents]")?.textContent ?? "").not.toContain("· 0");
    await waitFor(() => expect(slot.container.querySelector("[data-segment-contents]")!.textContent).toContain("· 3"));
  });
});
