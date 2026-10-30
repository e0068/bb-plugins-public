// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { TableView } = await import("./index.js");
const { TasksRefreshProvider } = await import("../../client/refresh.js");
const { DisplayPanel } = await import("../common/display-panel.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const URL = "libsql://team-me.turso.io";
const DOCS = "01HZZZZZZZZZZZZZZZZZZZZZT2";
const TEAM = "01HZZZZZZZZZZZZZZZZZZZZZT1";

const project = (id: string, name: string, prefix: string, database: Record<string, unknown>) => ({
  id,
  name,
  prefix,
  nextTaskNumber: 2,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  database,
  createdAt: "2026-07-15T00:00:00.000Z",
});

const created: Task = {
  id: `${DOCS}:untitled`,
  projectId: DOCS,
  number: 1,
  key: "DOC-1",
  title: "Untitled",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 1,
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

const SIZE = { name: "size", type: "number" };

function renderTable(
  projectId: string,
  createTask = vi.fn(() => ({ ok: true, task: created })),
  tasks: Task[] = [],
  addSectionField = vi.fn(() => ({ ok: true })),
) {
  const slot = renderSlot(
    {
      component: () => (
        <TasksRefreshProvider>
          <TableView scope={`project:${projectId}`} />
        </TasksRefreshProvider>
      ),
    },
    {},
    {
      rpc: {
        listProjects: () => ({ projects: [project(TEAM, "Team", "TSK", { url: URL }), project(DOCS, "Docs", "DOC", { url: URL, table: "docs0001", fields: [SIZE] })] }),
        listFolders: () => ({ folders: [] }),
        listLabels: () => ({ labels: [] }),
        listTasks: () => ({ tasks, nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        createTask,
        addSectionField,
      } as never,
    },
  );
  return { slot, createTask, addSectionField };
}

const headerNames = async (slot: ReturnType<typeof renderTable>["slot"]) =>
  (await slot.findAllByRole("columnheader")).map((header) => header.textContent?.trim());
const record = (key: string, title: string, properties: Record<string, string>): Task => ({ ...created, id: `${DOCS}:${key}`, key, title, properties });

describe("a table's records", () => {
  it("are made by New record in one press, with no task dialog, and the new record opens", async () => {
    const { slot, createTask } = renderTable(DOCS);
    fireEvent.click(await slot.findByRole("button", { name: "New record" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: DOCS, title: "Untitled" })));
    expect(slot.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(JSON.stringify(slot.navigateCalls)).toMatch(/DOC-1/));
  });

  it("leave the task board's New task as it was", async () => {
    const { slot } = renderTable(TEAM);
    await slot.findByRole("button", { name: /New task/ });
    expect(slot.queryByRole("button", { name: "New record" })).toBeNull();
  });

  it("show a section's own columns — title, its fields, the two dates — and none of a task's, ungrouped, even with no records", async () => {
    const { slot } = renderTable(DOCS);
    await slot.findByRole("button", { name: "New record" });
    const headers = (await slot.findAllByRole("columnheader")).map((header) => header.textContent?.trim());

    expect(headers).toEqual(["Title", "Created", "Edited", "tags", "date", "size"]);
    for (const taskColumn of ["Status", "Priority", "Estimate", "Labels"]) expect(headers).not.toContain(taskColumn);
    expect(document.querySelector("[data-table-group]")).toBeNull();
  });

  it("gain a column for a field one record has", async () => {
    const { slot } = renderTable(DOCS, undefined, [{ ...created, properties: { owner: "Ann" } }]);
    await slot.findByText("Ann");
    const headers = (await slot.findAllByRole("columnheader")).map((header) => header.textContent?.trim());
    expect(headers).toContain("owner");
  });

  it("give a field's column the same menu as a task column, and no eye to hide it by", async () => {
    const { slot } = renderTable(DOCS);
    await slot.findByRole("button", { name: "New record" });
    expect(slot.queryByRole("button", { name: /^Hide / })).toBeNull();
    expect(slot.queryByRole("button", { name: "Properties" })).toBeNull();
    expect(slot.getByRole("separator", { name: "Resize size" })).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "size" }));

    const menu = await slot.findByRole("menu");
    for (const item of ["Sort ascending", "Sort descending", "Pin column", "Hide column"]) expect(menu.textContent).toContain(item);
  });

  it("hide a field's column from its menu", async () => {
    const { slot } = renderTable(DOCS);
    fireEvent.click(await slot.findByRole("button", { name: "tags" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Hide column" }));

    await waitFor(async () => expect(await headerNames(slot)).toEqual(["Title", "Created", "Edited", "date", "size"]));
  });

  it("sort a number field by its number, the empty last", async () => {
    const { slot } = renderTable(DOCS, undefined, [record("DOC-1", "Ten", { size: "10" }), record("DOC-2", "None", {}), record("DOC-3", "Nine", { size: "9" })]);
    await slot.findByText("Ten");
    fireEvent.click(slot.getByRole("button", { name: "size" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Sort ascending" }));

    await waitFor(() =>
      expect(Array.from(document.querySelectorAll("[data-task-key]")).map((row) => row.getAttribute("data-task-key"))).toEqual(["DOC-3", "DOC-1", "DOC-2"]),
    );
  });

  it("add a property of a type from the + at the end of the header", async () => {
    const { slot, addSectionField } = renderTable(DOCS);
    fireEvent.click(await slot.findByRole("button", { name: "Add a property" }));
    fireEvent.change(await slot.findByRole("textbox", { name: "Property name" }), { target: { value: "Due" } });
    fireEvent.click(slot.getByRole("radio", { name: "Date" }));
    fireEvent.click(slot.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(addSectionField).toHaveBeenCalledWith(expect.objectContaining({ boardId: DOCS, name: "Due", type: "date" })));
    await waitFor(() => expect(slot.queryByRole("form", { name: "New property" })).toBeNull());
  });

  it("refuse a property name the section already has, without asking the database", async () => {
    const { slot, addSectionField } = renderTable(DOCS);
    fireEvent.click(await slot.findByRole("button", { name: "Add a property" }));
    fireEvent.change(await slot.findByRole("textbox", { name: "Property name" }), { target: { value: "Size" } });
    fireEvent.click(slot.getByRole("button", { name: "Add property" }));

    expect((await slot.findByRole("alert")).textContent).toMatch(/already has/);
    expect(addSectionField).not.toHaveBeenCalled();
  });

  it("list a section's columns in its Display panel, where a hidden one comes back, and leave out grouping", async () => {
    const display = (projectId: string) =>
      renderSlot(
        {
          component: () => (
            <TasksRefreshProvider>
              <DisplayPanel target={{ layout: "table", scope: `project:${projectId}`, view: null }} onClose={() => {}} />
            </TasksRefreshProvider>
          ),
        },
        {},
        {
          rpc: {
            listProjects: () => ({ projects: [project(TEAM, "Team", "TSK", { url: URL }), project(DOCS, "Docs", "DOC", { url: URL, table: "docs0001", fields: [SIZE] })] }),
            listTasks: () => ({ tasks: [], nextCursor: null }),
          } as never,
        },
      );
    const board = display(TEAM);
    await board.findByText("Columns — drag to reorder");
    cleanup();

    window.localStorage.setItem("bb-tasks:section-tables", JSON.stringify({ [DOCS]: { hidden: ["field:size"] } }));
    const section = display(DOCS);
    const columns = await section.findByRole("list", { name: "Columns" });
    await waitFor(() => expect(columns.textContent).toContain("size"));
    expect(section.queryByText("Columns — drag to reorder")).toBeNull();
    expect(section.queryByText("Group by")).toBeNull();
    const size = Array.from(columns.querySelectorAll("button")).find((button) => button.textContent === "size")!;
    expect(size.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(size);

    expect(JSON.parse(window.localStorage.getItem("bb-tasks:section-tables")!)[DOCS].hidden).toEqual([]);
  });

  it("draw the Tags as a chip per label of the record", async () => {
    const { slot } = renderTable(DOCS, undefined, [{ ...record("DOC-1", "Onboarding", {}), labelIds: ["urgent", "later"] }]);
    await slot.findByText("urgent");
    expect(slot.getByText("later")).toBeTruthy();
  });

  it("show the record's text in a Description column once the layout shows it, its first paragraph only", async () => {
    window.localStorage.setItem("bb-tasks:section-tables", JSON.stringify({ [DOCS]: { hidden: [] } }));
    const { slot } = renderTable(DOCS, undefined, [{ ...record("DOC-1", "Onboarding", {}), description: "First day.\n\nSecond part." }]);
    await slot.findByText("First day.");
    expect(await headerNames(slot)).toEqual(["Title", "Description", "Created", "Edited", "tags", "date", "size"]);
    expect(slot.queryByText(/Second part/)).toBeNull();
    window.localStorage.clear();
  });

  it("keep Description hidden until the Display panel shows it", async () => {
    const { slot } = renderTable(DOCS);
    await slot.findByRole("button", { name: "New record" });
    expect(await headerNames(slot)).not.toContain("Description");
  });

  it("nest sub-records under their parent, the parent first, and fold them from its arrow", async () => {
    const parent = record("CT-1", "Copy Trading", {});
    const child = (n: number): Task => ({ ...record(`CT-${n}`, `Part ${n}`, {}), parentTaskId: parent.id });
    // The children come before their parent in the list, as the board stores them.
    const { slot } = renderTable(DOCS, undefined, [child(2), child(3), parent]);
    await slot.findByText("Part 2");

    const keys = () => Array.from(document.querySelectorAll("[data-task-key]")).map((row) => row.getAttribute("data-task-key"));
    expect(keys()).toEqual(["CT-1", "CT-2", "CT-3"]);
    expect(document.querySelectorAll("[data-title-lead='branch']")).toHaveLength(2);

    fireEvent.click(slot.getByRole("button", { name: "Collapse sub-tasks" }));

    await waitFor(() => expect(keys()).toEqual(["CT-1"]));
    expect(slot.getByRole("button", { name: "Expand sub-tasks" })).toBeTruthy();
  });
});
