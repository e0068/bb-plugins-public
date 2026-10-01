// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
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

const takenBy = { machine: "Mac mini", threadId: "thr_x", at: "2026-09-30T12:00:00.000Z" };
const tasks = [boardTask(1, { status: "in_progress", takenBy }), boardTask(2)];

const renderBoard = () => renderSlot(app.navPanels[0]!, { subPath: `${PROJECT_ID}?view=board` }, { rpc: boardRpc(tasks) });
const card = (key: string) => document.querySelector(`[data-task-key="${key}"]`) as HTMLElement;

describe("the Taken by chip on a card", () => {
  it("shows the machine on a taken task once Taken by is on in Display, with the thread in its tooltip", async () => {
    toggleFieldVisible(boardKey(PROJECT_ID, null), "takenBy" as RowField);
    // The preference lives in module memory past localStorage.clear(): turn it back off for the next test.
    onTestFinished(() => toggleFieldVisible(boardKey(PROJECT_ID, null), "takenBy" as RowField));
    const slot = renderBoard();
    await waitFor(() => expect(slot.getByText("TSK-2")).toBeDefined());
    await waitFor(() => expect(card("TSK-1").textContent).toContain("Mac mini"));
    const chip = card("TSK-1").querySelector('[title^="Taken on Mac mini"]');
    expect(chip?.getAttribute("title")).toContain("thr_x");
    expect(card("TSK-2").textContent).not.toContain("Taken");
  });

  it("stays off the card while Taken by is off", async () => {
    const slot = renderBoard();
    await waitFor(() => expect(slot.getByText("TSK-2")).toBeDefined());
    expect(card("TSK-1").textContent).not.toContain("Mac mini");
  });
});
