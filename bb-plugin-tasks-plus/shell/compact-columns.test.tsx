// @vitest-environment jsdom
// Колонки панели на телефоне: одна на экране, во всю ширину. Панель открывается
// на области — ради неё её и открыли, — навигация приходит кнопкой в топбаре и
// уходит, как только владелец куда-то перешёл.
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { createElement } from "react";

import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";

let compact = true;
window.matchMedia = (query: string) =>
  ({
    matches: query === COMPACT_VIEWPORT_QUERY ? compact : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

const app = await loadPluginApp(() => import("../app"));
const tasks = app.navPanels[0]!;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

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

const rpc = {
  listProjects: () => ({ projects: [project] }),
  listFolders: () => ({ folders: [] }),
  listPresets: () => ({ presets: [] }),
  sidebarSummary: () => ({ projects: [{ projectId: PROJECT_ID, taskCount: 0, activeAgentCount: 0 }] }),
  listTasks: () => ({ tasks: [] }),
  getTaskByKey: () => ({ task: null }),
  listLabels: () => ({ labels: [] }),
};

const open = (subPath = "all") => renderSlot(tasks, { subPath }, { rpc: rpc as never });

describe("панель Tasks+ на узком экране", () => {
  beforeEach(() => {
    compact = true;
  });

  it("открывается на области: навигации на экране нет", async () => {
    const slot = open();
    expect(await slot.findByRole("button", { name: "Show navigation" })).toBeTruthy();
    expect(slot.queryByRole("navigation")).toBeNull();
  });

  it("кнопка приводит навигацию, вторая — уводит обратно", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Show navigation" }));
    expect(await slot.findByRole("navigation")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Hide navigation" }));
    expect(slot.queryByRole("navigation")).toBeNull();
  });

  it("переход в навигации уступает экран области", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Show navigation" }));
    expect(await slot.findByRole("navigation")).toBeTruthy();
    slot.rerender(createElement(tasks.component, { subPath: PROJECT_ID }));
    expect(slot.queryByRole("navigation")).toBeNull();
  });
});

describe("та же панель на широком экране", () => {
  beforeEach(() => {
    compact = false;
  });

  it("держит навигацию и область рядом", async () => {
    const slot = open();
    expect(await slot.findByRole("navigation")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Hide navigation" })).toBeTruthy();
  });
});
