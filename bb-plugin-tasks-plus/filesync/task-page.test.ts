import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "../shared/contract.js";
import { byLiveStatusFirst, parseTaskCursor, taskPage } from "./task-page.js";

function task(id: string, status: TaskStatus): Task {
  return {
    id,
    projectId: "p1",
    number: null,
    key: id,
    title: id,
    description: "",
    status,
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    labelIds: [],
    source: null,
  };
}

const ids = (tasks: readonly Task[]) => tasks.map((t) => t.id);

/** Every page of a list, followed through its cursors. */
function allPages(tasks: readonly Task[], limit: number): Task[][] {
  const pages: Task[][] = [];
  let offset: number | undefined = 0;
  do {
    const page = taskPage(tasks, limit, offset);
    pages.push(page.tasks);
    offset = page.nextCursor === null ? undefined : parseTaskCursor(page.nextCursor);
  } while (offset !== undefined);
  return pages;
}

describe("byLiveStatusFirst", () => {
  it("ставит todo, in_progress и in_review первыми, потом backlog, потом done и canceled", () => {
    const tasks = [
      task("d", "done"),
      task("b", "backlog"),
      task("c", "canceled"),
      task("r", "in_review"),
      task("t", "todo"),
      task("p", "in_progress"),
    ];
    expect(ids(byLiveStatusFirst(tasks))).toEqual(["r", "t", "p", "b", "d", "c"]);
  });

  it("внутри одной ступени сохраняет порядок доски", () => {
    const tasks = [task("t1", "todo"), task("b1", "backlog"), task("p1", "in_progress"), task("t2", "todo")];
    expect(ids(byLiveStatusFirst(tasks))).toEqual(["t1", "p1", "t2", "b1"]);
  });

  it("не трогает входной массив", () => {
    const tasks = [task("d", "done"), task("t", "todo")];
    byLiveStatusFirst(tasks);
    expect(ids(tasks)).toEqual(["d", "t"]);
  });
});

describe("taskPage", () => {
  const tasks = ["a", "b", "c", "d", "e"].map((id) => task(id, "todo"));

  it("отдаёт следующую страницу, пока задачи не кончились", () => {
    expect(allPages(tasks, 2).map(ids)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("страницы вместе — весь список в данном порядке, по одному разу каждая задача", () => {
    for (const limit of [1, 2, 3, 5, 6]) {
      expect(allPages(tasks, limit).flat().map((t) => t.id)).toEqual(ids(tasks));
    }
  });

  it("последняя полная страница не обещает следующей", () => {
    expect(taskPage(tasks, 5).nextCursor).toBeNull();
  });

  it("смещение за концом списка — пустая страница без следующей", () => {
    expect(taskPage(tasks, 2, 9)).toEqual({ tasks: [], nextCursor: null });
  });

  it("пустой список — одна пустая страница", () => {
    expect(taskPage([], 10)).toEqual({ tasks: [], nextCursor: null });
  });
});

describe("parseTaskCursor", () => {
  it("читает выданный курсор обратно", () => {
    const cursor = taskPage([task("a", "todo"), task("b", "todo")], 1).nextCursor;
    expect(cursor).not.toBeNull();
    expect(parseTaskCursor(cursor!)).toBe(1);
  });

  it.each(["", "abc", "-1", "1.5", "01x", " 2"])("отвергает чужой курсор %j", (raw) => {
    expect(parseTaskCursor(raw)).toBeUndefined();
  });
});
