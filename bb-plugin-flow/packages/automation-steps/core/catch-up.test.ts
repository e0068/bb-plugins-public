import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { conflictedFilesArgs, decideCatchUp, IN_PROGRESS_REFS, inProgressArgs, mergeAbortArgs, mergeBaseArgs, resetToBaseArgs, trackedChangesArgs } from "./catch-up";

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

describe("decideCatchUp — ветка, чьё содержимое уже в базе", () => {
  it("отстаёт со своими коммитами, но содержимое уже в базе — ветка доводится до базы", () => {
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false, mergedContent: "merged" })).toBe("reset-to-base");
  });

  it("неизмеренное и неслитое содержимое оставляют слияние", () => {
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false, mergedContent: "not-merged" })).toBe("merge");
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false, mergedContent: "unknown" })).toBe("merge");
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false })).toBe("merge");
  });

  it("грязное дерево и отсутствие отставания сильнее слитого содержимого", () => {
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: true, mergedContent: "merged" })).toBe("dirty");
    expect(decideCatchUp({ behind: 0, ahead: 6, dirty: false, mergedContent: "merged" })).toBe("up-to-date");
  });
});

describe("команды подтягивания", () => {
  it("доведение ветки до базы", () => {
    expect(resetToBaseArgs("origin/main")).toEqual(["reset", "--hard", "origin/main"]);
  });

  it("слияние базы без редактора, список конфликтов, отмена слияния, отслеживаемые правки", () => {
    expect(mergeBaseArgs("origin/main")).toEqual(["merge", "--no-edit", "origin/main"]);
    expect(conflictedFilesArgs()).toEqual(["diff", "--name-only", "--diff-filter=U"]);
    expect(mergeAbortArgs()).toEqual(["merge", "--abort"]);
    expect(trackedChangesArgs()).toEqual(["status", "--porcelain", "--untracked-files=no"]);
  });
});

describe("decideCatchUp — ветка, поработавшая после мёрджа", () => {
  it("часть ветки уже в базе — новая работа переносится на базу", () => {
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false, mergedContent: "not-merged", mergedCutoff: "abc123" })).toBe("replay-onto-base");
  });

  it("среза не нашли — прежнее слияние", () => {
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false, mergedContent: "not-merged", mergedCutoff: null })).toBe("merge");
  });

  it("вся ветка в базе — доведение до базы сильнее переноса", () => {
    expect(decideCatchUp({ behind: 4, ahead: 6, dirty: false, mergedContent: "merged", mergedCutoff: "abc123" })).toBe("reset-to-base");
  });
});

describe("незаконченные операции в дереве", () => {
  it("проверяются не только слияния: остановленный rebase, cherry-pick и revert тоже", () => {
    expect(IN_PROGRESS_REFS.map((x) => x.ref)).toEqual(["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]);
    expect(inProgressArgs("REBASE_HEAD")).toEqual(["rev-parse", "-q", "--verify", "REBASE_HEAD"]);
  });
});
