// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_ID, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { FoldersSection } = await import("./folders-section.js");

afterEach(cleanup);

function databaseRow(state: "live" | "reconnecting" | "offline") {
  return {
    projectId: PROJECT_ID,
    projectName: "Remote",
    projectPrefix: "REM",
    taskCount: 3,
    tasksFolder: null,
    linkedBbProjectId: null,
    linkedBbProjectName: null,
    repoPath: null,
    source: { kind: "database", url: "libsql://board-me.turso.io", state, lastSyncAt: "2026-09-30T12:00:00.000Z" },
  };
}

function renderSection(folders: unknown[] = []) {
  return renderSlot(
    { component: FoldersSection },
    {},
    {
      rpc: {
        listSyncedFolders: () => ({ folders }),
        listSyncableBbProjects: () => ({ bbProjects: [] }),
        hasTursoApiToken: () => ({ saved: false }),
        listTursoDatabases: () => ({ ok: true, databases: [] }),
      },
    },
  );
}

const button = (name: string) => screen.queryByRole("button", { name });

describe("the connected sources section", () => {
  it("offers Add folder and Connect database side by side, alike", async () => {
    renderSection();
    await waitFor(() => expect(button("Add folder")).not.toBeNull());
    expect(button("Connect database"), "a Connect database button").not.toBeNull();
    expect(button("Connect database")!.className).toBe(button("Add folder")!.className);
  });

  it("opens the database dialog from Connect database and the folder dialog from Add folder", async () => {
    renderSection();
    await waitFor(() => expect(button("Connect database")).not.toBeNull());
    fireEvent.click(button("Connect database")!);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Connect database" })).not.toBeNull());
    cleanup();
    renderSection();
    await waitFor(() => expect(button("Add folder")).not.toBeNull());
    fireEvent.click(button("Add folder")!);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add synced folder" })).not.toBeNull());
  });

  it("lists a database board by its host, board, prefix and task count", async () => {
    const slot = renderSection([databaseRow("live")]);
    await waitFor(() => expect(slot.container.textContent).toContain("board-me.turso.io"));
    expect(slot.container.textContent).toContain("Remote (REM) · 3 tasks");
    expect(slot.container.textContent).toContain("Live");
  });

  it("says Reconnecting… and Unreachable with the last sync, as the service reports", async () => {
    const reconnecting = renderSection([databaseRow("reconnecting")]);
    await waitFor(() => expect(reconnecting.container.textContent).toContain("Reconnecting…"));
    cleanup();
    const offline = renderSection([databaseRow("offline")]);
    await waitFor(() => expect(offline.container.textContent).toContain("Unreachable"));
    expect(offline.container.textContent).toMatch(/last sync/i);
  });
});
