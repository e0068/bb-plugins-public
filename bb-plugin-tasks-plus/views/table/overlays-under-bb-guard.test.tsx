// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_ID, boardRpc, boardTask, prepareBoardDom } from "../../test-support/board-harness.js";
import { installBbDomGuard } from "../../test-support/bb-dom-guard.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));

let removeGuard = () => {};
beforeEach(() => window.localStorage.clear());
// Unmount under the guard, as bb keeps it for the whole session; take it off after.
afterEach(() => {
  cleanup();
  removeGuard();
});

const tasks = [boardTask(1), boardTask(2, { status: "done" })];

/** The project's table, laid out, then bb's guard switched on — the moment a menu gets opened. */
async function renderGuardedTable() {
  const slot = renderSlot(app.navPanels[0]!, { subPath: PROJECT_ID }, { rpc: boardRpc(tasks) });
  await waitFor(() => expect(document.querySelector('[role="row"][data-task-key="TSK-1"]')).not.toBeNull());
  removeGuard = installBbDomGuard();
  return slot;
}

const press = (element: Element) => fireEvent.pointerDown(element, { button: 0, ctrlKey: false, pointerType: "mouse" });

describe("the panel's overlays under bb's DOM guard", () => {
  it("a column's menu opens from its header", async () => {
    const slot = await renderGuardedTable();
    const header = slot.getByRole("columnheader", { name: /Title/ });
    fireEvent.click(within(header).getByRole("button", { name: "Title" }));
    await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBeGreaterThan(0));
  });

  it("the status menu of an opened task's rail opens", async () => {
    const rpc = boardRpc(tasks, {
      getTaskByKey: () => ({ task: tasks[0] }),
      listTaskPullRequests: () => ({ pullRequests: [], unavailableThreadIds: [] }),
      listComments: () => ({ comments: [] }),
      listBbProjects: () => ({ bbProjects: [] }),
    });
    const slot = renderSlot(app.navPanels[0]!, { subPath: "task/TSK-1" }, { rpc });
    const [status] = await slot.findAllByRole("button", { name: /^Todo$/ });
    removeGuard = installBbDomGuard();
    press(status!);
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /Done/ })).not.toBeNull());
  });

  it("the New task dialog opens", async () => {
    const slot = await renderGuardedTable();
    fireEvent.click(slot.getAllByRole("button", { name: /New task/ })[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
  });
});
