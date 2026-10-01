// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_ID, boardRpc, boardTask, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const takenBy = { machine: "MacBook", threadId: "thr_x", at: new Date().toISOString() };
const tasks = [boardTask(1, { status: "todo" })];

function renderBoard(extra: Record<string, (...args: never[]) => unknown>) {
  return renderSlot(app.navPanels[0]!, { subPath: `${PROJECT_ID}?view=board` }, { rpc: boardRpc(tasks, extra) });
}

/** Drags TSK-1 from Todo (x 300–530) into In Progress (x 600–830). */
function dropIntoInProgress(container: HTMLElement) {
  const card = container.querySelector('[data-task-key="TSK-1"]')!;
  fireEvent.pointerDown(card, { button: 0, clientX: 310, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 400, clientY: 100 });
  fireEvent.pointerMove(window, { clientX: 620, clientY: 100 });
  fireEvent.pointerUp(window, { clientX: 620, clientY: 100 });
}

describe("dropping a card another machine already took", () => {
  it("opens the refusal dialog, reloads the board under it, and opens the holder's thread", async () => {
    const boardMove = vi.fn(() => ({ ok: false, error: { code: "task_already_taken", message: "TSK-1 is already taken on MacBook", takenBy } }));
    const slot = renderBoard({ boardMove });
    await waitFor(() => expect(slot.queryByText("TSK-1")).not.toBeNull());
    const readsBefore = slot.inspection.rpcCalls.filter((call) => call.method === "listTasks").length;
    dropIntoInProgress(slot.container);
    await waitFor(() => expect(boardMove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("TSK-1 is already taken")).not.toBeNull());
    expect(screen.getByRole("dialog").textContent).toContain("MacBook took it");
    await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "listTasks").length).toBeGreaterThan(readsBefore));
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_x" });
  });

  it("any other failure still just reloads the board, with no dialog", async () => {
    const boardMove = vi.fn(() => ({ ok: false, error: { code: "task_parent_invalid", message: "nope" } }));
    const slot = renderBoard({ boardMove });
    await waitFor(() => expect(slot.queryByText("TSK-1")).not.toBeNull());
    dropIntoInProgress(slot.container);
    await waitFor(() => expect(boardMove).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a database board without a connection", () => {
  it("shows the paused banner above its columns", async () => {
    const offline = {
      projectId: PROJECT_ID,
      projectName: "Tasks Plugin",
      projectPrefix: "TSK",
      taskCount: 1,
      tasksFolder: null,
      linkedBbProjectId: null,
      linkedBbProjectName: null,
      repoPath: null,
      source: { kind: "database", url: "libsql://board-me.turso.io", state: "offline", lastSyncAt: "2026-09-30T12:00:00.000Z" },
    };
    const slot = renderBoard({ listSyncedFolders: () => ({ folders: [offline] }), retryDatabase: () => ({ ok: true }) });
    await waitFor(() => expect(slot.queryByText("TSK-1")).not.toBeNull());
    await waitFor(() => expect(slot.queryByText(/Taking and editing is paused/)).not.toBeNull());
  });
});
