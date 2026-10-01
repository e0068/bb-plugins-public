// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Project, Task } from "../../shared/contract.js";
import type { RowField } from "../common/row-field-preference.js";
import { boardTask, prepareBoardDom, project } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { TableCell } = await import("./cells.js");
type CellContext = import("./cells.js").CellContext;

afterEach(cleanup);

const context = (showEmpty: boolean): CellContext => ({
  project: project as Project,
  labelsById: new Map(),
  taskKeys: new Map(),
  activeThreads: 0,
  subtasks: { done: 0, total: 0 },
  showEmpty,
  onEdit: () => {},
});

function text(task: Task, showEmpty = false): string {
  const slot = renderSlot({ component: () => <TableCell column={"takenBy" as RowField} task={task} context={context(showEmpty)} /> }, {}, {});
  const value = slot.container.textContent?.trim() ?? "";
  cleanup();
  return value;
}

describe("the Taken by column", () => {
  it("names the machine that took the task", () => {
    const taken = boardTask(1, { status: "in_progress", takenBy: { machine: "Mac mini", threadId: null, at: "2026-09-30T12:00:00.000Z" } });
    expect(text(taken)).toBe("Mac mini");
  });

  it("is blank for a task nobody took", () => {
    expect(text(boardTask(2, { takenBy: null }))).toBe("");
  });
});
