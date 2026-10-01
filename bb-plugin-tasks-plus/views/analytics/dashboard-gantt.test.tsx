// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const DAY = 86_400_000;
const PROJECT = { id: "01HZZZZZZZZZZZZZZZZZZZZZP1", name: "Plugins" };
const zero = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 };

function renderAnalytics(asked: { rpc: string; input: unknown }[]) {
  const now = Date.now();
  const log = (rpc: string, answer: unknown) => (input: unknown) => {
    asked.push({ rpc, input });
    return answer;
  };
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "analytics" },
    {
      rpc: {
        listProjects: () => ({
          projects: [
            {
              ...PROJECT,
              prefix: "TSK",
              nextTaskNumber: 2,
              color: "blue",
              folderId: null,
              linkedBbProjectId: null,
              createdAt: "2026-07-15T00:00:00.000Z",
            },
          ],
        }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        loadReducedColors: () => ({ enabled: false }),
        analyticsSpan: log("analyticsSpan", { firstCreatedMs: now - 40 * DAY }),
        analyticsSnapshot: log("analyticsSnapshot", {
          total: 1,
          byStatus: zero,
          byPriority: { none: 1, low: 0, medium: 0, high: 0, urgent: 0 },
          byType: {},
          plannedMinutes: 0,
          actualMinutes: 0,
          budget: 0,
          budgetLimit: 0,
          cost: 0,
        }),
        analyticsFlow: log("analyticsFlow", {
          statusByBin: {},
          created: [],
          closed: [],
          changes: [],
          cycle: [],
          medianCycleMs: null,
          accuracy: [],
          costByProject: [],
          typesByWeek: [],
          aging: [],
          projects: [PROJECT],
          logStartMs: null,
        }),
        analyticsClosed: log("analyticsClosed", { windows: [{ closings: [] }, { closings: [] }], projects: [PROJECT], logStartMs: null }),
        ganttRows: log("ganttRows", {
          rows: [
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
            },
          ],
          projects: [PROJECT],
        }),
      },
    },
  );
}

describe("the analytics screen", () => {
  it("draws the tasks of the period on a Gantt, the facts by default", async () => {
    const asked: { rpc: string; input: unknown }[] = [];
    const slot = renderAnalytics(asked);
    const gantt = await waitFor(() => slot.getByRole("region", { name: "Gantt" }));
    await waitFor(() => within(gantt).getByRole("button", { name: /TSK-1/ }));
    expect(gantt.querySelectorAll("[data-gantt-fact]")).toHaveLength(1);
    expect(within(gantt).getByRole("button", { name: "Fact" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens all time at the first task, the Gantt from its week", async () => {
    const asked: { rpc: string; input: unknown }[] = [];
    const slot = renderAnalytics(asked);
    fireEvent.click(await waitFor(() => slot.getByRole("button", { name: "All time" })));
    await waitFor(() => expect(asked.some((entry) => entry.rpc === "analyticsSpan")).toBe(true));
    await waitFor(() => {
      const flow = asked.filter((entry) => entry.rpc === "analyticsFlow").at(-1)!.input as { edges: number[] };
      expect(flow.edges.length).toBeGreaterThanOrEqual(6);
      expect(new Date(flow.edges[0]!).getDay()).toBe(1);
      const gantt = asked.filter((entry) => entry.rpc === "ganttRows").at(-1)!.input as { fromMs: number };
      expect(gantt.fromMs).toBe(flow.edges[0]);
    });
  });
});
