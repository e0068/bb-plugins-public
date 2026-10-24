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

const record = (number: number, title: string, description: string) => ({
  id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
  projectId: PROJECT_ID,
  number,
  key: `TSK-${number}`,
  title,
  description,
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
});

const records = [
  record(5, "Quote", "Текущая цена [инструмента](TSK-6): ask и bid."),
  record(6, "Instrument", "Что торгуется."),
];

const rpc = {
  listProjects: () => ({
    projects: [
      {
        id: PROJECT_ID,
        name: "Vocabulary",
        prefix: "TSK",
        nextTaskNumber: 7,
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
  getTaskByKey: (input: unknown) => ({ task: records.find((task) => task.key === (input as { taskKey: string }).taskKey) ?? null }),
  listTasks: (input: unknown) => ((input as { parentTaskId?: string } | null)?.parentTaskId ? { tasks: [] } : { tasks: records }),
  listLabels: () => ({ labels: [] }),
  listAttachments: () => ({ attachments: [] }),
  listTaskThreads: () => ({ taskThreads: [] }),
  listTaskPullRequests: () => ({ pullRequests: [], unavailableThreadIds: [] }),
  listComments: () => ({ comments: [] }),
  listBbProjects: () => ({ bbProjects: [] }),
  searchThreads: () => ({ threads: [] }),
};

const composer = (container: HTMLElement) =>
  container.querySelector('[data-placeholder^="Leave a comment"]')?.closest(".tiptap") ?? null;

describe("ссылка на другую запись в карточке (BBPL-918)", () => {
  it("клик по ссылке на ключ открывает ту запись, а черновик комментария к ней не переезжает", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc });

    const draft = await waitFor(() => {
      const found = composer(slot.container);
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.paste(draft, {
      clipboardData: { files: [new File(["png"], "draft.png", { type: "image/png" })], types: [], getData: () => "" },
    });
    await slot.findByText("draft.png");

    fireEvent.click(await slot.findByText("инструмента"));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "tasks", options: { subPath: "task/TSK-6" } });

    // The host answers the navigation by handing the panel its new route.
    const Panel = app.navPanels[0]!.component;
    slot.rerender(<Panel subPath="task/TSK-6" />);
    await slot.findByText("Что торгуется.");
    expect(slot.queryByText("draft.png")).toBeNull();
  });
});
