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
  parentTaskId: null,
  position: 1,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  checks: [],
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

describe("dispatch target rail control", () => {
  it("links a discovered bb project", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      {
        rpc: detailRpc(null, {
          listBbProjects: () => ({
            bbProjects: [{ id: BB_PROJECT_ID, name: "bb monorepo" }],
          }),
          updateProject: (input: Record<string, unknown>) => {
            updateCalls.push(input);
            return {
              project: {
                ...projectRow(input.linkedBbProjectId as string | null),
              },
            };
          },
        }),
      },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Edit dispatch target" }),
    );
    fireEvent.click(await slot.findByLabelText("Linked bb project"));
    fireEvent.click(await slot.findByRole("option", { name: "bb monorepo" }));
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      projectId: PROJECT_ID,
      linkedBbProjectId: BB_PROJECT_ID,
    });
  });

  it("shows the linked bb project's name and unlinks it", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      {
        rpc: detailRpc(BB_PROJECT_ID, {
          listBbProjects: () => ({
            bbProjects: [{ id: BB_PROJECT_ID, name: "bb monorepo" }],
          }),
          updateProject: (input: Record<string, unknown>) => {
            updateCalls.push(input);
            return {
              project: {
                ...projectRow(input.linkedBbProjectId as string | null),
              },
            };
          },
        }),
      },
    );
    const trigger = await slot.findByRole("button", {
      name: "Edit dispatch target",
    });
    await slot.findByText("bb monorepo");

    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      projectId: PROJECT_ID,
      linkedBbProjectId: null,
    });
  });
});

describe("time and budget fields", () => {
  it("shows planned and actual time and three money fields instead of tokens", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      { rpc: detailRpc(null) },
    );
    for (const label of ["Planned Time", "Actual Time", "Budget", "Limit", "Cost"]) {
      expect(await slot.findByLabelText(label)).toBeDefined();
    }
    expect(slot.queryByLabelText("Tokens - Plan")).toBeNull();
    expect(slot.queryByLabelText("Tokens - Fact")).toBeNull();
  });

  it("commits minutes as a whole number, dollars to the cent, and a blank as null", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      {
        rpc: detailRpc(null, {
          getTaskByKey: () => ({ task: { ...task, budgetLimit: 60 } }),
          listTasks: (input: { parentTaskId?: string } | null) =>
            input?.parentTaskId ? { tasks: [] } : { tasks: [{ ...task, budgetLimit: 60 }] },
          updateTask: (input: Record<string, unknown>) => {
            updateCalls.push(input);
            return { ok: true, task: { ...task, ...input } };
          },
        }),
      },
    );

    const planned = await slot.findByLabelText("Planned Time");
    fireEvent.change(planned, { target: { value: "90" } });
    fireEvent.blur(planned);
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ plannedMinutes: 90 });

    const cost = slot.getByLabelText("Cost");
    fireEvent.change(cost, { target: { value: "12.345" } });
    fireEvent.blur(cost);
    await waitFor(() => expect(updateCalls).toHaveLength(2));
    expect(updateCalls[1]).toMatchObject({ cost: 12.35 });

    const limit = slot.getByLabelText("Limit");
    fireEvent.change(limit, { target: { value: "" } });
    fireEvent.blur(limit);
    await waitFor(() => expect(updateCalls).toHaveLength(3));
    expect(updateCalls[2]).toMatchObject({ budgetLimit: null });
  });
});

// The pickers are cmdk lists, which measure themselves.
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("assignee and epic", () => {
  function placementRpc(current: Record<string, unknown>, updateCalls: Array<Record<string, unknown>>) {
    const shown = { ...task, ...current };
    return detailRpc(null, {
      getTaskByKey: () => ({ task: shown }),
      listTasks: (input: { parentTaskId?: string } | null) =>
        input?.parentTaskId ? { tasks: [] } : { tasks: [shown] },
      listPlacements: () => ({
        assignees: ["Claude", "Sergey"],
        epics: [
          { assignee: "Claude", name: "Tasks+" },
          { assignee: "Sergey", name: "Flow" },
        ],
      }),
      updateTask: (input: Record<string, unknown>) => {
        updateCalls.push(input);
        return { ok: true, task: { ...shown, ...input } };
      },
    });
  }

  it("picks an existing assignee from the folders in use", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: placementRpc({}, updateCalls) });

    fireEvent.click((await slot.findAllByRole("button", { name: "Edit assignee" }))[0]!);
    fireEvent.click(await slot.findByRole("option", { name: "Sergey" }));

    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ assignee: "Sergey" });
  });

  it("creates a new assignee from the typed name", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: placementRpc({}, updateCalls) });

    fireEvent.click((await slot.findAllByRole("button", { name: "Edit assignee" }))[0]!);
    fireEvent.change(await slot.findByPlaceholderText("Assignee…"), { target: { value: "Codex" } });
    fireEvent.click(await slot.findByRole("option", { name: "Create “Codex”" }));

    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ assignee: "Codex" });
  });

  it("offers only the current assignee's epics and clears the epic", async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-5" },
      { rpc: placementRpc({ assignee: "Claude", epic: "Tasks+" }, updateCalls) },
    );

    fireEvent.click((await slot.findAllByRole("button", { name: "Edit epic" }))[0]!);
    expect(await slot.findByRole("option", { name: "Tasks+" })).toBeDefined();
    expect(slot.queryByRole("option", { name: "Flow" })).toBeNull();
    fireEvent.click(slot.getByRole("option", { name: "No epic" }));

    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ epic: null });
  });

  it("keeps the epic picker disabled until the task has an assignee", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-5" }, { rpc: placementRpc({}, []) });

    const [epic] = await slot.findAllByRole("button", { name: "Edit epic" });
    expect((epic as HTMLButtonElement).disabled).toBe(true);
  });
});
