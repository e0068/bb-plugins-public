import type { Task } from "../shared/contract.js";

/**
 * What a board test needs before the app loads — jsdom lays nothing out and
 * lacks a few browser APIs the board reaches for — and a task and a project
 * shaped the way the RPC hands them over. Shared by the board tests the plan
 * adds; the older board tests keep their own copies.
 */
export function prepareBoardDom(): void {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;
  /** Column i spans x from 300·i to 300·i + 230; cards sit at the top. */
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const column = this.getAttribute("data-board-column");
    if (column !== null) {
      const columns = Array.from(document.querySelectorAll("[data-board-column]"));
      return rect(columns.indexOf(this) * 300, 0, 230, 800);
    }
    if (this.hasAttribute("data-task-key")) return rect(0, 0, 230, 40);
    return rect(0, 0, 5000, 1000);
  };
}

export const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

export const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

export function boardTask(number: number, patch: Record<string, unknown> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
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
    ...patch,
  } as Task;
}

/** The RPC answers every board screen asks for; a test overrides what it is about. */
export function boardRpc(tasks: Task[], extra: Record<string, (...args: never[]) => unknown> = {}) {
  return {
    listProjects: () => ({ projects: [project] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listLabels: () => ({ labels: [] }),
    listSavedViews: () => ({ savedViews: [] }),
    listTasks: () => ({ tasks }),
    taskCardMeta: () => ({ cards: [] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listComments: () => ({ comments: [] }),
    listAttachments: () => ({ attachments: [] }),
    ...extra,
  };
}
