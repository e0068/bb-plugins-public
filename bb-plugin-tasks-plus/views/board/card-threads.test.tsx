// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RowField } from "../common/row-field-preference.js";
import { PROJECT_ID, boardRpc, boardTask, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { toggleFieldVisible } = await import("../common/row-field-preference.js");
const { boardKey } = await import("./board-preference.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const tasks = [boardTask(1, { status: "in_progress" }), boardTask(2)];
const thread = (n: number, title: string) => ({
  id: `rec_${n}`,
  taskId: tasks[0]!.id,
  threadId: `thr_${n}`,
  presetName: "Code",
  title,
  liveStatus: "completed",
  archivedAt: null,
  attachedAt: "2026-10-01T10:00:00.000Z",
});
const cards = () => ({ cards: [{ taskId: tasks[0]!.id, attachmentCount: 0, taskThreads: [thread(1, "Fix chart"), thread(2, "Review")] }] });

const renderBoard = () => renderSlot(app.navPanels[0]!, { subPath: `${PROJECT_ID}?view=board` }, { rpc: boardRpc(tasks, { taskCardMeta: cards }) });
const card = (key: string) => document.querySelector(`[data-task-key="${key}"]`) as HTMLElement;

describe("the Assignee field on a card — the threads attached to the task", () => {
  it("shows every thread once Assignee is on in Display, and opens the clicked one", async () => {
    toggleFieldVisible(boardKey(PROJECT_ID, null), "threads" as RowField);
    // The preference lives in module memory past localStorage.clear(): turn it back off for the next test.
    onTestFinished(() => toggleFieldVisible(boardKey(PROJECT_ID, null), "threads" as RowField));
    const slot = renderBoard();
    await waitFor(() => expect(within(card("TSK-1")).queryAllByRole("button", { name: /Fix chart|Review/ })).toHaveLength(2));
    expect(card("TSK-2").textContent).not.toContain("Review");
    fireEvent.click(within(card("TSK-1")).getByRole("button", { name: "Review" }));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_2" }]);
  });

  it("stays off the card while Assignee is off", async () => {
    const slot = renderBoard();
    await waitFor(() => expect(slot.getByText("TSK-2")).toBeDefined());
    expect(card("TSK-1").textContent).not.toContain("Fix chart");
  });
});
