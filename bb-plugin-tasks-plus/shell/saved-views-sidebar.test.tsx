// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

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

const app = await loadPluginApp(() => import("../app"));
const { TasksNavigationPanel } = await import("./navigation-panel.js");

const navigation = { ...app.navPanels[0]!, component: TasksNavigationPanel };

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const VIEW_ID = "01J0000000000000000000000A";

const view = {
  id: VIEW_ID,
  version: 2 as const,
  name: "My week",
  projectId: null,
  listScope: null,
  filters: {
    statuses: [],
    priorities: [],
    types: [],
    estimates: [],
    labelNames: [],
    assignees: [],
    parents: [],
  },
  sort: "manual" as const,
  fields: { fields: [], showEmpty: false, showDescription: false },
  createdAt: "2026-09-01T00:00:00.000Z",
};

function renderNavigation(savedViews: unknown[], overrides: Record<string, unknown> = {}) {
  return renderSlot(
    navigation,
    { subPath: "all" },
    {
      rpc: {
        listProjects: () => ({ projects: [] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listTasks: () => ({ tasks: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews }),
        ...overrides,
      },
    },
  );
}

describe("saved views in the left column", () => {
  it("lists a saved view under Analytics", async () => {
    const slot = renderNavigation([view]);
    await waitFor(() => slot.getByText("My week"));
    expect(slot.getByText("Views")).toBeTruthy();
  });

  it("shows no Views section when nothing is saved", async () => {
    const slot = renderNavigation([]);
    await waitFor(() => slot.getByText("Analytics"));
    expect(slot.queryByText("Views")).toBeNull();
  });

  it("opens the view's list on click", async () => {
    const slot = renderNavigation([view]);
    fireEvent.click(await slot.findByText("My week"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: `view/${VIEW_ID}` },
    });
  });

  it("deletes a view only after the confirmation", async () => {
    const deleteSavedView = vi.fn(() => ({ deleted: true }));
    const slot = renderNavigation([view], { deleteSavedView });
    await waitFor(() => slot.getByText("My week"));
    fireEvent.click(slot.getByRole("button", { name: 'Delete "My week"' }));
    expect(deleteSavedView).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: 'Confirm deleting "My week"' }));
    await waitFor(() => expect(deleteSavedView).toHaveBeenCalledTimes(1));
  });

  it("renames a view from the left column", async () => {
    const updateSavedView = vi.fn(() => ({ savedView: { ...view, name: "Mine" } }));
    const slot = renderNavigation([view], { updateSavedView });
    await waitFor(() => slot.getByText("My week"));
    fireEvent.click(slot.getByRole("button", { name: 'Rename "My week"' }));
    const input = slot.getByLabelText("View name");
    fireEvent.change(input, { target: { value: "Mine" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(updateSavedView).toHaveBeenCalledTimes(1));
  });
});

describe("the surface a saved view opens", () => {
  const project = {
    id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    name: "Tasks Plugin",
    prefix: "TSK",
    nextTaskNumber: 1,
    color: "blue",
    folderId: null,
    linkedBbProjectId: null,
    createdAt: "2026-07-15T00:00:00.000Z",
  };

  function renderPanel(savedViews: unknown[], subPath: string) {
    return renderSlot(
      app.navPanels[0]!,
      { subPath },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          listLabels: () => ({ labels: [] }),
          listSavedViews: () => ({ savedViews }),
        },
      },
    );
  }

  it("offers a way back when the view is gone", async () => {
    const slot = renderPanel([], `view/${VIEW_ID}`);
    await waitFor(() => slot.getByText("This view is gone"));
    expect(slot.getByRole("button", { name: "All tasks" })).toBeTruthy();
  });
});
