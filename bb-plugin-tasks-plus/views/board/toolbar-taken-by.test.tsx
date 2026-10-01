// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_ID, boardRpc, boardTask, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const mark = (machine: string) => ({ machine, threadId: "thr_x", at: "2026-09-30T12:00:00.000Z" });
const tasks = [
  boardTask(1, { status: "in_progress", takenBy: mark("Mac mini") }),
  boardTask(2, { status: "in_progress", takenBy: mark("MacBook") }),
  boardTask(3),
];

const renderBoard = () => renderSlot(app.navPanels[0]!, { subPath: `${PROJECT_ID}?view=board` }, { rpc: boardRpc(tasks) });
const openMenu = (name: string) => fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });

describe("the Taken by filter", () => {
  it("offers the machines that took the tasks on screen, and narrows the board to the one picked", async () => {
    const slot = renderBoard();
    await waitFor(() => expect(slot.getByText("TSK-3")).toBeDefined());
    openMenu("Filter");
    await waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBeGreaterThan(0));
    const item = screen.queryByRole("menuitem", { name: /Taken by/ });
    expect(item, "Filter offers Taken by").not.toBeNull();
    fireEvent.click(item!);
    const offered = (await screen.findAllByRole("menuitemcheckbox")).map((item) => item.textContent?.trim());
    expect(offered).toEqual(expect.arrayContaining(["Mac mini", "MacBook"]));
    expect(offered).toHaveLength(2);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Mac mini/ }));
    await waitFor(() => expect(slot.queryByText("TSK-2")).toBeNull());
    expect(slot.getByText("TSK-1")).toBeDefined();
    expect(slot.queryByText("TSK-3")).toBeNull();
  });
});

describe("Taken by in the board's Display panel", () => {
  it("is listed with the other fields", async () => {
    const slot = renderBoard();
    await waitFor(() => expect(slot.getByText("TSK-3")).toBeDefined());
    fireEvent.click(slot.getByRole("button", { name: "Display" }));
    const panel = within(await screen.findByRole("complementary", { name: "Display" }));
    expect(panel.queryByText("Taken by")).not.toBeNull();
  });
});
