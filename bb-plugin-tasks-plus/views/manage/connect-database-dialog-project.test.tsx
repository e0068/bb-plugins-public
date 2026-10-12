// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { ConnectDatabaseDialog } = await import("./connect-database-dialog.js");

afterEach(cleanup);

const ADDRESS = "libsql://bb-tasks-cor-me.turso.io";

function renderDialog() {
  const connectDatabase = vi.fn((_input: unknown) => ({ ok: true }));
  renderSlot(
    {
      component: () => (
        <ConnectDatabaseDialog open onOpenChange={() => {}} onConnected={() => {}} bbProject={{ id: "proj_corpus", name: "Corpus", repoPath: "/repos/corpus" }} />
      ),
    },
    {},
    {
      rpc: {
        listSyncedFolders: () => ({ folders: [] }),
        hasTursoApiToken: () => ({ saved: true }),
        listTursoDatabases: () => ({ ok: true, databases: [] }),
        inspectDatabase: () => ({ ok: true, board: null }),
        connectDatabase,
      },
    },
  );
  return connectDatabase;
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;

describe("connecting a database from a project's row", () => {
  it("names the board after the row's project and does not let the name be typed", async () => {
    renderDialog();
    await waitFor(() => expect(field("Board name")).not.toBeNull());
    expect(field("Board name")?.value).toBe("Corpus");
    expect(field("Board name")?.disabled).toBe(true);
  });

  it("connects the database to the row's project", async () => {
    const connectDatabase = renderDialog();
    await waitFor(() => expect(field("Database address")).not.toBeNull());
    fireEvent.change(field("Database address")!, { target: { value: ADDRESS } });
    fireEvent.change(field("Database token")!, { target: { value: "jwt-token" } });
    fireEvent.change(field("Key prefix")!, { target: { value: "cor" } });
    const create = await screen.findByRole("button", { name: "Create board" });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(connectDatabase).toHaveBeenCalledTimes(1));
    expect(connectDatabase.mock.calls[0]![0]).toMatchObject({ url: ADDRESS, prefix: "COR", bbProjectId: "proj_corpus" });
  });
});

describe("moving a project's folder board to a database", () => {
  it("opens with the copy of that board already chosen, and connects the copy to the project", async () => {
    const connectDatabase = vi.fn((_input: unknown) => ({ ok: true }));
    renderSlot(
      {
        component: () => (
          <ConnectDatabaseDialog
            open
            onOpenChange={() => {}}
            onConnected={() => {}}
            bbProject={{ id: "proj_corpus", name: "Corpus", repoPath: "/repos/corpus" }}
            copyFromBoardId="01HZZZZZZZZZZZZZZZZZZZZZP2"
          />
        ),
      },
      {},
      {
        rpc: {
          listSyncedFolders: () => ({
            folders: [
              {
                projectId: "01HZZZZZZZZZZZZZZZZZZZZZP2",
                projectName: "Corpus",
                projectPrefix: "COR",
                taskCount: 4,
                tasksFolder: "docs/tasks",
                linkedBbProjectId: "proj_corpus",
                linkedBbProjectName: "Corpus",
                repoPath: "/repos/corpus",
                source: { kind: "folder" },
              },
            ],
          }),
          hasTursoApiToken: () => ({ saved: true }),
          listTursoDatabases: () => ({ ok: true, databases: [] }),
          inspectDatabase: () => ({ ok: true, board: null }),
          connectDatabase,
        },
      },
    );
    const copy = await screen.findByRole("checkbox", { name: "Copy tasks from a folder" });
    expect(copy.getAttribute("aria-checked") ?? copy.getAttribute("data-state")).toMatch(/true|checked/);
    await waitFor(() => expect(field("Key prefix")?.value).toBe("COR"));
    fireEvent.change(field("Database address")!, { target: { value: ADDRESS } });
    fireEvent.change(field("Database token")!, { target: { value: "jwt-token" } });
    const button = await screen.findByRole("button", { name: "Copy board" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(connectDatabase).toHaveBeenCalledTimes(1));
    expect(connectDatabase.mock.calls[0]![0]).toMatchObject({ url: ADDRESS, copyFromBoardId: "01HZZZZZZZZZZZZZZZZZZZZZP2", bbProjectId: "proj_corpus" });
  });
});
