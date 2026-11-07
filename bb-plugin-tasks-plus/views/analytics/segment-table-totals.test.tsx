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
const TASKS = [aTask(1, { title: "One", cost: 5 }), aTask(2, { title: "Two", cost: 10 })];

type Saved = { tiles: { table: { totals?: { column: string; fn: string }[] } }[] }[];

const tile = (totals: { column: string; fn: string }[]) => ({
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
  table: { columns: ["key", "title", "cost", "status"], sort: null, rows: 5, rowHeight: "regular", totals },
});

function renderTable(totals: { column: string; fn: string }[], saved: Saved, answer: { column: string; value: number | null }[]) {
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
        loadAnalyticsDashboard: () => ({ version: 1, tiles: [tile(totals)], rows: [{ id: "r1", height: 480, minHeight: 180, cells: [{ id: "t1", weight: 1 }] }] }),
        saveAnalyticsDashboard: (input: Saved[number]) => {
          saved.push(input as never);
          return { ok: true };
        },
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
        analyticsTileTasks: () => ({ tasks: TASKS, total: TASKS.length, totals: answer }),
      } as never,
    },
  );
}

const footer = (slot: ReturnType<typeof renderTable>) => slot.container.querySelector("tfoot") as HTMLElement;
const trigger = (slot: ReturnType<typeof renderTable>, column: string) => within(footer(slot)).getByRole("button", { name: `${column} total` });
const open = (slot: ReturnType<typeof renderTable>, column: string) => fireEvent.keyDown(trigger(slot, column), { key: "Enter" });
const options = (slot: ReturnType<typeof renderTable>) => slot.getAllByRole("menuitemradio").map((item) => item.textContent);

describe("the totals row under a segment table", () => {
  it("shows a row of totals under the table: the chosen one by name and number, an unchosen column asking to Calculate", async () => {
    const slot = renderTable([{ column: "cost", fn: "sum" }], [], [{ column: "cost", value: 15 }]);
    await waitFor(() => expect(footer(slot)).not.toBeNull());
    await waitFor(() => expect(within(footer(slot)).getByText("$15")).not.toBeNull());
    expect(trigger(slot, "Cost").textContent).toContain("Sum");
    expect(trigger(slot, "Status").textContent).toContain("Calculate");
    expect(within(footer(slot)).queryByRole("button", { name: "Title total" })).toBeNull();
  });

  it("offers None, Unique, Sum and Median on a number, and only None and Unique on any other column", async () => {
    const slot = renderTable([], [], []);
    await waitFor(() => expect(footer(slot)).not.toBeNull());
    open(slot, "Cost");
    expect(options(slot)).toEqual(["None", "Unique", "Sum", "Median"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(slot.queryAllByRole("menuitemradio")).toHaveLength(0));
    open(slot, "Status");
    expect(options(slot)).toEqual(["None", "Unique"]);
  });

  it("keeps the chosen total with the tile, and None takes it away", async () => {
    const saved: Saved = [];
    const slot = renderTable([], saved, []);
    await waitFor(() => expect(footer(slot)).not.toBeNull());
    open(slot, "Cost");
    fireEvent.click(slot.getByRole("menuitemradio", { name: "Sum" }));
    await waitFor(() => expect(saved.at(-1)?.tiles[0]?.table.totals).toEqual([{ column: "cost", fn: "sum" }]));
  });

  it("drops a column's total when None is chosen on it", async () => {
    const saved: Saved = [];
    const slot = renderTable([{ column: "cost", fn: "sum" }, { column: "status", fn: "unique" }], saved, []);
    await waitFor(() => expect(footer(slot)).not.toBeNull());
    open(slot, "Cost");
    fireEvent.click(slot.getByRole("menuitemradio", { name: "None" }));
    await waitFor(() => expect(saved.at(-1)?.tiles[0]?.table.totals).toEqual([{ column: "status", fn: "unique" }]));
  });

  it("draws the totals in the type of the table's rows, and a number column flush right — its head, its cells and its total", async () => {
    const slot = renderTable([{ column: "cost", fn: "sum" }, { column: "status", fn: "unique" }], [], [{ column: "cost", value: 15 }, { column: "status", value: 1 }]);
    await waitFor(() => expect(within(footer(slot)).getByText("$15")).not.toBeNull());
    const sizeOf = (element: Element | null): string | undefined => {
      for (let at = element; at !== null; at = at.parentElement) {
        const size = at.classList.value.split(" ").find((name) => /^text-(2xs|xs|sm|base)$/.test(name));
        if (size !== undefined) return size;
      }
      return undefined;
    };
    const row = slot.container.querySelector("tbody tr[data-task-key]") as HTMLElement;
    const column = (index: number) => ({
      head: (slot.container.querySelectorAll("thead button")[index] as HTMLElement).className,
      cell: (row.querySelectorAll("td")[index]!.firstElementChild as HTMLElement).className,
    });
    for (const total of [trigger(slot, "Cost"), trigger(slot, "Status")]) {
      expect(sizeOf(total)).toBe(sizeOf(row.querySelector("td")));
      expect(total.querySelectorAll("[class*='text-2xs'], [class*='uppercase']")).toHaveLength(0);
    }
    expect(sizeOf(slot.container.querySelector("thead button"))).toBe(sizeOf(row.querySelector("td")));
    expect(column(2).head).toContain("justify-end");
    expect(column(2).cell).toContain("justify-end");
    expect(trigger(slot, "Cost").className).toContain("justify-end");
    expect(column(3).head).not.toContain("justify-end");
    expect(column(3).cell).not.toContain("justify-end");
    expect(trigger(slot, "Status").className).not.toContain("justify-end");
  });

  it("keeps a header's sort clicked while the tile is edited, and not the columns its draft has not saved", async () => {
    const saved: Saved = [];
    const slot = renderTable([], saved, []);
    const region = await waitFor(() => slot.getByRole("region", { name: "By status" }));
    fireEvent.keyDown(within(region).getByRole("button", { name: "Chart actions" }), { key: "Enter" });
    fireEvent.click(slot.getByRole("menuitem", { name: "Edit chart" }));
    const panel = await waitFor(() => slot.getByRole("complementary", { name: "Chart settings" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Status", pressed: true }));
    const head = slot.container.querySelector("thead") as HTMLElement;
    fireEvent.click(within(head).getByRole("button", { name: /Cost/ }));
    await waitFor(() => expect(saved.at(-1)?.tiles[0]?.table).toMatchObject({ sort: { column: "cost", direction: "asc" } }));
    expect(saved.at(-1)?.tiles[0]?.table).toMatchObject({ columns: ["key", "title", "cost", "status"] });
  });
});
