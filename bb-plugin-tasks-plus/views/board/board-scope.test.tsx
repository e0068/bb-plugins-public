// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

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
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/** jsdom lays nothing out: column i spans x from 300·i to 300·i + 230, cards sit at the top. */
Element.prototype.getBoundingClientRect = function (this: Element) {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  if (this.getAttribute("data-board-column") !== null) {
    const columns = Array.from(document.querySelectorAll("[data-board-column]"));
    return rect(columns.indexOf(this) * 300, 0, 230, 800);
  }
  if (this.hasAttribute("data-task-key")) return rect(0, 0, 230, 40);
  return rect(0, 0, 5000, 1000);
};

await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { BoardView } = await import("./index.js");
const { TasksRefreshProvider } = await import("../../client/refresh.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const P2 = "01HZZZZZZZZZZZZZZZZZZZZZP2";

const project = (id: string, name: string, prefix: string) => ({
  id,
  name,
  prefix,
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
});

function task(projectId: string, prefix: string, number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `${projectId.slice(0, 24)}T${number}`,
    projectId,
    number,
    key: `${prefix}-${number}`,
    title: `${prefix} task ${number}`,
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
    ...patch,
  };
}

const tasks = [task(P1, "TSK", 1), task(P2, "SH", 2, { status: "in_progress" })];

function renderAllBoard(rpc: Record<string, (input: never) => unknown> = {}) {
  return renderSlot(
    {
      component: () => (
        <TasksRefreshProvider>
          <BoardView scope="all" />
        </TasksRefreshProvider>
      ),
    },
    {},
    {
      rpc: {
        listProjects: () => ({ projects: [project(P1, "Tasks Plugin", "TSK"), project(P2, "Shader Lab", "SH")] }),
        listLabels: () => ({ labels: [] }),
        listTasks: () => ({ tasks, nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        ...rpc,
      } as never,
    },
  );
}

const column = (container: HTMLElement, status: string) =>
  container.querySelector(`[data-board-column="${status}"]`) as HTMLElement;

describe("the board of a cross-project screen", () => {
  it("the All tasks board shows cards of two projects", async () => {
    const slot = renderAllBoard();
    await waitFor(() => slot.getByText("SH-2"));
    expect(within(column(slot.container, "todo")).getByText("TSK-1")).toBeDefined();
    expect(within(column(slot.container, "in_progress")).getByText("SH-2")).toBeDefined();
  });

  it("dropping a card into In Review on the All tasks board sets its status", async () => {
    const updateTask = vi.fn((input: { taskId: string; status?: string }) => ({ task: { ...tasks[0]!, status: input.status } }));
    const slot = renderAllBoard({ updateTask: updateTask as never });
    await waitFor(() => slot.getByText("TSK-1"));
    const columns = Array.from(slot.container.querySelectorAll("[data-board-column]"));
    const target = columns.findIndex((element) => element.getAttribute("data-board-column") === "in_review");
    expect(target).toBeGreaterThanOrEqual(0);
    const x = target * 300 + 100;
    const card = slot.container.querySelector('[data-task-key="TSK-1"]')!;
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: x / 2, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: x, clientY: 20 });
    fireEvent.pointerUp(window, { clientX: x, clientY: 20 });
    await waitFor(() => expect(updateTask).toHaveBeenCalled());
    expect(updateTask.mock.calls[0]![0]).toMatchObject({ taskId: tasks[0]!.id, status: "in_review" });
  });
});
