// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

await loadPluginApp(() => import("../../app"));
const { TitleCell } = await import("./cells.js");

afterEach(cleanup);

// Задача, созданная в ветке треда, попадает в Active и Waiting раньше, чем в
// main: строка списка говорит, что задача живёт в ветке, как это делает
// карточка доски.

const base = {
  id: "b1:branch-task",
  projectId: "b1",
  number: null,
  key: "branch-task",
  title: "Branch task",
  description: "",
  status: "in_progress",
  priority: "none",
  type: null,
  estimate: null,
  parentTaskId: null,
  epicId: null,
  position: 0,
  labelIds: [],
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
} as unknown as Task;

function titleCell(task: Task) {
  return renderSlot(
    { component: () => <TitleCell task={task} depth={0} childCount={0} collapsed={false} onToggle={() => {}} /> },
    {},
    {},
  );
}

describe("строка списка помечает задачу ветки", () => {
  it("задача из дерева треда помечена веткой, в подсказке — имя ветки", () => {
    const slot = titleCell({
      ...base,
      source: {
        filePath: "/wt/tasks/in_progress/branch-task.md",
        origin: { kind: "worktree", environmentId: "env_w", name: null, branchName: "bb/branch" },
      },
    } as Task);
    const mark = slot.container.querySelector("[data-worktree-mark]");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("title")).toContain("Not merged into main");
    expect(mark?.getAttribute("title")).toContain("bb/branch");
    expect(slot.container.textContent).toContain("Branch task");
  });

  it("задача из main пометки не несёт", () => {
    const slot = titleCell({
      ...base,
      source: { filePath: "/main/tasks/in_progress/branch-task.md", origin: { kind: "main" } },
    } as Task);
    expect(slot.container.querySelector("[data-worktree-mark]")).toBeNull();
  });
});
