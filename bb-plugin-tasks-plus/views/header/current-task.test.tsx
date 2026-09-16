// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: PROJECT_ID,
  number: null,
  key: "branch-born",
  title: "Задача ветки",
  description: "",
  status: "in_progress",
  priority: "none",
  dueDate: null,
  parentTaskId: null,
  position: 100,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
  labelIds: [],
  type: null,
  estimate: null,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  checks: [],
  source: null,
};

/**
 * Кнопка текущей задачи принадлежит треду, поэтому спрашивает о задачах его
 * рабочего дерева: задача, рождённая в ветке, на доске ещё не видна, и без
 * треда в вызове шапка показывала бы «задачи нет» именно тем тредам, которые
 * задачу и ведут.
 */
describe("CurrentTaskHeaderAction", () => {
  it("спрашивает задачи треда, называя его", async () => {
    const seen: unknown[] = [];
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      { threadId: "thr_worktree", isCompactViewport: false },
      {
        rpc: {
          tasksForThread: (input: unknown) => {
            seen.push(input);
            return { tasks: [task] };
          },
        },
      },
    );

    await slot.findByText("branch-born");
    expect(seen[0]).toMatchObject({
      threadId: "thr_worktree",
      callerThreadId: "thr_worktree",
    });
  });

  it("молчит, когда тред не ведёт ни одной задачи", async () => {
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      { threadId: "thr_main", isCompactViewport: false },
      { rpc: { tasksForThread: () => ({ tasks: [] }) } },
    );

    await Promise.resolve();
    expect(slot.queryByText("branch-born")).toBeNull();
  });
});
