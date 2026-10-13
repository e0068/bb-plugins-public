// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { DetailView } = await import("./index.js");
const { TasksRefreshProvider } = await import("../../client/refresh.js");

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const URL = "libsql://team-me.turso.io";
const DOCS_ID = "01HZZZZZZZZZZZZZZZZZZZZZT2";
const STAGE = { name: "stage", type: "select", options: ["Idea", "Done"], optionIcons: { Done: "✅" } };

const docs = {
  id: DOCS_ID,
  name: "Docs",
  prefix: "DOC",
  nextTaskNumber: 2,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  database: { url: URL, table: "docs0001", fields: [STAGE] },
  createdAt: "2026-07-15T00:00:00.000Z",
};

const record = {
  id: `${DOCS_ID}:onboarding`,
  projectId: DOCS_ID,
  number: 1,
  key: "DOC-1",
  title: "Onboarding",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 100,
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
  properties: { stage: "Done" },
};

function renderRecord() {
  window.localStorage.setItem("bb-tasks:record-viewer", "card");
  return renderSlot(
    { ...app.navPanels[0]!, component: () => (
        <TasksRefreshProvider>
          <DetailView taskKey={record.key} />
        </TasksRefreshProvider>
      ) },
    { subPath: "all" },
    {
      rpc: {
        getTaskByKey: () => ({ task: record }),
        listProjects: () => ({ projects: [docs] }),
        getTask: () => ({ task: null }),
        listTasks: () => ({ tasks: [] }),
        listLabels: () => ({ labels: [] }),
        listAttachments: () => ({ attachments: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listPresets: () => ({ presets: [] }),
        listComments: () => ({ comments: [] }),
        searchThreads: () => ({ threads: [] }),
        updateTask: () => ({ ok: true, task: record }),
        setFieldIcon: () => ({ ok: true }),
      },
    },
  );
}

describe("an option's icon", () => {
  it("stands beside the value the record holds", async () => {
    const slot = renderRecord();
    const value = await slot.findByRole("button", { name: "stage" });
    expect(value.textContent).toContain("Done");
    expect(value.querySelector("text")?.textContent).toBe("✅");
  });

  it("is picked beside the option in the field's menu", async () => {
    const slot = renderRecord();
    fireEvent.click(await slot.findByRole("button", { name: "stage" }));
    fireEvent.click(await slot.findByRole("button", { name: "Icon of option Idea" }));
    fireEvent.click(await slot.findByRole("button", { name: "Emoji" }));
    fireEvent.change(await slot.findByLabelText("Search icons"), { target: { value: "idea" } });
    fireEvent.click(await slot.findByRole("button", { name: "💡" }));

    await vi.waitFor(() =>
      expect(slot.rpcCalls.filter((call) => call.method === "setFieldIcon").map((call) => call.input)).toEqual([
        { boardId: DOCS_ID, field: "stage", option: "Idea", icon: "💡" },
      ]),
    );
  });
});
