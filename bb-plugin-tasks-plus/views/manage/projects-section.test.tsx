// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../../test-support/board-harness.js";
import type { ProjectRow, ProjectRowBoard } from "../../folders/contract.js";

prepareBoardDom();
await loadPluginApp(() => import("../../app"));
const { ProjectsSection } = await import("./projects-section.js");

const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const BBPL_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const CEL_ID = "01HZZZZZZZZZZZZZZZZZZZZZP2";
const BP_ID = "01HZZZZZZZZZZZZZZZZZZZZZP3";
const INVITE = "libsql://bbpl-me.turso.io?authToken=owner-token";

const plugins: ProjectRow = {
  bbProject: { id: "proj_plugins", name: "bb-plugins", repoPath: "/repos/bb-plugins" },
  board: {
    id: BBPL_ID,
    name: "bb-plugins",
    prefix: "BBPL",
    color: "steelblue",
    icon: "Puzzle",
    taskCount: 816,
    tasksFolder: null,
    source: { kind: "database", url: "libsql://bbpl-me.turso.io", state: "live", lastSyncAt: "2026-10-12T10:00:00.000Z" },
  },
};
const cellular: ProjectRow = {
  bbProject: { id: "proj_cellular", name: "Cellular", repoPath: "/repos/cellular" },
  board: { id: CEL_ID, name: "Cellular", prefix: "CEL", color: "teal", taskCount: 170, tasksFolder: "docs/tasks", source: { kind: "folder" } },
};
const personal: ProjectRow = { bbProject: { id: "proj_personal", name: "Personal", repoPath: null }, board: null };
const corpus: ProjectRow = { bbProject: { id: "proj_corpus", name: "Corpus", repoPath: "/repos/corpus" }, board: null };
const orphanBp: ProjectRowBoard = { id: BP_ID, name: "bb-plugins", prefix: "BP", color: "slategray", taskCount: 816, tasksFolder: "docs/tasks", source: { kind: "folder" } };

type Rpc = Record<string, (input: never) => unknown>;

function renderSection(rows: { projects: ProjectRow[]; orphans: ProjectRowBoard[] }, rpc: Rpc = {}) {
  const calls: Record<string, unknown[]> = {};
  const record = (method: string, answer: (input: never) => unknown) => (input: never) => {
    (calls[method] ??= []).push(input);
    return answer(input);
  };
  const handlers: Rpc = {
    listProjectRows: () => rows,
    listSyncedFolders: () => ({ folders: [] }),
    hasTursoApiToken: () => ({ saved: false }),
    listTursoDatabases: () => ({ ok: true, databases: [] }),
    databaseInvite: () => ({ ok: true, invite: INVITE }),
    updateProject: () => ({ project: {} }),
    renameProjectPrefix: () => ({ ok: true, project: {} }),
    removeSyncedFolder: () => ({ ok: true }),
    ...rpc,
  };
  renderSlot({ component: ProjectsSection }, {}, { rpc: Object.fromEntries(Object.entries(handlers).map(([method, answer]) => [method, record(method, answer)])) as never });
  return calls;
}

const ALL = { projects: [plugins, personal, cellular, corpus], orphans: [orphanBp] };
const projectsTable = () => screen.findByRole("table", { name: "bb projects" });
const rowNamed = async (table: HTMLElement, name: string) =>
  within(table).getAllByRole("row").find((row) => within(row).queryAllByRole("cell")[0]?.textContent === name)!;

describe("Projects tab: the table of bb projects", () => {
  it("has a row for every bb project in bb's order, the personal one included", async () => {
    renderSection(ALL);
    const table = await projectsTable();
    const names = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(names).toEqual(["bb-plugins", "Personal", "Cellular", "Corpus"]);
  });

  it("shows a board's prefix, task count and where its tasks live", async () => {
    renderSection(ALL);
    const table = await projectsTable();
    const database = await rowNamed(table, "bb-plugins");
    expect((within(database).getByRole("textbox", { name: "Key prefix of bb-plugins" }) as HTMLInputElement).value).toBe("BBPL");
    expect(database.textContent).toContain("816");
    expect(database.textContent).toContain("bbpl-me.turso.io");
    expect(database.textContent).toContain("Live");
    const folder = await rowNamed(table, "Cellular");
    expect(folder.textContent).toContain("docs/tasks");
    expect(folder.textContent).toContain("170");
  });

  it("offers Share on the cloud board only", async () => {
    renderSection(ALL);
    const table = await projectsTable();
    expect(within(await rowNamed(table, "bb-plugins")).queryByRole("button", { name: "Share bb-plugins" })).not.toBeNull();
    expect(within(await rowNamed(table, "Cellular")).queryByRole("button", { name: /share/i })).toBeNull();
  });

  it("shows the mirror folder on the cloud board only, Off until one is set", async () => {
    renderSection(ALL);
    const table = await projectsTable();
    expect((await rowNamed(table, "bb-plugins")).textContent).toContain("Mirror folderOff");
    expect((await rowNamed(table, "Cellular")).textContent).not.toContain("Mirror folder");
  });

  it("sets the mirror folder typed in the cloud board's row, and says why a path is refused", async () => {
    const calls = renderSection(ALL, {
      setMirrorFolder: (input: { folder: string | null }) =>
        input.folder?.startsWith("/") ? { ok: true, folder: input.folder } : { ok: false, message: "The mirror folder must be a full path, or start with ~/." },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Mirror folder of bb-plugins" }));
    const field = screen.getByRole("textbox", { name: "Mirror folder of bb-plugins" });
    fireEvent.change(field, { target: { value: "docs" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/must be a full path/)).toBeTruthy());
    fireEvent.change(field, { target: { value: "/Users/me/docs" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls.setMirrorFolder).toEqual([{ boardId: BBPL_ID, folder: "docs" }, { boardId: BBPL_ID, folder: "/Users/me/docs" }]));
  });

  it("turns the mirror off with the minus of its row", async () => {
    const mirrored = { ...plugins, board: { ...plugins.board!, mirrorFolder: "/Users/me/docs" } };
    const calls = renderSection({ projects: [mirrored], orphans: [] }, { setMirrorFolder: () => ({ ok: true, folder: null }) });
    fireEvent.click(await screen.findByRole("button", { name: "Turn the mirror off" }));
    await waitFor(() => expect(calls.setMirrorFolder).toEqual([{ boardId: BBPL_ID, folder: null }]));
    expect(screen.queryByRole("textbox", { name: "Mirror folder of bb-plugins" })).toBeNull();
  });

  it("copies the cloud board's invite and says so", async () => {
    const calls = renderSection(ALL);
    fireEvent.click(await screen.findByRole("button", { name: "Share bb-plugins" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVITE));
    expect(calls.databaseInvite).toEqual([{ boardId: BBPL_ID }]);
    await waitFor(() => expect(screen.queryByRole("status")?.textContent).toMatch(/copied/i));
  });

  it("saves the icon and the colour picked in a row on that row's board", async () => {
    const calls = renderSection(ALL);
    fireEvent.click(await screen.findByRole("button", { name: "Icon and color of bb-plugins" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Red" }));
    const search = await screen.findByRole("textbox", { name: /search icons/i });
    fireEvent.change(search, { target: { value: "Bug01" } });
    fireEvent.click(await screen.findByRole("button", { name: "Bug01" }));
    await waitFor(() => expect(calls.updateProject).toHaveLength(2));
    expect(calls.updateProject).toContainEqual({ projectId: BBPL_ID, icon: "Bug01" });
    expect(calls.updateProject?.some((input) => (input as { color?: string }).color !== undefined)).toBe(true);
  });
});

describe("Projects tab: a bb project without a board", () => {
  it("offers Connect with a folder or a database in place of the board's cells", async () => {
    renderSection(ALL);
    const table = await projectsTable();
    const row = await rowNamed(table, "Corpus");
    expect(within(row).queryByRole("textbox", { name: /key prefix/i })).toBeNull();
    fireEvent.pointerDown(within(row).getByRole("button", { name: "Connect Corpus" }), { button: 0, pointerType: "mouse" });
    expect(await screen.findByRole("menuitem", { name: /folder/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /database/i })).toBeTruthy();
  });

  it("does not offer a folder to a project without a local repository", async () => {
    renderSection(ALL);
    const row = await rowNamed(await projectsTable(), "Personal");
    fireEvent.pointerDown(within(row).getByRole("button", { name: "Connect Personal" }), { button: 0, pointerType: "mouse" });
    const folder = await screen.findByRole("menuitem", { name: /folder/i });
    expect(folder.getAttribute("aria-disabled") ?? folder.getAttribute("data-disabled")).not.toBeNull();
  });

  it("opens the folder dialog on the row's project, with no project to pick", async () => {
    renderSection(ALL);
    const row = await rowNamed(await projectsTable(), "Corpus");
    fireEvent.pointerDown(within(row).getByRole("button", { name: "Connect Corpus" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /folder/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Corpus");
    expect(within(dialog).queryByRole("combobox")).toBeNull();
  });
});

describe("Projects tab: the key prefix in a row", () => {
  it("asks before renaming the keys and renames on confirm", async () => {
    const calls = renderSection(ALL);
    const field = await screen.findByRole("textbox", { name: "Key prefix of bb-plugins" });
    fireEvent.change(field, { target: { value: "bp2" } });
    expect((field as HTMLInputElement).value).toBe("BP2");
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByText("Rename the board's task keys from BBPL-n to BP2-n?");
    expect(calls.renameProjectPrefix).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Rename keys" }));
    await waitFor(() => expect(calls.renameProjectPrefix).toEqual([{ projectId: BBPL_ID, prefix: "BP2" }]));
  });

  it("renames nothing when the rename is cancelled", async () => {
    const calls = renderSection(ALL);
    const field = await screen.findByRole("textbox", { name: "Key prefix of Cellular" });
    fireEvent.change(field, { target: { value: "CL" } });
    fireEvent.blur(field);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/Rename the board's task keys/)).toBeNull());
    expect(calls.renameProjectPrefix).toBeUndefined();
  });

  it("says why a prefix another board has is refused", async () => {
    renderSection(ALL, { renameProjectPrefix: () => ({ ok: false, error: { code: "project_prefix_conflict", message: "Project prefix is already in use: CEL" } }) });
    const field = await screen.findByRole("textbox", { name: "Key prefix of bb-plugins" });
    fireEvent.change(field, { target: { value: "CEL" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Rename keys" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Another board already uses the prefix CEL.");
  });

  it("asks nothing for a malformed prefix and says what a prefix is", async () => {
    const calls = renderSection(ALL);
    const field = await screen.findByRole("textbox", { name: "Key prefix of bb-plugins" });
    fireEvent.change(field, { target: { value: "9X" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByText("Use 1–10 uppercase letters and digits, starting with a letter.");
    expect(screen.queryByText(/Rename the board's task keys/)).toBeNull();
    expect(calls.renameProjectPrefix).toBeUndefined();
  });
});

describe("Projects tab: boards without a bb project", () => {
  it("lists them in a second table with a way to delete each", async () => {
    renderSection(ALL);
    const table = await screen.findByRole("table", { name: "Boards without a bb project" });
    const row = await rowNamed(table, "bb-plugins");
    expect(row.textContent).toContain("BP");
    expect(within(row).queryByRole("button", { name: "Delete bb-plugins" })).not.toBeNull();
  });

  it("deletes a board after asking, and asks the server to take it off this machine", async () => {
    const calls = renderSection(ALL);
    const table = await screen.findByRole("table", { name: "Boards without a bb project" });
    fireEvent.click(within(await rowNamed(table, "bb-plugins")).getByRole("button", { name: "Delete bb-plugins" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getAllByRole("button").find((button) => /disconnect|delete|remove/i.test(button.textContent ?? ""))!);
    await waitFor(() => expect(calls.removeSyncedFolder).toEqual([{ projectId: BP_ID }]));
  });

  it("is not shown when every board has its bb project", async () => {
    renderSection({ projects: [plugins, cellular], orphans: [] });
    await projectsTable();
    expect(screen.queryByRole("table", { name: "Boards without a bb project" })).toBeNull();
  });
});

describe("Projects tab: moving a folder board to a database", () => {
  it("offers the move on a folder board's row only, and opens the database dialog with that board to copy", async () => {
    renderSection(ALL);
    const table = await projectsTable();
    expect(within(await rowNamed(table, "bb-plugins")).queryByRole("button", { name: /to a database/i })).toBeNull();
    fireEvent.click(within(await rowNamed(table, "Cellular")).getByRole("button", { name: "Move Cellular to a database" }));
    const dialog = await screen.findByRole("dialog");
    const copy = within(dialog).getByRole("checkbox", { name: "Copy tasks from a folder" });
    expect(copy.getAttribute("aria-checked") ?? copy.getAttribute("data-state")).toMatch(/true|checked/);
  });
});

describe("Projects tab: deleting a board without a bb project says what it does", () => {
  it("asks to delete the board by name, says its files stay, and deletes with Delete", async () => {
    const calls = renderSection(ALL);
    const table = await screen.findByRole("table", { name: "Boards without a bb project" });
    fireEvent.click(within(await rowNamed(table, "bb-plugins")).getByRole("button", { name: "Delete bb-plugins" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Delete bb-plugins?");
    expect(dialog.textContent).toContain("docs/tasks");
    expect(dialog.textContent).not.toMatch(/disconnect/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.removeSyncedFolder).toEqual([{ projectId: BP_ID }]));
  });

  it("says a database board's database stays", async () => {
    const orphanDb: ProjectRowBoard = { ...plugins.board!, id: BP_ID };
    renderSection({ projects: [], orphans: [orphanDb] });
    const table = await screen.findByRole("table", { name: "Boards without a bb project" });
    fireEvent.click(within(await rowNamed(table, "bb-plugins")).getByRole("button", { name: "Delete bb-plugins" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("bbpl-me.turso.io");
    expect(dialog.textContent).not.toMatch(/disconnect/i);
  });
});
