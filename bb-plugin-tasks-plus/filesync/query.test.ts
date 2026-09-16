import { describe, it, expect } from "vitest";
import type { Task } from "../shared/contract.js";
import { filterTasks } from "./query.js";

function task(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    projectId: "p1",
    number: 1,
    key: "TSK-1",
    title: "Task",
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    labelIds: [],
    checks: [],
    source: null,
    ...overrides,
  };
}

describe("filterTasks", () => {
  it("без фильтров возвращает всё", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" })];
    expect(filterTasks(tasks, {})).toHaveLength(2);
  });

  it("фильтрует по статусу", () => {
    const tasks = [
      task({ id: "a", status: "todo" }),
      task({ id: "b", status: "done" }),
    ];
    const result = filterTasks(tasks, { statuses: ["done"] });
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  it("пустой массив статусов не пропускает ничего", () => {
    const tasks = [task({ id: "a" })];
    expect(filterTasks(tasks, { statuses: [] })).toHaveLength(0);
  });

  it("фильтрует по приоритету", () => {
    const tasks = [
      task({ id: "a", priority: "urgent" }),
      task({ id: "b", priority: "low" }),
    ];
    const result = filterTasks(tasks, { priorities: ["urgent"] });
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("фильтрует по метке — совпадение хотя бы одной", () => {
    const tasks = [
      task({ id: "a", labelIds: ["l1", "l2"] }),
      task({ id: "b", labelIds: ["l3"] }),
    ];
    const result = filterTasks(tasks, { labelIds: ["l2"] });
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("фильтрует по родителю, включая null (топ-уровень)", () => {
    const tasks = [
      task({ id: "a", parentTaskId: "parent1" }),
      task({ id: "b", parentTaskId: null }),
    ];
    expect(
      filterTasks(tasks, { parentTaskId: "parent1" }).map((t) => t.id),
    ).toEqual(["a"]);
    expect(
      filterTasks(tasks, { parentTaskId: null }).map((t) => t.id),
    ).toEqual(["b"]);
  });

  it("ищет по названию и описанию без учёта регистра", () => {
    const tasks = [
      task({ id: "a", title: "Fix Login Bug" }),
      task({ id: "b", description: "касается логина" }),
      task({ id: "d", title: "Unrelated" }),
    ];
    expect(filterTasks(tasks, { search: "логин" }).map((t) => t.id).sort()).toEqual(
      ["b"],
    );
    expect(filterTasks(tasks, { search: "login" }).map((t) => t.id).sort()).toEqual(
      ["a"],
    );
  });

  it("ищет по ключу задачи", () => {
    const tasks = [
      task({ id: "a", key: "TSK-42" }),
      task({ id: "b", key: "TSK-7" }),
    ];
    expect(filterTasks(tasks, { search: "tsk-42" }).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("фильтрует по активным и ждущим тредам", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })];
    expect(
      filterTasks(tasks, { activeTaskIds: new Set(["a"]) }).map((t) => t.id),
    ).toEqual(["a"]);
    expect(
      filterTasks(tasks, { waitingTaskIds: new Set(["b"]) }).map((t) => t.id),
    ).toEqual(["b"]);
  });

  it("комбинирует несколько фильтров через И", () => {
    const tasks = [
      task({ id: "a", status: "todo", priority: "high" }),
      task({ id: "b", status: "todo", priority: "low" }),
      task({ id: "c", status: "done", priority: "high" }),
    ];
    const result = filterTasks(tasks, { statuses: ["todo"], priorities: ["high"] });
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });
});
