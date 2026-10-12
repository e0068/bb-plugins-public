// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

describe("Tasks+ without a single board", () => {
  it("sends to Manage to connect a project, with no New project to press", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listProjects: () => ({ projects: [] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          getTaskByKey: () => ({ task: null }),
        },
      },
    );
    await slot.findByText("No projects yet");
    expect(slot.queryByRole("button", { name: /new project/i })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Open Manage" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "tasks", options: { subPath: "manage" } });
  });
});
