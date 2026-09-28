import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { hasRenames, isDeletion, parseNulPaths, withDeletedPaths, type BranchFile, type GitFileStatus } from "./changed-files";

describe("isDeletion", () => {
  it("D — deletion", () => {
    expect(isDeletion("D")).toBe(true);
  });

  it("everything else — not a deletion (upsert)", () => {
    const others: GitFileStatus[] = ["?", "??", "A", "C", "M", "R", "U"];
    for (const status of others) expect(isDeletion(status)).toBe(false);
  });
});

describe("parseNulPaths", () => {
  it("пути с пробелом и кириллицей приходят как есть, хвостовой NUL не даёт пустого пути", () => {
    expect(parseNulPaths("docs/Vakhnin Sergei/задача.md\0a.md\0")).toEqual(["docs/Vakhnin Sergei/задача.md", "a.md"]);
  });

  it("пустой вывод — ни одного пути", () => {
    expect(parseNulPaths("")).toEqual([]);
  });
});

describe("withDeletedPaths", () => {
  it("старый путь переноса добавляется удалением, строка R остаётся", () => {
    expect(withDeletedPaths([{ path: "done/t.md", status: "R" }], ["in_review/t.md"])).toEqual([
      { path: "done/t.md", status: "R" },
      { path: "in_review/t.md", status: "D" },
    ]);
  });

  it("удаление, которое bb уже назвал, второй раз не добавляется", () => {
    const files: BranchFile[] = [{ path: "gone.md", status: "D" }];
    expect(withDeletedPaths(files, ["gone.md"])).toEqual(files);
  });

  it("каждый удалённый путь ровно одно удаление, исходные строки целы", () => {
    const path = fc.constantFrom("a.md", "b.md", "c.md", "d.md");
    const status = fc.constantFrom<GitFileStatus>("A", "D", "M", "R");
    fc.assert(
      fc.property(fc.uniqueArray(fc.record({ path, status }), { selector: (f) => f.path }), fc.array(path), (files, deleted) => {
        const result = withDeletedPaths(files, deleted);
        expect(result.slice(0, files.length)).toEqual(files);
        const deletions = result.filter((f) => isDeletion(f.status)).map((f) => f.path);
        expect(new Set(deletions).size).toBe(deletions.length);
        for (const gone of deleted) expect(deletions).toContain(gone);
      }),
    );
  });
});

describe("hasRenames", () => {
  it("есть строка R — переносы есть; без неё — нет", () => {
    expect(hasRenames([{ path: "a.md", status: "M" }, { path: "b.md", status: "R" }])).toBe(true);
    expect(hasRenames([{ path: "a.md", status: "M" }, { path: "c.md", status: "C" }, { path: "d.md", status: "D" }])).toBe(false);
  });
});
