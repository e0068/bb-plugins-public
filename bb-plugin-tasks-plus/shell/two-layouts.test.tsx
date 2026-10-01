// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../shared/contract.js";

window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

// jsdom подменяет URL: new URL("..", import.meta.url) уходит в http://localhost, поэтому путь — от каталога файла.
const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const VIEW = "01HZZZZZZZZZZZZZZZZZZZZZV1";

const project = {
  id: P1,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: P1,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: number,
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
    ...patch,
  };
}

const view = {
  id: VIEW,
  version: 2,
  name: "Mine",
  projectId: null,
  listScope: null,
  surface: "list",
  filters: { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] },
  sort: "manual",
  fields: { fields: [], showEmpty: false, showDescription: false },
  board: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

function render(subPath: string) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews: [view] }),
        listTasks: () => ({ tasks: [task(1), task(2, { status: "in_progress" })], nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
      } as never,
    },
  );
}

const isTable = (slot: ReturnType<typeof render>) => slot.queryAllByRole("columnheader").length > 0;
const isBoard = (slot: ReturnType<typeof render>) => slot.container.querySelector("[data-board-column]") !== null;

describe("two layouts and no list", () => {
  it("no module of the plugin exports a list view", () => {
    const offenders = sourceFiles(ROOT)
      .filter((path) => /export (function|const) (ListView|TaskRow)\b/.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("All tasks, Active, Waiting, a project and a view each open as a table and as a board", async () => {
    const screens: [string, string][] = [
      ["all", "all?view=board"],
      ["active", "active?view=board"],
      ["waiting", "waiting?view=board"],
      [P1, `${P1}?view=board`],
    ];
    for (const [table, board] of screens) {
      const asTable = render(table);
      await waitFor(() => expect(isTable(asTable), table).toBe(true));
      expect(isBoard(asTable)).toBe(false);
      cleanup();
      const asBoard = render(board);
      await waitFor(() => expect(isBoard(asBoard), board).toBe(true));
      expect(isTable(asBoard)).toBe(false);
      cleanup();
    }

    const saved = render(`view/${VIEW}`);
    await waitFor(() => expect(isTable(saved)).toBe(true));
    fireEvent.click(within(saved.container.querySelector("header")!).getByRole("button", { name: "Display" }));
    const panel = within(await saved.findByRole("complementary", { name: "Display" }));
    fireEvent.click(within(panel.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Board" }));
    await waitFor(() => expect(isBoard(saved)).toBe(true));
  });
});
