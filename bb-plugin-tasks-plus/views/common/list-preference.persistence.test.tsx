// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";

// Compact viewport so sort/filter menus render as clickable drawers in jsdom.
window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
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
// Модуль настроек списка тянет за собой вид фильтров, а тот — рантайм SDK:
// статический импорт поднял бы SDK раньше поддельного хоста, и регистрация
// приложения упала бы на `definePluginApp is not a function`.
const { LIST_PREFERENCE_STORAGE_KEY, loadListPreference } = await import("./list-preference.js");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT_A = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PROJECT_B = "01HZZZZZZZZZZZZZZZZZZZZZP2";

const projectA = {
  id: PROJECT_A,
  name: "Alpha",
  prefix: "ALP",
  nextTaskNumber: 5,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const projectB = {
  id: PROJECT_B,
  name: "Beta",
  prefix: "BET",
  nextTaskNumber: 5,
  color: "green",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(
  projectId: string,
  number: number,
  status: Task["status"],
  priority: Task["priority"] = "none",
): Task {
  const prefix = projectId === PROJECT_A ? "ALP" : "BET";
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZT${projectId.slice(-2)}${number}`,
    projectId,
    number,
    key: `${prefix}-${number}`,
    title: `Task ${number}`,
    description: "",
    status,
    priority,
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

const tasksA = [
  task(PROJECT_A, 1, "todo", "none"),
  task(PROJECT_A, 2, "todo", "urgent"),
  task(PROJECT_A, 3, "done", "low"),
];

const tasksB = [task(PROJECT_B, 1, "todo"), task(PROJECT_B, 2, "in_progress")];

function applyListFilters(
  tasks: Task[],
  input: {
    statuses?: readonly string[];
    priorities?: readonly string[];
  },
): Task[] {
  let next = tasks;
  if (input.statuses !== undefined && input.statuses.length > 0) {
    const allowed = new Set(input.statuses);
    next = next.filter((item) => allowed.has(item.status));
  }
  if (input.priorities !== undefined && input.priorities.length > 0) {
    const allowed = new Set(input.priorities);
    next = next.filter((item) => allowed.has(item.priority));
  }
  return next;
}

const LABEL_BUG = "01HZZZZZZZZZZZZZZZZZZZZLB1";
const LABEL_UX = "01HZZZZZZZZZZZZZZZZZZZZLB2";

const labelsA = [
  {
    id: LABEL_BUG,
    projectId: PROJECT_A,
    name: "Bug",
    color: "#ef4444",
  },
  {
    id: LABEL_UX,
    projectId: PROJECT_A,
    name: "UX",
    color: "#3b82f6",
  },
];

function baseRpc(overrides: Record<string, unknown> = {}) {
  const listTasksCalls: unknown[] = [];
  const rpc = {
    listProjects: () => ({ projects: [projectA, projectB] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listLabels: (input: { projectId: string }) => ({
      labels: input.projectId === PROJECT_A ? labelsA : [],
    }),
    listTasks: (input: {
      projectId?: string | null;
      activeOnly?: boolean;
      statuses?: readonly string[];
      priorities?: readonly string[];
      labelIds?: readonly string[];
    }) => {
      listTasksCalls.push(input);
      let tasks: Task[];
      if (input.activeOnly) {
        tasks = [
          task(PROJECT_A, 9, "in_progress", "high"),
          task(PROJECT_B, 9, "in_progress", "high"),
        ];
      } else if (input.projectId === PROJECT_A) {
        tasks = tasksA.map((item, index) =>
          index === 0
            ? { ...item, labelIds: [LABEL_BUG] }
            : index === 1
              ? { ...item, labelIds: [LABEL_UX] }
              : item,
        );
      } else if (input.projectId === PROJECT_B) {
        tasks = tasksB;
      } else {
        tasks = [...tasksA, ...tasksB];
      }
      let next = applyListFilters(tasks, input);
      if (input.labelIds !== undefined) {
        if (input.labelIds.length === 0) next = [];
        else {
          const allowed = new Set(input.labelIds);
          next = next.filter((item) =>
            item.labelIds.some((id) => allowed.has(id)),
          );
        }
      }
      return { tasks: next };
    },
    listTaskThreads: () => ({ taskThreads: [] }),
    listComments: () => ({ comments: [] }),
    listAttachments: () => ({ attachments: [] }),
    ...overrides,
  };
  return Object.assign(rpc, { listTasksCalls });
}

function renderProject(projectId: string) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: projectId },
    { rpc: baseRpc() },
  );
}

async function selectSort(
  slot: ReturnType<typeof renderProject>,
  label: string,
) {
  fireEvent.click(slot.getByRole("button", { name: "Sort" }));
  const drawer = await slot.findByRole("dialog", { name: "Sort tasks" });
  fireEvent.click(
    await within(drawer).findByRole("menuitemcheckbox", { name: label }),
  );
}

/** Picks `value` of the `facet` filter from the header's Filter menu, then closes its values. */
async function pickFilter(
  slot: ReturnType<typeof renderProject>,
  facet: string,
  value: RegExp,
) {
  fireEvent.click(slot.getByRole("button", { name: "Filter" }));
  const drawer = await slot.findByRole("dialog", { name: "Filter by" });
  fireEvent.click(await within(drawer).findByRole("menuitem", { name: facet }));
  fireEvent.click(await slot.findByRole("menuitemcheckbox", { name: value }));
  pageKeyboardEscape(slot);
}

/** The sort a list scope holds, as the header's Sort menu set it. */
const sortOf = (projectId: string) => loadListPreference(`project:${projectId}`).sort;

/** The number of active filters the header's Filter button carries on a compact screen. */
const filterBadge = (slot: ReturnType<typeof renderProject>) =>
  slot.getByRole("button", { name: "Filter" }).textContent;

describe("list filter/sort preference persistence", () => {

  it("remembers an explicit clear across remount", async () => {
    const registration = app.navPanels[0]!;
    // Seed a preference, then clear via UI.
    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scopes: {
          [`project:${PROJECT_A}`]: {
            filters: {
              statuses: ["done"],
              priorities: [],
              labelNames: [],
            },
            sort: "priority",
          },
        },
      }),
    );

    const slot = renderSlot(
      registration,
      { subPath: PROJECT_A },
      { rpc: baseRpc() },
    );
    await slot.findByText("ALP-3");
    fireEvent.click(slot.getByRole("button", { name: "Filter" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: /Clear all filters/ }));
    await waitFor(() => {
      expect(slot.queryByText("ALP-1")).not.toBeNull();
    });
    expect(filterBadge(slot)).toBe("");

    slot.lifecycle.unmount();
    const remounted = renderSlot(
      registration,
      { subPath: PROJECT_A },
      { rpc: baseRpc() },
    );
    await remounted.findByText("ALP-1");
    expect(filterBadge(remounted)).toBe("");
    expect(sortOf(PROJECT_A)).toBe("priority");
    // Filters cleared; sort still priority because Clear only resets filters.
    expect(remounted.getByText("ALP-2")).toBeDefined();
  });

  it("persists priority and label filters and sends resolved label ids", async () => {
    const registration = app.navPanels[0]!;
    const rpc = baseRpc();
    const slot = renderSlot(registration, { subPath: PROJECT_A }, { rpc });
    await slot.findByText("ALP-1");

    await pickFilter(slot, "Priority", /Urgent/);
    await pickFilter(slot, "Label", /Bug/);

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY)!,
      );
      expect(stored.scopes[`project:${PROJECT_A}`].filters.priorities).toEqual([
        "urgent",
      ]);
      expect(stored.scopes[`project:${PROJECT_A}`].filters.labelNames).toEqual([
        "Bug",
      ]);
    });

    await waitFor(() => {
      const withLabels = rpc.listTasksCalls.filter(
        (call): call is { labelIds?: string[]; priorities?: string[] } =>
          typeof call === "object" && call !== null,
      );
      expect(
        withLabels.some(
          (call) =>
            Array.isArray(call.labelIds) &&
            call.labelIds.includes(LABEL_BUG) &&
            Array.isArray(call.priorities) &&
            call.priorities.includes("urgent"),
        ),
      ).toBe(true);
    });

    slot.lifecycle.unmount();
    const remounted = renderSlot(
      registration,
      { subPath: PROJECT_A },
      { rpc: baseRpc() },
    );
    await waitFor(() => expect(filterBadge(remounted)).toBe("2"));
    expect(loadListPreference(`project:${PROJECT_A}`).filters).toMatchObject({ priorities: ["urgent"], labelNames: ["Bug"] });
  });

  it("matches nothing for stale label names once the catalog is loaded", async () => {
    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scopes: {
          [`project:${PROJECT_A}`]: {
            filters: {
              statuses: [],
              priorities: [],
              labelNames: ["DeletedLabel"],
            },
            sort: "manual",
          },
        },
      }),
    );
    const rpc = baseRpc();
    const slot = renderSlot(app.navPanels[0]!, { subPath: PROJECT_A }, { rpc });
    await waitFor(() => expect(filterBadge(slot)).toBe("1"));
    await waitFor(() => {
      expect(
        rpc.listTasksCalls.some(
          (call) =>
            typeof call === "object" &&
            call !== null &&
            Array.isArray((call as { labelIds?: unknown }).labelIds) &&
            (call as { labelIds: unknown[] }).labelIds.length === 0,
        ),
      ).toBe(true);
    });
    // Empty labelIds filter yields no rows (not the full unfiltered list).
    expect(slot.queryByText("ALP-1")).toBeNull();
    expect(slot.queryByText("ALP-2")).toBeNull();
  });
});

function pageKeyboardEscape(slot: ReturnType<typeof renderProject>): void {
  fireEvent.keyDown(slot.container.ownerDocument, { key: "Escape" });
}
