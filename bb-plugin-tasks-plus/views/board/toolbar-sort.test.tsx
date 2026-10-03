// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_ID, boardRpc, boardTask, prepareBoardDom } from "../../test-support/board-harness.js";
import { QUERY_FIELDS } from "../../shared/enums.js";
import { ROW_FIELD_LABELS } from "../common/row-field-preference.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const idOf = (number: number) => boardTask(number).id;

/** In To do: TSK-1 with nothing open under it, TSK-2 with one open child, TSK-3 with two open a level apart, TSK-6 the open child itself. */
const tasks = [
  boardTask(1, { priority: "low" }),
  boardTask(2, { priority: "high" }),
  boardTask(3),
  boardTask(4, { status: "done", parentTaskId: idOf(1) }),
  boardTask(5, { status: "canceled", parentTaskId: idOf(1) }),
  boardTask(6, { parentTaskId: idOf(2) }),
  boardTask(7, { status: "done", parentTaskId: idOf(2) }),
  boardTask(8, { status: "backlog", parentTaskId: idOf(3) }),
  boardTask(9, { status: "in_review", parentTaskId: idOf(8) }),
];

const renderBoard = () => renderSlot(app.navPanels[0]!, { subPath: `${PROJECT_ID}?view=board` }, { rpc: boardRpc(tasks) });
const openSort = () => fireEvent.keyDown(screen.getByRole("button", { name: "Sort" }), { key: "Enter" });
const pick = async (name: string) => {
  openSort();
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: new RegExp(name) }));
};
const todoKeys = () =>
  Array.from(document.querySelectorAll('[data-board-column="todo"] [data-task-key]')).map((card) => card.getAttribute("data-task-key"));

describe("the Sort menu", () => {
  it("offers every field Filter does, Open sub-tasks right after Sub-tasks, and picking a field again reverses the order", async () => {
    renderBoard();
    await waitFor(() => expect(todoKeys()).toContain("TSK-3"));
    openSort();
    const offered = (await screen.findAllByRole("menuitemcheckbox")).map((item) => item.textContent ?? "");
    const fields = QUERY_FIELDS.map((field) => ROW_FIELD_LABELS[field]);
    expect(offered).toEqual(fields.flatMap((label) => (label === "Sub-tasks" ? [label, "Open sub-tasks"] : [label])));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Title/ }));
    await waitFor(() => expect(todoKeys()).toEqual(["TSK-1", "TSK-2", "TSK-3", "TSK-6"]));
    await pick("Title");
    await waitFor(() => expect(todoKeys()).toEqual(["TSK-6", "TSK-3", "TSK-2", "TSK-1"]));
  });

  it("marks the sorted field with the way it sorts, and flips it on a second pick", async () => {
    renderBoard();
    await waitFor(() => expect(todoKeys()).toContain("TSK-3"));
    await pick("Priority");
    openSort();
    const sorted = await screen.findByRole("menuitemcheckbox", { name: /Priority/ });
    expect(within(sorted).queryByLabelText("Ascending")).not.toBeNull();
    fireEvent.click(sorted);
    openSort();
    const flipped = await screen.findByRole("menuitemcheckbox", { name: /Priority/ });
    expect(within(flipped).queryByLabelText("Descending")).not.toBeNull();
    expect(within(flipped).queryByLabelText("Ascending")).toBeNull();
  });

  it("sorts the board by open sub-tasks, most first", async () => {
    renderBoard();
    await waitFor(() => expect(todoKeys()).toContain("TSK-3"));
    await pick("Open sub-tasks");
    await pick("Open sub-tasks");
    await waitFor(() => expect(todoKeys().slice(0, 2)).toEqual(["TSK-3", "TSK-2"]));
    expect(todoKeys().indexOf("TSK-1")).toBeGreaterThan(1);
  });
});
