import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { issueKeys, type IssuableTask } from "./key-issue";

const task = (id: string, over: Partial<IssuableTask> = {}): IssuableTask => ({
  id,
  key: id,
  number: null,
  parentTaskId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const named = (id: string, number: number): IssuableTask => task(id, { key: `P-${number}`, number });

describe("issueKeys", () => {
  it("numbers the unnamed tasks after the largest number on the board", () => {
    expect(issueKeys([named("a", 7), task("b"), named("c", 3)], "P")).toEqual([{ id: "b", key: "P-8", number: 8 }]);
  });

  it("skips numbers held out of sight — in the board's main checkout", () => {
    expect(issueKeys([named("a", 2), task("b")], "P", ["P-9"])).toEqual([{ id: "b", key: "P-10", number: 10 }]);
  });

  it("starts at 1 on a board with no number yet", () => {
    expect(issueKeys([task("a")], "P")).toEqual([{ id: "a", key: "P-1", number: 1 }]);
  });

  it("names a parent before its child, and older tasks first at one depth", () => {
    const tasks = [
      task("child", { parentTaskId: "epic", createdAt: "2026-10-01T00:00:00.000Z" }),
      task("late", { createdAt: "2026-10-03T00:00:00.000Z" }),
      task("epic", { createdAt: "2026-10-02T00:00:00.000Z" }),
    ];
    expect(issueKeys(tasks, "P").map(({ id, key }) => [id, key])).toEqual([
      ["epic", "P-1"],
      ["late", "P-2"],
      ["child", "P-3"],
    ]);
  });

  it("numbers by age, not by name, at one depth", () => {
    const tasks = [task("a-young", { createdAt: "2026-10-05T00:00:00.000Z" }), task("z-old", { createdAt: "2026-09-01T00:00:00.000Z" })];
    expect(issueKeys(tasks, "P").map(({ id }) => id)).toEqual(["z-old", "a-young"]);
  });

  it("survives a parent loop written by hand", () => {
    expect(issueKeys([task("a", { parentTaskId: "b" }), task("b", { parentTaskId: "a" })], "P")).toHaveLength(2);
  });

  it("gives every unnamed task a fresh number, none taken, and nothing on a second run", () => {
    const board = fc.array(fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }), { maxLength: 30 });
    fc.assert(
      fc.property(board, (numbers) => {
        const tasks = numbers.map((n, i) => (n === null ? task(`t${i}`) : named(`t${i}`, n)));
        const issued = issueKeys(tasks, "P");
        const taken = new Set(tasks.flatMap((t) => (t.number === null ? [] : [t.number])));
        expect(issued).toHaveLength(numbers.filter((n) => n === null).length);
        expect(new Set(issued.map((i) => i.number)).size).toBe(issued.length);
        expect(issued.every((i) => !taken.has(i.number))).toBe(true);
        const after = tasks.map((t) => {
          const got = issued.find((i) => i.id === t.id);
          return got === undefined ? t : { ...t, key: got.key, number: got.number };
        });
        expect(issueKeys(after, "P")).toEqual([]);
      }),
    );
  });
});
