import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  currentTasksArgs,
  linkedTaskEnv,
  markTaskStatusArgs,
  parseLinkedTasks,
} from "./bb-tasks-commands";

describe("currentTasksArgs", () => {
  it("builds `tasks current --thread <id> --json`", () => {
    expect(currentTasksArgs("thr_abc")).toEqual([
      "tasks",
      "current",
      "--thread",
      "thr_abc",
      "--json",
    ]);
  });
});

describe("markTaskStatusArgs", () => {
  it("builds `tasks update <key> --status done --json`", () => {
    expect(markTaskStatusArgs("BBPL-1", "done")).toEqual([
      "tasks",
      "update",
      "BBPL-1",
      "--status",
      "done",
      "--json",
    ]);
  });

  it("builds `tasks update <key> --status in_review --json`", () => {
    expect(markTaskStatusArgs("BBPL-1", "in_review")).toEqual([
      "tasks",
      "update",
      "BBPL-1",
      "--status",
      "in_review",
      "--json",
    ]);
  });
});

describe("parseLinkedTasks", () => {
  it("reads key and title out of a real `bb tasks current --json` shape", () => {
    const stdout = JSON.stringify({
      threadId: "thr_abc",
      tasks: [
        { key: "BP-189", title: "Pull Request — названия", status: "in_progress" },
        { key: "BP-190", title: "Вторая" },
      ],
    });
    expect(parseLinkedTasks(stdout)).toEqual([
      { key: "BP-189", title: "Pull Request — названия" },
      { key: "BP-190", title: "Вторая" },
    ]);
  });

  it("a task without a string title keeps its key with an empty title", () => {
    const stdout = JSON.stringify({ tasks: [{ key: "BP-189" }, { key: "BP-190", title: 42 }] });
    expect(parseLinkedTasks(stdout)).toEqual([
      { key: "BP-189", title: "" },
      { key: "BP-190", title: "" },
    ]);
  });

  it("a task without a string key is dropped — a title alone names nothing", () => {
    expect(parseLinkedTasks(JSON.stringify({ tasks: [{ title: "no key" }] }))).toEqual([]);
  });

  it("law: never throws, for any JSON value at all", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => parseLinkedTasks(JSON.stringify(value))).not.toThrow();
      }),
    );
  });
});

describe("linkedTaskEnv", () => {
  // Без этой переменной Tasks+ смотрит только main, а до шага «Pull Main»
  // файл задачи лежит лишь в рабочем дереве треда — и список приходит пустым.
  it("names the thread whose tree the CLI must look into", () => {
    expect(linkedTaskEnv("thr_abc")).toEqual({ BB_THREAD_ID: "thr_abc" });
  });
});
