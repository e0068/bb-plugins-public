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

const DAY = 86_400_000;
const PROJECT = { id: "01HZZZZZZZZZZZZZZZZZZZZZP1", name: "Plugins" };

type Asked = { rpc: string; input: any }[];

function renderAnalytics(asked: Asked, stored: unknown = null, failSave = false) {
  const now = Date.now();
  const log = (rpc: string, answer: (input: any) => unknown) => (input: any) => {
    asked.push({ rpc, input });
    return answer(input);
  };
  const emptyAnswer = (input: any) => ({
    columns: [],
    series: [],
    values: [],
    cells: [],
    titles: {},
    switchValues: input.tile.switch === "project" ? [{ key: PROJECT.id, label: PROJECT.name, count: 1 }] : [],
    total: 1,
    rows:
      input.tile.type === "bars" && input.tile.bars.length === "range"
        ? [
            {
              taskId: "t1",
              key: "TSK-1",
              title: "Weeks on charts",
              projectId: PROJECT.id,
              parentTaskId: null,
              status: "in_progress",
              createdMs: now - 3 * DAY,
              startDate: null,
              dueDate: null,
              segments: [{ status: "in_progress", fromMs: now - 3 * DAY, toMs: now }],
              sinceMs: now - 3 * DAY,
            },
          ]
        : [],
    figures: { open: 1 },
    projects: [PROJECT],
    logStartMs: null,
  });
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "analytics" },
    {
      rpc: {
        listProjects: () => ({
          projects: [{ ...PROJECT, prefix: "TSK", nextTaskNumber: 2, color: "blue", folderId: null, linkedBbProjectId: null, createdAt: "2026-07-15T00:00:00.000Z" }],
        }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listLabels: () => ({ labels: [] }),
        loadReducedColors: () => ({ enabled: false }),
        loadAnalyticsDashboard: () => stored,
        saveAnalyticsDashboard: log("saveAnalyticsDashboard", () => {
          if (failSave) throw new Error("The dashboard was not saved");
          return { ok: true };
        }),
        analyticsSpan: log("analyticsSpan", () => ({ firstCreatedMs: now - 40 * DAY })),
        analyticsTile: log("analyticsTile", emptyAnswer),
      } as never,
    },
  );
}

const TILE = {
  id: "only",
  type: "columns",
  title: "Only",
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
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false },
};

const saved = (asked: Asked) => asked.filter((entry) => entry.rpc === "saveAnalyticsDashboard").map((entry) => entry.input);
const openActions = (tile: HTMLElement) => fireEvent.keyDown(within(tile).getByRole("button", { name: "Chart actions" }), { key: "Enter" });

describe("the analytics screen — saving", () => {
  it("says so when a save is refused, instead of looking saved", async () => {
    const asked: Asked = [];
    const slot = renderAnalytics(asked, null, true);
    openActions(await waitFor(() => slot.getByRole("region", { name: "Stuck tasks" })));
    fireEvent.click(slot.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => slot.getByText(/not saved/));
  });

  it("keeps a duplicate's title within the limit", async () => {
    const asked: Asked = [];
    const long = { version: 1, tiles: [{ ...TILE, title: "x".repeat(120) }], rows: [{ id: "r", height: 240, minHeight: 180, cells: [{ id: "only", weight: 1 }] }] };
    const slot = renderAnalytics(asked, long);
    openActions(await waitFor(() => slot.getByRole("region", { name: "x".repeat(120) })));
    fireEvent.click(slot.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(saved(asked)).toHaveLength(1));
    expect(saved(asked)[0].tiles.every((tile: { title: string }) => tile.title.length <= 120)).toBe(true);
    expect(saved(asked)[0].tiles).toHaveLength(2);
  });
});
