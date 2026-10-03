// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@/components/ui/hooks/use-pointer-coarse";
import type { Task } from "../../shared/contract.js";

/** The media the board sees: a narrow screen, a finger, or both — a phone. */
let media = { narrow: false, coarse: false };
window.matchMedia = (query: string) => ({
  matches: (query === COMPACT_VIEWPORT_QUERY && media.narrow) || (query === POINTER_COARSE_QUERY && media.coarse),
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
// jsdom has no PointerEvent; a MouseEvent carries the coordinates the board reads.
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/** jsdom lays nothing out: grid card i spans x from 240·i to 240·i + 230. */
Element.prototype.getBoundingClientRect = function (this: Element) {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  if (this.hasAttribute("data-task-key")) {
    const cards = Array.from(document.querySelectorAll("[data-board-grid] [data-task-key]"));
    return rect(Math.max(0, cards.indexOf(this)) * 240, 0, 230, 40);
  }
  return rect(0, 0, 5000, 1000);
};

const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { boardKey, DEFAULT_BOARD_LAYOUT, setBoardLayout } = await import("./board-preference.js");

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

beforeEach(() => window.localStorage.clear());
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

function task(number: number): Task {
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
  };
}

async function renderBoard(sort: "manual" | "priority" = "manual") {
  setBoardLayout(boardKey(PROJECT_ID, null), {
    ...DEFAULT_BOARD_LAYOUT,
    sort,
    grouping: { groupBy: "none", columns: {}, hideEmpty: false },
  });
  const boardMove = vi.fn(() => new Promise(() => {}));
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
        listTasks: () => ({ tasks: [task(1), task(2), task(3)] }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        boardMove,
      },
    },
  );
  await waitFor(() => slot.getByText("Task 3"));
  const card = slot.container.querySelector<HTMLElement>('[data-task-key="TSK-1"]')!;
  return { slot, boardMove, card, grip: card.querySelector<HTMLElement>("[data-card-grip]") };
}

/** Presses on `from` and lets go to the right of the last card. */
function dragPastLast(from: Element) {
  fireEvent.pointerDown(from, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 300, clientY: 20 });
  fireEvent.pointerMove(window, { clientX: 700, clientY: 20 });
  fireEvent.pointerUp(window, { clientX: 700, clientY: 20 });
}

describe("a card on a phone", () => {
  beforeEach(() => {
    media = { narrow: true, coarse: true };
  });

  it("carries a grip on its right edge", async () => {
    const { grip } = await renderBoard();
    expect(grip).not.toBeNull();
  });

  it("is not dragged by its body, which leaves the finger to scroll", async () => {
    const { boardMove, card } = await renderBoard();
    dragPastLast(card);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(boardMove).not.toHaveBeenCalled();
    expect(card.className).not.toContain("touch-none");
  });

  it("opens its task on a tap of its body, not of its grip", async () => {
    const { slot, card, grip } = await renderBoard();
    fireEvent.click(grip!);
    expect(slot.navigateCalls).toEqual([]);
    fireEvent.click(card);
    expect(slot.navigateCalls).toEqual([{ method: "toPluginPanel", path: "tasks", options: { subPath: "task/TSK-1" } }]);
  });

  it("that cannot be dragged has no grip and leaves the finger to scroll", async () => {
    const { card, grip } = await renderBoard("priority");
    expect(grip).toBeNull();
    expect(card.className).not.toContain("touch-none");
  });

  it("is dragged by its grip", async () => {
    const { boardMove, grip } = await renderBoard();
    dragPastLast(grip!);
    await waitFor(() => expect(boardMove).toHaveBeenCalledTimes(1));
  });
});

describe("a card off a phone", () => {
  it.each([
    ["a wide screen", { narrow: false, coarse: false }],
    ["a narrow panel under a mouse", { narrow: true, coarse: false }],
    ["a wide touch screen", { narrow: false, coarse: true }],
  ])("on %s has no grip and is dragged by any point", async (_, given) => {
    media = given;
    const { boardMove, card, grip } = await renderBoard();
    expect(grip).toBeNull();
    dragPastLast(card);
    await waitFor(() => expect(boardMove).toHaveBeenCalledTimes(1));
  });
});
