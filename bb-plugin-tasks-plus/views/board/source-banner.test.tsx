// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { planned } from "../../test-support/planned.js";
import { PROJECT_ID, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const bannerPath = "./source-banner.js";
const { SourceBanner } = await planned<typeof import("./source-banner.js")>(() => import(/* @vite-ignore */ bannerPath));

afterEach(cleanup);

const URL_ = "libsql://board-me.turso.io";
function databaseRow(state: "live" | "reconnecting" | "offline") {
  return {
    projectId: PROJECT_ID,
    projectName: "Tasks Plugin",
    projectPrefix: "TSK",
    taskCount: 3,
    tasksFolder: null,
    linkedBbProjectId: null,
    linkedBbProjectName: null,
    repoPath: null,
    source: { kind: "database", url: URL_, state, lastSyncAt: "2026-09-30T12:00:00.000Z" },
  };
}
const folderRow = {
  projectId: PROJECT_ID,
  projectName: "Tasks Plugin",
  projectPrefix: "TSK",
  taskCount: 3,
  tasksFolder: "docs/tasks",
  linkedBbProjectId: "proj_x",
  linkedBbProjectName: "Repo",
  repoPath: "/repo",
  source: { kind: "folder" },
};

function renderBanner(folders: unknown[], retryDatabase = vi.fn(() => ({ ok: true }))) {
  const slot = renderSlot(
    { component: () => <SourceBanner projectIds={[PROJECT_ID]} /> },
    {},
    { rpc: { listSyncedFolders: () => ({ folders }), retryDatabase } },
  );
  return { slot, retryDatabase };
}

describe("the banner of a board that lost its database", () => {
  it("says taking and editing is paused, names the address and the last sync, and retries on Retry", async () => {
    const { slot, retryDatabase } = renderBanner([databaseRow("offline")]);
    await waitFor(() => expect(slot.queryByText(/Taking and editing is paused/)).not.toBeNull());
    expect(slot.container.textContent).toContain("board-me.turso.io");
    expect(slot.container.textContent).toMatch(/last sync/i);
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryDatabase).toHaveBeenCalledWith(expect.objectContaining({ boardId: PROJECT_ID })));
  });

  it("shows while the board is reconnecting too", async () => {
    const { slot } = renderBanner([databaseRow("reconnecting")]);
    await waitFor(() => expect(slot.queryByText(/Taking and editing is paused/)).not.toBeNull());
  });

  it("draws nothing for a live database or a folder board", async () => {
    for (const rows of [[databaseRow("live")], [folderRow]]) {
      const { slot } = renderBanner(rows);
      await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "listSyncedFolders")).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(slot.container.textContent).toBe("");
      cleanup();
    }
  });
});
