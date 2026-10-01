// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task, TaskThread } from "../../shared/contract.js";

// jsdom lacks matchMedia/ResizeObserver; the list shell touches both.
window.matchMedia ??= (query: string) => ({
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

// loadPluginApp installs the fake SDK runtime; nothing SDK-touching may be
// imported before it runs.
const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(number: number, labelIds: string[] = []): Task {
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
    labelIds,
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

function thread(
  taskId: string,
  liveStatus: TaskThread["liveStatus"],
  suffix: string,
): TaskThread {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZH${suffix}`,
    taskId,
    threadId: `thr_${suffix}`,
    presetName: "Sonnet · high",
    title: "Worker",
    liveStatus,
    archivedAt: null,
    attachedAt: "2026-07-15T00:00:00.000Z",
  };
}

// BBPL-334: the board draws its columns from listTasks and listLabels; the
// card chips (working agents, attachments) come from one taskCardMeta call
// that the columns do not wait for, and that follows thread changes.
function renderBoard(tasks: Task[], cards: () => Promise<unknown>) {
  const calls = { listTasks: 0, taskCardMeta: 0 };
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: `${PROJECT_ID}?view=board` },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listTasks: (input: { projectId?: string; activeOnly?: boolean; waitingOnly?: boolean }) => {
          // The sidebar's Active/Waiting sections ask listTasks too; only the
          // board's own request is counted.
          if (input.projectId === PROJECT_ID && !input.activeOnly && !input.waitingOnly) {
            calls.listTasks += 1;
          }
          return { tasks };
        },
        taskCardMeta: () => {
          calls.taskCardMeta += 1;
          return cards();
        },
      },
    },
  );
  return { slot, calls };
}

describe("board card chips", () => {
  it("columns show while the chips are still out, chips fill in after", async () => {
    const card = task(1);
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { slot } = renderBoard([card], () => pending);

    await slot.findByText("Task 1");
    expect(slot.queryByLabelText("2 attachments")).toBeNull();

    release({
      cards: [
        {
          taskId: card.id,
          attachmentCount: 2,
          taskThreads: [thread(card.id, "working", "W1")],
        },
      ],
    });
    await waitFor(() => expect(slot.getByLabelText("2 attachments")).toBeTruthy());
    expect(slot.getByText("Sonnet · high")).toBeTruthy();
  });

  it("a thread change asks for the chips again, not for the tasks", async () => {
    const card = task(1);
    const { slot, calls } = renderBoard([card], async () => ({
      cards: [{ taskId: card.id, attachmentCount: 0, taskThreads: [] }],
    }));
    await slot.findByText("Task 1");
    await waitFor(() => expect(calls.taskCardMeta).toBeGreaterThan(0));
    const before = { ...calls };

    await slot.emitRealtime("threads:changed", { taskId: card.id });

    await waitFor(() => expect(calls.taskCardMeta).toBeGreaterThan(before.taskCardMeta));
    expect(calls.listTasks).toBe(before.listTasks);
  });
});
