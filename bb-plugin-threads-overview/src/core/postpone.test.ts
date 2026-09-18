import { describe, expect, it } from "vitest";
import {
  addMark,
  dropMark,
  hasMark,
  toEntries,
  type PostponedMap,
} from "./postpone";

describe("addMark", () => {
  it("adds a mark without mutating the input", () => {
    const before: PostponedMap = {};
    const after = addMark(before, "t1", 1000);
    expect(after).toEqual({ t1: 1000 });
    expect(before).toEqual({});
  });

  it("overwrites the timestamp of an existing mark", () => {
    expect(addMark({ t1: 1000 }, "t1", 2000)).toEqual({ t1: 2000 });
  });
});

describe("dropMark", () => {
  it("removes a mark without mutating the input", () => {
    const before: PostponedMap = { t1: 1000, t2: 2000 };
    const after = dropMark(before, "t1");
    expect(after).toEqual({ t2: 2000 });
    expect(before).toEqual({ t1: 1000, t2: 2000 });
  });

  it("returns the same reference when there is nothing to drop", () => {
    const before: PostponedMap = { t1: 1000 };
    expect(dropMark(before, "absent")).toBe(before);
  });
});

describe("hasMark", () => {
  it("is true only for present threads", () => {
    expect(hasMark({ t1: 1000 }, "t1")).toBe(true);
    expect(hasMark({ t1: 1000 }, "t2")).toBe(false);
  });
});

describe("toEntries", () => {
  it("turns the map into threadId/at pairs", () => {
    expect(toEntries({ t1: 1000, t2: 2000 })).toEqual([
      { threadId: "t1", at: 1000 },
      { threadId: "t2", at: 2000 },
    ]);
  });

  it("is empty for an empty map", () => {
    expect(toEntries({})).toEqual([]);
  });
});
