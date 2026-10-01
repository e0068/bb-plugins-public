// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";

let compact = false;
window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY ? compact : false,
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

const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => window.localStorage.clear());
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

function task(number: number, status: Task["status"]): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status,
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

const tasks = [task(1, "todo"), task(2, "in_progress")];

function renderBoard() {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: `${PROJECT_ID}?view=board` },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listTasks: () => ({ tasks }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
      },
    },
  );
}

describe("board on a narrow panel", () => {
  it("shows one status column and a switcher", async () => {
    compact = true;
    const slot = renderBoard();
    await waitFor(() => slot.getByRole("group", { name: "Board column" }));
    expect(slot.getByText("TSK-1")).toBeTruthy();
    expect(slot.queryByText("TSK-2")).toBeNull();
  });

  it("switches the shown column", async () => {
    compact = true;
    const slot = renderBoard();
    await waitFor(() => slot.getByRole("group", { name: "Board column" }));
    const group = slot.getByRole("group", { name: "Board column" });
    fireEvent.click(
      Array.from(group.querySelectorAll("button")).find(
        (button) => button.textContent === "In Progress",
      )!,
    );
    await waitFor(() => slot.getByText("TSK-2"));
    expect(slot.queryByText("TSK-1")).toBeNull();
  });

  it("shows every column and no switcher on a wide panel", async () => {
    compact = false;
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    expect(slot.getByText("TSK-2")).toBeTruthy();
    expect(slot.queryByRole("group", { name: "Board column" })).toBeNull();
  });

  it("stays a board on a narrow panel instead of falling back to the list", async () => {
    compact = true;
    const slot = renderBoard();
    await waitFor(() => slot.getByRole("group", { name: "Board column" }));
  });
});
