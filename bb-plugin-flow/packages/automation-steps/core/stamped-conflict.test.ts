import { describe, expect, it } from "vitest";

import { decideStampedConflict, mergeTreeNamesArgs, parseMergeConflict, treeDiffArgs } from "./stamped-conflict";

const TREE = "83c99fce74321c0bbe9b3c67361a5c41006f43dd";
const CHANGELOG = "bb-plugin-flow/changelog/zadacha-done.md";
const TASK = "docs/tasks/done/bbpl-982.md";

describe("конфликт, который оставляет только проставленный пункт ченж-лога", () => {
  it("merge-tree просит имена конфликтных файлов, а diff — имена различий с деревом слияния", () => {
    expect(mergeTreeNamesArgs("origin/main")).toEqual(["merge-tree", "--write-tree", "--name-only", "origin/main", "HEAD"]);
    expect(treeDiffArgs("origin/main", TREE)).toEqual(["diff", "--name-only", "origin/main", TREE]);
  });

  it("из вывода merge-tree берётся дерево и пути до пустой строки, сообщения после неё пропускаются", () => {
    const stdout = `${TREE}\n${CHANGELOG}\n${TASK}\n\nAuto-merging x\nCONFLICT (add/add): Merge conflict in ${CHANGELOG}\n`;
    expect(parseMergeConflict(stdout)).toEqual({ tree: TREE, paths: [CHANGELOG, TASK] });
  });

  it("пустой вывод не даёт ни дерева, ни путей", () => {
    expect(parseMergeConflict("")).toEqual({ tree: "", paths: [] });
  });

  it("конфликт только в пункте ченж-лога и задаче, различий с main больше нет — код в main", () => {
    expect(decideStampedConflict({ paths: [CHANGELOG, TASK], differing: [CHANGELOG] })).toBe(true);
  });

  it("конфликт только в пункте ченж-лога, но ветка несёт ещё файл, которого в main нет — не в main", () => {
    expect(decideStampedConflict({ paths: [CHANGELOG], differing: [CHANGELOG, "packages/x/code.ts"] })).toBe(false);
  });

  it("конфликт в коде — не в main, даже если рядом конфликтует ченж-лог", () => {
    expect(decideStampedConflict({ paths: [CHANGELOG, "packages/x/code.ts"], differing: [CHANGELOG, "packages/x/code.ts"] })).toBe(false);
  });

  it("конфликтных путей нет — это не тот случай, ответ «не в main»", () => {
    expect(decideStampedConflict({ paths: [], differing: [] })).toBe(false);
  });
});
