// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";
import { withUpdate } from "./pending-update.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));
afterEach(cleanup);

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  number: 4,
  key: "TSK-4",
  title: "Ship task embeds",
  description: "",
  status: "in_progress",
  priority: "high",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 100,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
  type: null,
  estimate: null,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  source: null,
};

function openTask(shown: Record<string, unknown>, updateTask = vi.fn((input: unknown) => ({ ok: true, task: { ...shown, ...(input as Record<string, unknown>) } }))) {
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "thr_1", params: { taskKey: "TSK-4" } },
    {
      rpc: {
        getTaskByKey: () => ({ task: shown }),
        listProjects: () => ({ projects: [] }),
        getTask: () => ({ task: null }),
        listTasks: () => ({ tasks: [] }),
        listLabels: () => ({ labels: [] }),
        listAttachments: () => ({ attachments: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listPresets: () => ({ presets: [] }),
        listComments: () => ({ comments: [] }),
        searchThreads: () => ({ threads: [] }),
        updateTask,
      },
    },
  );
  return { slot, updateTask };
}

describe("the icon before a task's title", () => {
  it("shows the icon the task has, and a pick writes the new one", async () => {
    const { slot, updateTask } = openTask({ ...task, icon: "🚀" });

    const button = await slot.findByRole("button", { name: "Task icon" });
    expect(button.querySelector("text")?.textContent).toBe("🚀");
    fireEvent.click(button);
    fireEvent.change(await slot.findByLabelText("Search icons"), { target: { value: "fire" } });
    fireEvent.click(await slot.findByRole("button", { name: "🔥" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id, icon: "🔥" })));
  });

  it("takes the icon off with Remove", async () => {
    const { slot, updateTask } = openTask({ ...task, icon: "🚀" });

    fireEvent.click(await slot.findByRole("button", { name: "Task icon" }));
    fireEvent.click(await slot.findByRole("button", { name: "Remove icon" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id, icon: null })));
  });
});

describe("a task with a change on its way", () => {
  it("shows a picked icon at once, and none once it is taken off", () => {
    const shown = withUpdate({ ...task, icon: "🚀" } as never, { icon: "🔥" });
    expect(shown.icon).toBe("🔥");
    expect(withUpdate(shown, { icon: null }).icon).toBeUndefined();
  });
});
