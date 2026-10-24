// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { prepareBoardDom } from "../test-support/board-harness.js";

prepareBoardDom();
const app = await loadPluginApp(() => import("../app"));
const { TasksNavigationPanel } = await import("./navigation-panel.js");

afterEach(() => {
  cleanup();
  // The fold lives with the module for the session: each test starts with every branch open.
  localStorage.clear();
});

const URL = "libsql://team-me.turso.io";
const TEAM_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";
const DOCS_ID = "01HZZZZZZZZZZZZZZZZZZZZZT2";
const ALPHA_ID = "01HZZZZZZZZZZZZZZZZZZZZZT3";
const SPECS_ID = "01HZZZZZZZZZZZZZZZZZZZZZT4";
const NEW_ID = "01HZZZZZZZZZZZZZZZZZZZZZT5";
const board = (id: string, name: string, patch: Record<string, unknown> = {}) => ({
  id,
  name,
  prefix: name.slice(0, 3).toUpperCase(),
  nextTaskNumber: 1,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  ...patch,
});

function renderPanel(
  createTable = vi.fn(() => ({ ok: true, boardId: DOCS_ID })),
  renameSection = vi.fn(() => ({ ok: true })),
  deleteSection = vi.fn(() => ({ ok: true })),
  moveSection = vi.fn((): { ok: boolean; message?: string } => ({ ok: true })),
) {
  const slot = renderSlot(
    { ...app.navPanels[0]!, component: TasksNavigationPanel },
    { subPath: "all" },
    {
      rpc: {
        // Alphabetically "Alpha" sits between "Docs" and "Team": the table must still follow its project.
        listProjects: () => ({
          projects: [
            board(DOCS_ID, "Docs", { database: { url: URL, table: "docs0001" } }),
            board(ALPHA_ID, "Alpha"),
            board(TEAM_ID, "Team", { database: { url: URL } }),
            board(SPECS_ID, "Specs", { database: { url: URL, table: "specs001", parent: "docs0001" } }),
          ],
        }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listTasks: () => ({ tasks: [] }),
        getTaskByKey: () => ({ task: null }),
        createTable,
        renameSection,
        deleteSection,
        moveSection,
      },
    },
  );
  return { slot, createTable, renameSection, deleteSection, moveSection };
}

describe("sections on the Tasks+ sidebar", () => {
  it("stand right under the project whose database holds them", async () => {
    const { slot } = renderPanel();
    await slot.findByTitle("Docs");
    const titles = Array.from(slot.container.querySelectorAll("button[title]"), (row) => row.getAttribute("title"));
    expect(titles.indexOf("Docs")).toBe(titles.indexOf("Team") + 1);
  });

  it("are made by New section on a project kept in a database, by name", async () => {
    const { slot, createTable } = renderPanel();
    await slot.findByTitle("Team");
    expect(slot.queryByRole("button", { name: "New section in Alpha" })).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "New section in Team" }));
    const name = slot.getByRole("textbox", { name: "Section name" });
    fireEvent.change(name, { target: { value: "Meetings" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await vi.waitFor(() => expect(createTable).toHaveBeenCalledWith(expect.objectContaining({ boardId: TEAM_ID, name: "Meetings" })));
  });

  it("stand inside their section, one step further in", async () => {
    const { slot } = renderPanel();
    await slot.findByTitle("Specs");
    const titles = Array.from(slot.container.querySelectorAll("button[title]"), (row) => row.getAttribute("title"));
    expect(titles.indexOf("Specs")).toBe(titles.indexOf("Docs") + 1);
    const depth = (title: string) => Number(slot.getByTitle(title).closest("[data-depth]")?.getAttribute("data-depth"));
    expect(depth("Docs")).toBe(1);
    expect(depth("Specs")).toBe(2);
  });

  it("are made inside a section too, by the section's own New section", async () => {
    const { slot, createTable } = renderPanel();
    fireEvent.click(await slot.findByRole("button", { name: "New section in Docs" }));
    const name = slot.getByRole("textbox", { name: "Section name" });
    fireEvent.change(name, { target: { value: "Drafts" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await vi.waitFor(() => expect(createTable).toHaveBeenCalledWith(expect.objectContaining({ boardId: DOCS_ID, name: "Drafts" })));
  });

  it("keep the name field busy with a loader after Enter, until the new section is on the list", async () => {
    const { slot } = renderPanel(vi.fn(() => ({ ok: true, boardId: NEW_ID })));
    fireEvent.click(await slot.findByRole("button", { name: "New section in Team" }));
    const name = slot.getByRole("textbox", { name: "Section name" });
    fireEvent.change(name, { target: { value: "Meetings" } });
    fireEvent.keyDown(name, { key: "Enter" });

    expect(await slot.findByRole("status", { name: "Creating the section" })).toBeTruthy();
    expect((slot.getByRole("textbox", { name: "Section name" }) as HTMLInputElement).readOnly).toBe(true);
  });

  it("let Escape close the busy name field, so a section that never shows up does not hold it", async () => {
    const { slot } = renderPanel(vi.fn(() => ({ ok: true, boardId: NEW_ID })));
    fireEvent.click(await slot.findByRole("button", { name: "New section in Team" }));
    const name = slot.getByRole("textbox", { name: "Section name" });
    fireEvent.change(name, { target: { value: "Meetings" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await slot.findByRole("status", { name: "Creating the section" });

    fireEvent.keyDown(slot.getByRole("textbox", { name: "Section name" }), { key: "Escape" });

    expect(slot.queryByRole("textbox", { name: "Section name" })).toBeNull();
  });

  it("close the name field once the new section is on the list", async () => {
    const { slot } = renderPanel(vi.fn(() => ({ ok: true, boardId: SPECS_ID })));
    fireEvent.click(await slot.findByRole("button", { name: "New section in Team" }));
    const name = slot.getByRole("textbox", { name: "Section name" });
    fireEvent.change(name, { target: { value: "Specs" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await vi.waitFor(() => expect(slot.queryByRole("textbox", { name: "Section name" })).toBeNull());
  });

  it("fold under their holder by its chevron, and come back by it", async () => {
    const { slot } = renderPanel();
    await slot.findByTitle("Specs");
    fireEvent.click(slot.getByRole("button", { name: "Collapse Team" }));
    expect(slot.queryByTitle("Docs")).toBeNull();
    expect(slot.queryByTitle("Specs")).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Expand Team" }));
    expect(slot.getByTitle("Specs")).toBeTruthy();
  });

  it("fold to a level by the switch over the projects: 1 keeps the projects alone, 3 shows every section", async () => {
    const { slot } = renderPanel();
    await slot.findByTitle("Specs");
    const levels = slot.getByRole("group", { name: "Show levels" });
    fireEvent.click(within(levels).getByRole("button", { name: "1" }));
    expect(slot.queryByTitle("Docs")).toBeNull();
    fireEvent.click(within(levels).getByRole("button", { name: "2" }));
    expect(slot.getByTitle("Docs")).toBeTruthy();
    expect(slot.queryByTitle("Specs")).toBeNull();
    fireEvent.click(within(levels).getByRole("button", { name: "3" }));
    expect(slot.getByTitle("Specs")).toBeTruthy();
  });

  it("walk by the arrows: left closes a section's branch, right opens it", async () => {
    const { slot } = renderPanel();
    const docs = await slot.findByTitle("Docs");
    docs.focus();
    fireEvent.keyDown(docs, { key: "ArrowLeft" });
    expect(slot.queryByTitle("Specs")).toBeNull();
    fireEvent.keyDown(slot.getByTitle("Docs"), { key: "ArrowRight" });
    expect(slot.getByTitle("Specs")).toBeTruthy();
    fireEvent.keyDown(slot.getByTitle("Docs"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(slot.getByTitle("Specs"));
  });

  it("are renamed from a section's menu, but a project has no such menu", async () => {
    const { slot, renameSection } = renderPanel();
    await slot.findByTitle("Docs");
    expect(slot.queryByRole("button", { name: "Actions for Team" })).toBeNull();

    fireEvent.keyDown(slot.getByRole("button", { name: "Actions for Docs" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: "Rename" }));
    const name = await slot.findByRole("textbox", { name: "Section name" });
    fireEvent.change(name, { target: { value: "Guides" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await vi.waitFor(() => expect(renameSection).toHaveBeenCalledWith(expect.objectContaining({ boardId: DOCS_ID, name: "Guides" })));
  });

  it("are dragged onto a row to go inside it: Specs dropped on its project goes to the top", async () => {
    const { slot, moveSection } = renderPanel();
    const specs = await slot.findByTitle("Specs");
    const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(specs, { dataTransfer });
    const team = slot.getByTitle("Team");

    expect(fireEvent.dragOver(team, { dataTransfer })).toBe(false);
    expect(team.closest("[data-drop-target]")).not.toBeNull();
    fireEvent.drop(team, { dataTransfer });

    await vi.waitFor(() => expect(moveSection).toHaveBeenCalledWith(expect.objectContaining({ boardId: SPECS_ID, into: TEAM_ID })));
    expect(slot.container.querySelector("[data-drop-target]")).toBeNull();
  });

  it("take no drop into the section itself, a section inside it, the row it already sits in or another project", async () => {
    const { slot, moveSection } = renderPanel();
    const docs = await slot.findByTitle("Docs");
    const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(docs, { dataTransfer });

    for (const title of ["Docs", "Specs", "Team", "Alpha"]) {
      const row = slot.getByTitle(title);
      expect(fireEvent.dragOver(row, { dataTransfer })).toBe(true);
      expect(row.closest("[data-drop-target]")).toBeNull();
      fireEvent.drop(row, { dataTransfer });
    }
    expect(moveSection).not.toHaveBeenCalled();
  });

  it("tell why a move was refused, under the row the section was dropped on", async () => {
    const { slot } = renderPanel(undefined, undefined, undefined, vi.fn(() => ({ ok: false, message: "There is already a section Specs here." })));
    const specs = await slot.findByTitle("Specs");
    const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(specs, { dataTransfer });
    fireEvent.dragOver(slot.getByTitle("Team"), { dataTransfer });
    fireEvent.drop(slot.getByTitle("Team"), { dataTransfer });

    expect((await slot.findByRole("alert")).textContent).toMatch(/already a section Specs/);
  });

  it("are deleted from a section's menu once the dialog, naming what goes with it, is confirmed", async () => {
    const { slot, deleteSection } = renderPanel();
    await slot.findByTitle("Docs");
    fireEvent.keyDown(slot.getByRole("button", { name: "Actions for Docs" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: "Delete" }));
    const dialog = await slot.findByRole("dialog", { name: "Delete Docs?" });
    expect(dialog.textContent).toMatch(/1 section go/);
    expect(deleteSection).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteSection).toHaveBeenCalledWith(expect.objectContaining({ boardId: DOCS_ID })));
  });

  it("walk a nested folder's projects by the arrows without the outer folder taking the key", async () => {
    const folder = (id: string, name: string, parentFolderId: string | null) => ({ id, name, parentFolderId, position: 0, createdAt: "2026-07-15T00:00:00.000Z" });
    const slot = renderSlot(
      { ...app.navPanels[0]!, component: TasksNavigationPanel },
      { subPath: "all" },
      {
        rpc: {
          listProjects: () => ({
            projects: [
              board(ALPHA_ID, "Outer", { folderId: "F1" }),
              board(TEAM_ID, "First", { folderId: "F2" }),
              board(SPECS_ID, "Second", { folderId: "F2" }),
            ],
          }),
          listFolders: () => ({ folders: [folder("F1", "Work", null), folder("F2", "Inner", "F1")] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          getTaskByKey: () => ({ task: null }),
        },
      },
    );
    const first = await slot.findByTitle("First");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(slot.getByTitle("Second"));
  });
});
