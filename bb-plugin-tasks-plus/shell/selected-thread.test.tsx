// @vitest-environment jsdom
// «Show the selected thread»: Tasks+ opened at its root shows the task of the
// thread the owner came from — or every task of that thread, when it has several.
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { SELECTED_THREAD_SETTING } from "@bb-plugins/rail-collapse";
import { followSelectedThread } from "@bb-plugins/rail-collapse/selection-dom";
import type { Task } from "../shared/contract.js";

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
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const app = await loadPluginApp(() => import("../app"));

// The owner came from thread thr_1 to Tasks+; bb's route events are driven by hand.
let leaveFollow: () => void = () => undefined;
let routeListeners: Array<() => void> = [];
beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState(null, "", "/threads/thr_1");
  leaveFollow = followSelectedThread("tasks-plus", {
    window,
    now: () => 0,
    onRouteChange: (listener) => {
      routeListeners.push(listener);
      return () => void (routeListeners = routeListeners.filter((l) => l !== listener));
    },
  });
  window.history.pushState(null, "", "/plugins/tasks-plus/tasks");
  routeListeners.forEach((l) => l());
});
afterEach(() => {
  cleanup();
  leaveFollow();
  delete (window as unknown as Record<symbol, unknown>)[Symbol.for("bb-plugins.selected-thread.v1")];
});

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const project = { id: P1, name: "Tasks Plugin", prefix: "TSK", nextTaskNumber: 9, color: "blue", folderId: null, linkedBbProjectId: null, createdAt: "2026-07-15T00:00:00.000Z" };

function task(number: number): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: P1,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    source: null,
  };
}

function render(subPath: string, threadTasks: Task[], enabled = true) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listTasks: () => ({ tasks: threadTasks, nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        tasksForThread: () => ({ tasks: threadTasks }),
      } as never,
      settings: { [SELECTED_THREAD_SETTING]: enabled },
      sidebarThreads: {
        status: "ready",
        threads: [{ id: "thr_1", title: "Collapse the panel", titleFallback: null } as never],
      },
    },
  );
}

/** A plain click on a row of bb's threads panel. */
function pickRow(threadId: string): void {
  const row = document.createElement("a");
  row.dataset.sidebarThreadId = threadId;
  document.body.append(row);
  act(() => row.click());
  row.remove();
}

const go = (subPath: string) => ({ method: "toPluginPanel", path: "tasks", options: { subPath, replace: true } });

describe("Tasks+ shows the selected thread", () => {
  it("opened at its root, it opens the thread's only task", async () => {
    const slot = render("", [task(1)]);
    await waitFor(() => expect(slot.navigateCalls).toContainEqual(go("task/TSK-1")));
    expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "tasksForThread", input: expect.objectContaining({ threadId: "thr_1" }) }));
  });

  it("a thread with several tasks opens all tasks narrowed to it", async () => {
    const slot = render("", [task(1), task(2)]);
    await waitFor(() => expect(slot.navigateCalls).toContainEqual(go("all?thread=thr_1")));
  });

  it("with the setting off, nothing is asked about the thread", async () => {
    const slot = render("", [task(1)], false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.rpcCalls.some((call) => call.method === "tasksForThread")).toBe(false);
  });

  it("all tasks of a thread asks the list for that thread and says so, with a way back to every task", async () => {
    const slot = render("all?thread=thr_1", [task(1), task(2)]);
    await waitFor(() => expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "listTasks", input: expect.objectContaining({ threadId: "thr_1" }) })));
    expect(await slot.findByText("Only tasks of “Collapse the panel”")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Show all tasks" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "tasks", options: { subPath: "all" } });
  });

  it("a picked thread without tasks opens the thread itself", async () => {
    const slot = render("all", []);
    await waitFor(() => expect(slot.rpcCalls.some((call) => call.method === "listTasks")).toBe(true));
    pickRow("thr_2");
    await waitFor(() => expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_2" }));
  });

  it("all tasks of a thread is remembered as all tasks: the next visit with the setting off opens every task", async () => {
    const narrowed = render("all?thread=thr_1", [task(1), task(2)]);
    await waitFor(() => expect(narrowed.rpcCalls.some((call) => call.method === "listTasks")).toBe(true));
    cleanup();
    const next = render("", [task(1)], false);
    await waitFor(() => expect(next.navigateCalls).toContainEqual(go("all")));
  });
});
