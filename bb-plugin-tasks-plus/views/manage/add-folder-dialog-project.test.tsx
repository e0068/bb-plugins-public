// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { AddFolderDialog } = await import("./add-folder-dialog.js");

afterEach(cleanup);

const CORPUS = { id: "proj_corpus", name: "Corpus", repoPath: "/repos/corpus" };

function renderDialog() {
  const added: unknown[] = [];
  const asked: string[] = [];
  const onConnected = vi.fn();
  renderSlot(
    { component: () => <AddFolderDialog open onOpenChange={() => {}} onConnected={onConnected} bbProject={CORPUS} /> },
    {},
    {
      rpc: {
        listSyncableBbProjects: () => (asked.push("listSyncableBbProjects"), { bbProjects: [] }),
        addSyncedFolder: (input: unknown) => (added.push(input), { ok: false, error: { code: "folder_connect_failed", message: "stop here" } }),
      },
    },
  );
  return { added, asked, onConnected };
}

describe("connecting a folder from a project's row", () => {
  it("names the row's project and its repository instead of asking for one", async () => {
    const { asked } = renderDialog();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Corpus");
    expect(dialog.textContent).toContain("/repos/corpus");
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("connects the typed folder to the row's project", async () => {
    const { added } = renderDialog();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(added).toEqual([{ bbProjectId: "proj_corpus", tasksFolder: "docs/tasks" }]));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("stop here");
  });
});
