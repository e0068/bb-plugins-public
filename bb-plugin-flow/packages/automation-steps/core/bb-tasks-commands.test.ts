import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  currentTasksArgs,
  linkedTaskEnv,
  markTaskStatusArgs,
  parseLinkedTaskKeys,
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

describe("parseLinkedTaskKeys", () => {
  it("reads the keys out of a real `bb tasks current --json` shape", () => {
    const stdout = JSON.stringify({
      threadId: "thr_abc",
      tasks: [{ key: "BBPL-1", title: "x" }, { key: "BBPL-2", title: "y" }],
    });
    expect(parseLinkedTaskKeys(stdout)).toEqual(["BBPL-1", "BBPL-2"]);
  });

  it("no linked tasks → empty list", () => {
    expect(parseLinkedTaskKeys(JSON.stringify({ threadId: "thr_abc", tasks: [] }))).toEqual([]);
  });

  it("invalid JSON → empty list, no throw", () => {
    expect(parseLinkedTaskKeys("not json")).toEqual([]);
  });

  it("`tasks` missing or not an array → empty list", () => {
    expect(parseLinkedTaskKeys(JSON.stringify({ threadId: "thr_abc" }))).toEqual([]);
    expect(parseLinkedTaskKeys(JSON.stringify({ tasks: "oops" }))).toEqual([]);
  });

  it("a task without a string key is dropped, the rest survive", () => {
    const stdout = JSON.stringify({ tasks: [{ key: "BBPL-1" }, { title: "no key" }, { key: 42 }] });
    expect(parseLinkedTaskKeys(stdout)).toEqual(["BBPL-1"]);
  });

  it("top-level JSON is `null` or a non-object → empty list, no throw", () => {
    expect(parseLinkedTaskKeys("null")).toEqual([]);
    expect(parseLinkedTaskKeys("42")).toEqual([]);
    expect(parseLinkedTaskKeys('"oops"')).toEqual([]);
  });

  it("`tasks` contains `null` or a non-object entry → dropped, no throw", () => {
    expect(parseLinkedTaskKeys(JSON.stringify({ tasks: [null, { key: "BBPL-1" }, "oops"] }))).toEqual([
      "BBPL-1",
    ]);
  });

  it("property: every string key produced by a real payload round-trips", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 })), (keys) => {
        const stdout = JSON.stringify({ tasks: keys.map((key) => ({ key })) });
        expect(parseLinkedTaskKeys(stdout)).toEqual(keys);
      }),
    );
  });

  it("law: never throws, for any JSON value at all", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => parseLinkedTaskKeys(JSON.stringify(value))).not.toThrow();
      }),
    );
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

  it("law: the keys agree with parseLinkedTaskKeys on any payload", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const stdout = JSON.stringify(value);
        expect(parseLinkedTasks(stdout).map((task) => task.key)).toEqual(
          parseLinkedTaskKeys(stdout),
        );
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
