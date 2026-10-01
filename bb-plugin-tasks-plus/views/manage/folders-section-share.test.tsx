// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PROJECT_ID, prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { FoldersSection } = await import("./folders-section.js");

const INVITE = "libsql://board-me.turso.io?authToken=owner-token";
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const databaseRow = {
  projectId: PROJECT_ID,
  projectName: "Remote",
  projectPrefix: "REM",
  taskCount: 3,
  tasksFolder: null,
  linkedBbProjectId: null,
  linkedBbProjectName: null,
  repoPath: null,
  source: { kind: "database", url: "libsql://board-me.turso.io", state: "live", lastSyncAt: "2026-09-30T12:00:00.000Z" },
};

function renderSection(rpc: Record<string, (input: never) => unknown> = {}) {
  return renderSlot(
    { component: FoldersSection },
    {},
    {
      rpc: {
        listSyncedFolders: () => ({ folders: [databaseRow] }),
        listSyncableBbProjects: () => ({ bbProjects: [] }),
        hasTursoApiToken: () => ({ saved: false }),
        listTursoDatabases: () => ({ ok: true, databases: [] }),
        databaseInvite: () => ({ ok: true, invite: INVITE }),
        ...rpc,
      },
    },
  );
}

const button = (name: RegExp) => screen.queryByRole("button", { name });

describe("Share on a database row", () => {
  it("copies the invite of the board and says so", async () => {
    const asked: unknown[] = [];
    renderSection({ databaseInvite: (input: never) => (asked.push(input), { ok: true, invite: INVITE }) });
    await waitFor(() => expect(button(/share/i)).not.toBeNull());
    fireEvent.click(button(/share/i)!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVITE));
    expect(asked).toEqual([{ boardId: PROJECT_ID }]);
    await waitFor(() => expect(screen.queryByRole("status")?.textContent).toMatch(/copied/i));
  });

  it("says why when there is no invite to copy", async () => {
    renderSection({ databaseInvite: () => ({ ok: false, error: { code: "folder_connect_failed", message: "No token is saved for this database." } }) });
    await waitFor(() => expect(button(/share/i)).not.toBeNull());
    fireEvent.click(button(/share/i)!);
    await waitFor(() => expect(screen.queryByRole("status")?.textContent).toContain("No token is saved for this database."));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("Remove on a database row", () => {
  it("asks to disconnect the database, not a folder, and disconnects it", async () => {
    const removed: unknown[] = [];
    renderSection({ removeSyncedFolder: (input: never) => (removed.push(input), { ok: true }) });
    await waitFor(() => expect(button(/remove/i)).not.toBeNull());
    fireEvent.click(button(/remove/i)!);
    await waitFor(() => expect(screen.queryByRole("heading", { name: /board-me\.turso\.io/ })).not.toBeNull());
    expect(screen.getByRole("dialog").textContent).toMatch(/other machines/i);
    expect(screen.getByRole("dialog").textContent).not.toMatch(/files on disk/i);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(removed).toEqual([{ projectId: PROJECT_ID }]));
  });
});
