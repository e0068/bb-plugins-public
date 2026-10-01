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
    listTasks: (input: unknown) =>
      (input as { parentTaskId?: string } | null)?.parentTaskId ? { tasks: [] } : { tasks: [task] },
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

const withFlow = (flow: { id: string; name: string } | null) => ({ ...task, flow });

describe("поле Flow в карточке задачи", () => {
  it("задача с flow — название ссылкой на страницу flow в плагине Flow", async () => {
    const flowed = withFlow({ id: "flow-code", name: "Code" });
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: detailRpc(null, { getTaskByKey: () => ({ task: flowed }), listTasks: () => ({ tasks: [flowed] }) }) });
    const links = await slot.findAllByRole("link", { name: "Code" });
    for (const link of links) expect(link.getAttribute("href")).toBe("/plugins/flow/flows/flow-code");
  });

  it("задача без flow — ни ссылки, ни поля Checks", async () => {
    const plain = withFlow(null);
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: detailRpc(null, { getTaskByKey: () => ({ task: plain }), listTasks: () => ({ tasks: [plain] }) }) });
    await slot.findAllByRole("button", { name: "Edit dispatch target" });
    expect(slot.queryAllByRole("link", { name: "Code" })).toHaveLength(0);
    expect(slot.queryAllByText("Flow", { exact: true })).toHaveLength(0);
    expect(slot.queryAllByText("Checks", { exact: true })).toHaveLength(0);
    expect(slot.queryAllByRole("button", { name: "Edit checks" })).toHaveLength(0);
  });
});
