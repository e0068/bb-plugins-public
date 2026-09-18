import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { conflictedFilesArgs, decideCatchUp, mergeAbortArgs, mergeBaseArgs, trackedChangesArgs } from "./catch-up";

const counts = fc.record({ behind: fc.nat(50), ahead: fc.nat(50), dirty: fc.boolean() });

describe("decideCatchUp — как подтянуть ветку к вершине базы", () => {
  it("незакоммиченные правки — отказ при любых счётчиках", () => {
    fc.assert(fc.property(counts, (c) => void expect(decideCatchUp({ ...c, dirty: true })).toBe("dirty")));
  });

  it("чистое дерево: не отстаёт — делать нечего, отстаёт без своих — перемотка, отстаёт со своими — слияние", () => {
    fc.assert(
      fc.property(counts, ({ behind, ahead }) => {
        const expected = behind === 0 ? "up-to-date" : ahead === 0 ? "fast-forward" : "merge";
        expect(decideCatchUp({ behind, ahead, dirty: false })).toBe(expected);
      }),
    );
  });
});

describe("команды подтягивания", () => {
  it("слияние базы без редактора, список конфликтов, отмена слияния, отслеживаемые правки", () => {
    expect(mergeBaseArgs("origin/main")).toEqual(["merge", "--no-edit", "origin/main"]);
    expect(conflictedFilesArgs()).toEqual(["diff", "--name-only", "--diff-filter=U"]);
    expect(mergeAbortArgs()).toEqual(["merge", "--abort"]);
    expect(trackedChangesArgs()).toEqual(["status", "--porcelain", "--untracked-files=no"]);
  });
});
