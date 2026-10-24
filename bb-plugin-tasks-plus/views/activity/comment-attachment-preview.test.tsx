// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../../app"));
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("# Trader's day", { status: 200 }))));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

const comment = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZC1",
  taskId: task.id,
  kind: "agent",
  authorName: "Claude",
  presetName: null,
  threadId: null,
  body: "Notes attached",
  notifiedCount: 0,
  createdAt: "2026-07-15T00:00:00.000Z",
  threadTitle: null,
  provider: null,
};

const notes = {
  id: "01JFILE00000000000000000C1",
  taskId: null,
  commentId: comment.id,
  fileName: "Trader's day.md",
  mime: "application/octet-stream",
  sizeBytes: 4096,
  isImage: false,
  createdAt: "2026-07-15T00:00:00.000Z",
};

describe("a markdown file attached to a comment", () => {
  it("opens to its rendered text, as it does among the task's own attachments", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_1", params: { taskKey: "TSK-4" } },
      {
        rpc: {
          getTaskByKey: () => ({ task }),
          listProjects: () => ({ projects: [] }),
          getTask: () => ({ task: null }),
          listTasks: () => ({ tasks: [] }),
          listLabels: () => ({ labels: [] }),
          listAttachments: (input: unknown) => ({ attachments: (input as { commentId?: string }).commentId === comment.id ? [notes] : [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listPresets: () => ({ presets: [] }),
          listComments: () => ({ comments: [comment] }),
          searchThreads: () => ({ threads: [] }),
        },
      },
    );

    fireEvent.click(await slot.findByText("Trader's day.md"));

    await waitFor(() => expect(slot.getByRole("heading", { name: "Trader's day" })).toBeTruthy());
  });
});
