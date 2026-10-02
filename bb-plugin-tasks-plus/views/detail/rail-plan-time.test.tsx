// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

// jsdom lacks matchMedia; the vendored Dialog's responsive root needs it.
if (!window.matchMedia) {
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
}

// loadPluginApp installs the fake SDK runtime; nothing SDK-touching may be
// imported before it runs.
const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const BB_PROJECT_ID = "proj_bb0000000000000000000001";

function projectRow(linkedBbProjectId: string | null) {
  return {
    id: PROJECT_ID,
    name: "Tasks Plugin",
    prefix: "TSK",
    nextTaskNumber: 6,
    color: "blue",
    folderId: null,
    linkedBbProjectId,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT5",
  projectId: PROJECT_ID,
  number: 5,
  key: "TSK-5",
  title: "Ship the rail",
  description: "",
  status: "todo",
  priority: "none",
  type: null,
  estimate: null,
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 1,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  source: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
};

function detailRpc(
  linkedBbProjectId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    listProjects: () => ({ projects: [projectRow(linkedBbProjectId)] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listTasks: (input: { parentTaskId?: string } | null) =>
      input?.parentTaskId ? { tasks: [] } : { tasks: [task] },
    getTaskByKey: () => ({ task }),
    listLabels: () => ({ labels: [] }),
    listAttachments: () => ({ attachments: [] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listTaskPullRequests: () => ({
      pullRequests: [],
      unavailableThreadIds: [],
    }),
    listComments: () => ({ comments: [] }),
    listBbProjects: () => ({ bbProjects: [] }),
    ...overrides,
  };
}

describe("plan date with a time", () => {
  function dateRpc(dueDate: string | null, updateCalls: Array<Record<string, unknown>>) {
    const shown = { ...task, dueDate };
    return detailRpc(null, {
      getTaskByKey: () => ({ task: shown }),
      listTasks: (input: { parentTaskId?: string } | null) =>
        input?.parentTaskId ? { tasks: [] } : { tasks: [shown] },
      updateTask: (input: Record<string, unknown>) => {
        updateCalls.push(input);
        return { ok: true, task: { ...shown, ...input } };
      },
    });
  }

  it("adds a time to the due day", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: dateRpc("2026-10-05", updateCalls) });

    fireEvent.click((await slot.findAllByRole("button", { name: /Oct 5/ }))[0]!);
    fireEvent.change(await slot.findByLabelText("Due time"), { target: { value: "15:30" } });

    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ dueDate: "2026-10-05T15:30" });
  });

  it("drops the time and keeps the day when the time is cleared", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: dateRpc("2026-10-05T15:30", updateCalls) });

    fireEvent.click((await slot.findAllByRole("button", { name: /Oct 5, 15:30/ }))[0]!);
    fireEvent.change(await slot.findByLabelText("Due time"), { target: { value: "" } });

    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ dueDate: "2026-10-05" });
  });

  it("keeps the time when another day is picked", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: dateRpc("2026-10-05T15:30", updateCalls) });

    fireEvent.click((await slot.findAllByRole("button", { name: /Oct 5, 15:30/ }))[0]!);
    fireEvent.change(await slot.findByLabelText("Due date"), { target: { value: "2026-10-07" } });

    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ dueDate: "2026-10-07T15:30" });
  });
});
