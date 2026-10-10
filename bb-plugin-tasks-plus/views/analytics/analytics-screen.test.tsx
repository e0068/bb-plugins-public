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
const { setAnalyticsFilter } = await import("./page-filter");
const { DEFAULT_FILTER } = await import("./default-dashboard");

afterEach(() => {
  cleanup();
  setAnalyticsFilter(() => DEFAULT_FILTER);
});

const DAY = 86_400_000;
const PROJECT = { id: "01HZZZZZZZZZZZZZZZZZZZZZP1", name: "Plugins" };

type Asked = { rpc: string; input: any }[];

function renderAnalytics(asked: Asked, stored: unknown = null) {
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
        saveAnalyticsDashboard: log("saveAnalyticsDashboard", () => ({ ok: true })),
        analyticsSpan: log("analyticsSpan", () => ({ firstCreatedMs: now - 40 * DAY })),
        analyticsTile: log("analyticsTile", emptyAnswer),
      } as never,
    },
  );
}

const saved = (asked: Asked) => asked.filter((entry) => entry.rpc === "saveAnalyticsDashboard").map((entry) => entry.input);
const openActions = (tile: HTMLElement) => fireEvent.keyDown(within(tile).getByRole("button", { name: "Chart actions" }), { key: "Enter" });

describe("the analytics screen", () => {
  it("opens with the default tiles, the Gantt drawing the period's facts", async () => {
    const slot = renderAnalytics([]);
    const gantt = await waitFor(() => slot.getByRole("region", { name: "Gantt" }));
    await waitFor(() => within(gantt).getByRole("button", { name: /TSK-1/ }));
    expect(gantt.querySelectorAll("[data-gantt-fact]")).toHaveLength(1);
    expect(slot.getByRole("region", { name: "Work" })).toBeTruthy();
    await waitFor(() => within(slot.getByRole("region", { name: "Burndown" })).getByRole("group", { name: "Switch Burndown" }));
  });

  it("adds a chart from the empty tile and drops it on Cancel, saving nothing", async () => {
    const asked: Asked = [];
    const slot = renderAnalytics(asked);
    fireEvent.click(await waitFor(() => slot.getByRole("button", { name: "Add chart" })));
    await waitFor(() => slot.getByRole("complementary", { name: "Chart settings" }));
    expect(slot.getByRole("region", { name: "New chart" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(slot.queryByRole("region", { name: "New chart" })).toBeNull());
    expect(saved(asked)).toEqual([]);
  });

  it("keeps an added chart once it is added", async () => {
    const asked: Asked = [];
    const slot = renderAnalytics(asked);
    fireEvent.click(await waitFor(() => slot.getByRole("button", { name: "Add chart" })));
    const panel = await waitFor(() => slot.getByRole("complementary", { name: "Chart settings" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Add chart" }));
    await waitFor(() => expect(saved(asked)).toHaveLength(1));
    expect(saved(asked)[0].tiles.map((tile: { title: string }) => tile.title)).toContain("New chart");
  });

  it("renames a tile live in its panel and keeps the name on Save", async () => {
    const asked: Asked = [];
    const slot = renderAnalytics(asked);
    const tile = await waitFor(() => slot.getByRole("region", { name: "Cost by project" }));
    openActions(tile);
    fireEvent.click(slot.getByRole("menuitem", { name: "Edit chart" }));
    const panel = await waitFor(() => slot.getByRole("complementary", { name: "Chart settings" }));
    fireEvent.change(within(panel).getByLabelText("Title"), { target: { value: "Spend" } });
    await waitFor(() => slot.getByRole("region", { name: "Spend" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved(asked)).toHaveLength(1));
    expect(saved(asked)[0].tiles.find((entry: { id: string }) => entry.id === "cost").title).toBe("Spend");
  });

  it("deletes a tile and its cell", async () => {
    const asked: Asked = [];
    const slot = renderAnalytics(asked);
    openActions(await waitFor(() => slot.getByRole("region", { name: "Stuck tasks" })));
    fireEvent.click(slot.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(saved(asked)).toHaveLength(1));
    const [dashboard] = saved(asked);
    expect(dashboard.tiles.some((entry: { id: string }) => entry.id === "aging")).toBe(false);
    expect(dashboard.rows.flatMap((row: { cells: { id: string }[] }) => row.cells.map((cell) => cell.id))).not.toContain("aging");
  });

  it("picks the period on a segmented control: the picked segment takes the page's background", async () => {
    const slot = renderAnalytics([]);
    const period = await waitFor(() => slot.getByRole("group", { name: "Period" }));
    expect(period.className).toContain("bg-muted");
    const month = within(period).getByRole("button", { name: "Month" });
    expect(month.className).not.toContain("bg-background");
    fireEvent.click(month);
    expect(month.getAttribute("aria-pressed")).toBe("true");
    expect(month.className).toContain("bg-background");
    expect(within(period).getByRole("button", { name: "Week" }).className).not.toContain("bg-background");
  });

  it("keeps the page's title, filters and period in the topbar, left of Refresh — no header on the page", async () => {
    const slot = renderAnalytics([]);
    const period = await waitFor(() => slot.getByRole("group", { name: "Period" }));
    const bar = period.closest("header")!;
    expect(within(bar).getByText("Analytics")).toBeTruthy();
    const order = [within(bar).getByRole("button", { name: "Filter" }), period, within(bar).getByRole("button", { name: "Refresh tasks" })];
    order.slice(1).forEach((after, index) => expect(order[index]!.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(slot.queryByRole("heading", { name: "Analytics" })).toBeNull();
    expect(slot.queryByRole("group", { name: "Projects" })).toBeNull();
  });

  it("asks every tile over the filters picked in the topbar", async () => {
    const asked: Asked = [];
    renderAnalytics(asked);
    await waitFor(() => expect(asked.some((entry) => entry.rpc === "analyticsTile")).toBe(true));
    const filters = { ...DEFAULT_FILTER.filters, statuses: ["done" as const], values: { project: [PROJECT.id] } };
    asked.length = 0;
    setAnalyticsFilter((current) => ({ ...current, filters }));
    await waitFor(() => {
      const tiles = asked.filter((entry) => entry.rpc === "analyticsTile");
      expect(tiles.length).toBeGreaterThan(0);
      tiles.forEach((entry) => expect(entry.input).toMatchObject({ filters, projectIds: [PROJECT.id] }));
    });
  });

  it("opens all time at the first task's week", async () => {
    const asked: Asked = [];
    const slot = renderAnalytics(asked);
    fireEvent.click(await waitFor(() => slot.getByRole("button", { name: "All time" })));
    await waitFor(() => expect(asked.some((entry) => entry.rpc === "analyticsSpan")).toBe(true));
    await waitFor(() => {
      const changes = asked.filter((entry) => entry.rpc === "analyticsTile" && entry.input.tile.id === "changes").at(-1)!.input as { edges: number[] };
      expect(changes.edges.length).toBeGreaterThanOrEqual(6);
      expect(new Date(changes.edges[0]!).getDay()).toBe(1);
    });
  });
});
