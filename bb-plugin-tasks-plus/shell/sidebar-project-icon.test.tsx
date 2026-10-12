// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ICON_CATALOG } from "@bb-plugins/icon-catalog";
import { prepareBoardDom } from "../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../app"));
const { TasksNavigationPanel } = await import("./navigation-panel.js");

afterEach(cleanup);

const ROCKET_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PLAIN_ID = "01HZZZZZZZZZZZZZZZZZZZZZP2";
const board = (id: string, name: string, patch: Record<string, unknown> = {}) => ({
  id,
  name,
  prefix: name.slice(0, 3).toUpperCase(),
  nextTaskNumber: 1,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  ...patch,
});

function drawingOf(name: string): string {
  const { container, unmount } = render(<HugeiconsIcon icon={ICON_CATALOG.get(name)!} />);
  const markup = container.querySelector("svg")!.innerHTML;
  unmount();
  return markup;
}

function renderPanel() {
  return renderSlot(
    { ...app.navPanels[0]!, component: TasksNavigationPanel },
    { subPath: "all" },
    {
      rpc: {
        listProjects: () => ({ projects: [board(ROCKET_ID, "Rocketry", { icon: "Rocket" }), board(PLAIN_ID, "Plain")] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listTasks: () => ({ tasks: [] }),
        getTaskByKey: () => ({ task: null }),
      },
    },
  );
}

describe("projects on the Tasks+ sidebar", () => {
  it("wear the icon their project chose, and Folder01 when it chose none", async () => {
    const rocket = drawingOf("Rocket");
    const folder = drawingOf("Folder01");
    const slot = renderPanel();
    const rocketry = await slot.findByTitle("Rocketry");
    expect(rocketry.querySelector("svg")?.innerHTML).toBe(rocket);
    expect(rocketry.querySelector("[style*='steelblue']")).not.toBeNull();
    expect(slot.getByTitle("Plain").querySelector("svg")?.innerHTML).toBe(folder);
  });

  it("offer no New project row", async () => {
    const slot = renderPanel();
    await slot.findByTitle("Rocketry");
    expect(slot.queryByRole("button", { name: /new project/i })).toBeNull();
    expect(slot.queryByText("New project")).toBeNull();
  });
});
