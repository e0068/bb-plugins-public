// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task, TaskMutationResult } from "../../shared/contract.js";

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
const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { resetFieldDisplay, toggleFieldVisible } = await import("../common/row-field-preference.js");
const { boardKey } = await import("./board-preference.js");

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const KEY = boardKey(PROJECT_ID, null);

// The field display lives in memory past localStorage: each test starts from
// the board's own defaults, where cards do not list sub-tasks.
beforeEach(() => {
  window.localStorage.clear();
  resetFieldDisplay(KEY);
});
afterEach(cleanup);

const project = {
  id: PROJECT_ID,
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
    projectId: PROJECT_ID,
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

const parent = task(1, { title: "Parent" });
const child = task(2, { title: "Child", parentTaskId: parent.id });
const leaf = task(3, { title: "Leaf" });

interface CreateCall {
  projectId: string;
  title: string;
  parentTaskId: string;
  status: string;
}

/** A board whose createTask adds the task to what listTasks answers next,
 *  unless `fail` names the error it answers with instead; `delayMs` holds
 *  each answer back the way a file write does. */
function renderBoard(fail?: string, delayMs = 0) {
  const listed = [parent, child, leaf];
  const created: CreateCall[] = [];
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: `${PROJECT_ID}?view=board` },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listTasks: () => ({ tasks: [...listed] }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        createTask: async (raw: unknown): Promise<TaskMutationResult> => {
          const input = raw as CreateCall;
          created.push(input);
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (fail) return { ok: false, error: { code: "subtask_depth_exceeded", message: fail } };
          const made = task(9, { title: input.title, parentTaskId: input.parentTaskId, status: "todo" });
          listed.push(made);
          return { ok: true, task: made };
        },
      },
    },
  );
  return { slot, created };
}

function cardOf(container: HTMLElement, key: string) {
  const card = container.querySelector<HTMLElement>(`[data-task-key="${key}"]`);
  if (!card) throw new Error(`no card ${key}`);
  return within(card);
}

const findCard = (container: HTMLElement, key: string) => waitFor(() => cardOf(container, key));

async function openAdder(container: HTMLElement, key: string) {
  const card = await findCard(container, key);
  fireEvent.click(await card.findByRole("button", { name: "Add sub-task" }));
  return card.getByRole("textbox");
}

describe("Add sub-task on a board card", () => {
  it("stands under the sub-tasks of a card that has some", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard();
    await waitFor(() => cardOf(slot.container, "TSK-1").getByRole("button", { name: "Open TSK-2" }));
    const card = cardOf(slot.container, "TSK-1");
    const rows = card.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(rows.indexOf("Add sub-task")).toBeGreaterThan(rows.indexOf("Open TSK-2"));
  });

  it("is offered on a card with no sub-tasks while the card lists them", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard();
    expect(await (await findCard(slot.container, "TSK-3")).findByRole("button", { name: "Add sub-task" })).toBeTruthy();
  });

  it("is not offered while the card does not list sub-tasks", async () => {
    const { slot } = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-3"));
    expect(cardOf(slot.container, "TSK-1").queryByRole("button", { name: "Add sub-task" })).toBeNull();
    expect(cardOf(slot.container, "TSK-3").queryByRole("button", { name: "Add sub-task" })).toBeNull();
  });

  it("creates a sub-task of the card in todo on Enter and keeps an empty field for the next", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot, created } = renderBoard();
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.change(field, { target: { value: "  First step  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ projectId: PROJECT_ID, title: "First step", parentTaskId: leaf.id, status: "todo" });
    await waitFor(() => expect((cardOf(slot.container, "TSK-3").getByRole("textbox") as HTMLInputElement).value).toBe(""));
  });

  it("lists the new sub-task on the card without a reload", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard();
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.change(field, { target: { value: "First step" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await cardOf(slot.container, "TSK-3").findByRole("button", { name: "Open TSK-9" })).toBeTruthy();
  });

  it("creates nothing for a blank title", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot, created } = renderBoard();
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(0);
  });

  it("closes the field on Escape", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard();
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(cardOf(slot.container, "TSK-3").queryByRole("textbox")).toBeNull();
    expect(cardOf(slot.container, "TSK-3").getByRole("button", { name: "Add sub-task" })).toBeTruthy();
  });

  it("keeps the title and says why when the board refuses the sub-task", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard("Sub-tasks go three levels deep at most");
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.change(field, { target: { value: "Too deep" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await cardOf(slot.container, "TSK-3").findByText("Sub-tasks go three levels deep at most")).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe("Too deep");
  });

  it("does not open the card when pressed or typed in", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard();
    const button = await (await findCard(slot.container, "TSK-3")).findByRole("button", { name: "Add sub-task" });
    fireEvent.click(button);
    const field = cardOf(slot.container, "TSK-3").getByRole("textbox");
    fireEvent.click(field);
    fireEvent.keyDown(field, { key: " " });
    expect(slot.navigateCalls).toEqual([]);
    expect(slot.experimental_fixedTabOpenCalls).toEqual([]);
  });

  it("does not drag the card when the pointer moves on after pressing Add sub-task", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard();
    const button = await (await findCard(slot.container, "TSK-3")).findByRole("button", { name: "Add sub-task" });
    fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const copies = slot.container.querySelectorAll('[data-task-key="TSK-3"]').length;
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
    expect(copies).toBe(1);
  });

  it("creates every title entered while the one before is still being saved", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot, created } = renderBoard(undefined, 50);
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.change(field, { target: { value: "First" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "Second" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(created.map((call) => call.title)).toEqual(["First", "Second"]));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect((cardOf(slot.container, "TSK-3").getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("drops the board's reason once the title is edited", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const { slot } = renderBoard("Sub-tasks go three levels deep at most");
    const field = await openAdder(slot.container, "TSK-3");
    fireEvent.change(field, { target: { value: "Too deep" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const card = cardOf(slot.container, "TSK-3");
    await card.findByText("Sub-tasks go three levels deep at most");
    fireEvent.change(field, { target: { value: "Shallower" } });
    expect(card.queryByText("Sub-tasks go three levels deep at most")).toBeNull();
  });
});
