// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();

// loadPluginApp installs the fake SDK runtime; nothing SDK-touching may be imported before it runs.
const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const folderProject = {
  id: PROJECT_ID,
  name: "Shader-Lab",
  prefix: "SHA",
  nextTaskNumber: 79,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "docs/tasks",
  createdAt: "2026-07-15T00:00:00.000Z",
};

const databaseProject = { ...folderProject, tasksFolder: null, database: { url: "libsql://board-me.turso.io" } };

type Renamed = { ok: true; project: typeof folderProject } | { ok: false; error: { code: string; message: string } };

function renderProjectTab(project: Record<string, unknown>, renameProjectPrefix: (input: { projectId: string; prefix: string }) => Renamed) {
  const renames: Array<{ projectId: string; prefix: string }> = [];
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "manage" },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [{ projectId: PROJECT_ID, taskCount: 78, activeAgentCount: 0 }] }),
        listTasks: () => ({ tasks: [] }),
        listLabels: () => ({ labels: [] }),
        renameProjectPrefix: (input: unknown) => {
          const asked = input as { projectId: string; prefix: string };
          renames.push(asked);
          return renameProjectPrefix(asked);
        },
      },
    },
  );
  return { slot, renames };
}

const renamedTo = (prefix: string): Renamed => ({ ok: true, project: { ...folderProject, prefix } });

describe("Manage → Project: the board's key prefix", () => {
  it("shows the prefix under the name, upper-cased as it is typed", async () => {
    const { slot } = renderProjectTab(folderProject, (input) => renamedTo(input.prefix));
    const field = (await slot.findByLabelText("Key prefix")) as HTMLInputElement;
    expect(field.value).toBe("SHA");
    fireEvent.change(field, { target: { value: "sl" } });
    expect(field.value).toBe("SL");
  });

  it("asks before renaming, naming how many task keys change and how, and renames on confirm", async () => {
    const { slot, renames } = renderProjectTab(databaseProject, (input) => renamedTo(input.prefix));
    fireEvent.change(await slot.findByLabelText("Key prefix"), { target: { value: "SL" } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));

    await slot.findByText("Rename the board's task keys from SHA-n to SL-n?");
    expect(renames).toEqual([]);
    fireEvent.click(slot.getByRole("button", { name: "Rename keys" }));

    await waitFor(() => expect(renames).toEqual([{ projectId: PROJECT_ID, prefix: "SL" }]));
  });

  it("warns that a folder board's task files change and are to be committed", async () => {
    const { slot } = renderProjectTab(folderProject, (input) => renamedTo(input.prefix));
    fireEvent.change(await slot.findByLabelText("Key prefix"), { target: { value: "SL" } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));

    await slot.findByText(/commit them/);
  });

  it("renames nothing when the rename is cancelled", async () => {
    const { slot, renames } = renderProjectTab(folderProject, (input) => renamedTo(input.prefix));
    fireEvent.change(await slot.findByLabelText("Key prefix"), { target: { value: "SL" } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    fireEvent.click(await slot.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(slot.queryByText(/Rename the keys/)).toBeNull());
    expect(renames).toEqual([]);
  });

  it("says why a prefix another board has is refused", async () => {
    const { slot } = renderProjectTab(folderProject, () => ({
      ok: false,
      error: { code: "project_prefix_conflict", message: "Project prefix is already in use: OTH" },
    }));
    fireEvent.change(await slot.findByLabelText("Key prefix"), { target: { value: "OTH" } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    fireEvent.click(await slot.findByRole("button", { name: "Rename keys" }));

    expect((await slot.findByRole("alert")).textContent).toBe("Another board already uses the prefix OTH.");
  });

  it("keeps Save off for a malformed prefix", async () => {
    const { slot } = renderProjectTab(folderProject, (input) => renamedTo(input.prefix));
    fireEvent.change(await slot.findByLabelText("Key prefix"), { target: { value: "9X" } });

    await slot.findByText("Use 1–10 uppercase letters and digits, starting with a letter.");
    expect((slot.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
