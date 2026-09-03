import { describe, expect, it } from "vitest";
import type { MappedTaskFile } from "./map.js";
import { mergeFileScans, type WorktreeScan, type WorktreeSource } from "./merge.js";
import type { ScannedFile } from "./sync.js";

function mapped(overrides: Partial<MappedTaskFile> = {}): MappedTaskFile {
  return {
    slug: "a",
    title: "A",
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    planTokens: null,
    factTokens: null,
    dueDate: null,
    labels: [],
    parentRef: null,
    checks: [],
    ...overrides,
  };
}

function file(overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    mapped: mapped(),
    filePath: "memory/tasks/todo/a.md",
    contentSha: "sha-main",
    origin: { kind: "main" },
    ...overrides,
  };
}

function worktree(overrides: Partial<WorktreeSource> = {}): WorktreeSource {
  return {
    environmentId: "env_a",
    name: "agent-a",
    branchName: "claude/a",
    updatedAt: 1000,
    ...overrides,
  };
}

function worktreeFile(source: WorktreeSource, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return file({
    contentSha: "sha-worktree",
    origin: {
      kind: "worktree",
      environmentId: source.environmentId,
      name: source.name,
      branchName: source.branchName,
    },
    ...overrides,
  });
}

/** A WorktreeScan whose `changedPaths` defaults to every file it scanned —
 *  the common case in tests that aren't specifically about that set. */
function worktreeScan(
  source: WorktreeSource,
  files: ScannedFile[],
  overrides: Partial<Pick<WorktreeScan, "invalid" | "changedPaths">> = {},
): WorktreeScan {
  return {
    source,
    files,
    invalid: [],
    changedPaths: new Set(files.map((f) => f.filePath)),
    ...overrides,
  };
}

describe("mergeFileScans", () => {
  it("keeps main's file when no worktree touched the slug", () => {
    const main = { files: [file()], invalid: [] };
    const result = mergeFileScans(main, []);
    expect(result.files).toEqual([file()]);
  });

  it("keeps main's file when a worktree scanned it but the content is byte-for-byte the same task", () => {
    const main = { files: [file({ contentSha: "same" })], invalid: [] };
    const source = worktree();
    const wt = worktreeScan(source, [
      file({ contentSha: "same", origin: { kind: "main" } }),
    ]);
    const result = mergeFileScans(main, [wt]);
    expect(result.files).toEqual([file({ contentSha: "same" })]);
  });

  it("prefers the worktree's file when it changed that path and the content diverges from main", () => {
    const main = { files: [file({ contentSha: "sha-main" })], invalid: [] };
    const source = worktree();
    const diverged = worktreeFile(source);
    const wt = worktreeScan(source, [diverged]);
    const result = mergeFileScans(main, [wt]);
    expect(result.files).toEqual([diverged]);
  });

  it("includes a slug that exists only in a worktree, never in main", () => {
    const main = { files: [], invalid: [] };
    const source = worktree();
    const onlyInWorktree = worktreeFile(source, {
      mapped: mapped({ slug: "brand-new" }),
    });
    const wt = worktreeScan(source, [onlyInWorktree]);
    const result = mergeFileScans(main, [wt]);
    expect(result.files).toEqual([onlyInWorktree]);
  });

  it("keeps main's file when a worktree never touched the path, even if its stale copy differs from main", () => {
    // Simulates a worktree branched off an older main: it never changed
    // memory/tasks/todo/a.md itself, so `changedPaths` doesn't list it —
    // but main has since moved on (someone else's PR merged), so the
    // worktree's own on-disk copy is now content-different from main's.
    // Without the changedPaths gate this would be misread as "the worktree
    // diverged" and roll the board back to stale content.
    const main = { files: [file({ contentSha: "sha-main-after-merge" })], invalid: [] };
    const source = worktree();
    const staleUntouchedCopy = worktreeFile(source, { contentSha: "sha-main-before-merge" });
    const wt = worktreeScan(source, [staleUntouchedCopy], { changedPaths: new Set() });
    const result = mergeFileScans(main, [wt]);
    expect(result.files).toEqual([file({ contentSha: "sha-main-after-merge" })]);
  });

  it("breaks a tie between two diverging worktrees by most recent activity", () => {
    const main = { files: [file({ contentSha: "sha-main" })], invalid: [] };
    const stale = worktree({ environmentId: "env_stale", updatedAt: 100 });
    const fresh = worktree({ environmentId: "env_fresh", updatedAt: 200 });
    const staleFile = worktreeFile(stale, { contentSha: "sha-stale" });
    const freshFile = worktreeFile(fresh, { contentSha: "sha-fresh" });
    const result = mergeFileScans(main, [
      worktreeScan(stale, [staleFile]),
      worktreeScan(fresh, [freshFile]),
    ]);
    expect(result.files).toEqual([freshFile]);
  });

  it("breaks an exact-activity tie by environmentId, deterministically", () => {
    const main = { files: [file({ contentSha: "sha-main" })], invalid: [] };
    const first = worktree({ environmentId: "env_aaa", updatedAt: 500 });
    const second = worktree({ environmentId: "env_zzz", updatedAt: 500 });
    const firstFile = worktreeFile(first, { contentSha: "sha-first" });
    const secondFile = worktreeFile(second, { contentSha: "sha-second" });
    const result = mergeFileScans(main, [
      worktreeScan(second, [secondFile]),
      worktreeScan(first, [firstFile]),
    ]);
    expect(result.files).toEqual([firstFile]);
  });

  it("unions invalid files across main and every worktree, deduping by path with main winning", () => {
    const main = {
      files: [],
      invalid: [
        { filePath: "memory/tasks/todo/broken-main.md", reason: "bad yaml (main)" },
        { filePath: "memory/tasks/todo/shared-broken.md", reason: "bad yaml (main)" },
      ],
    };
    const source = worktree();
    const wt: WorktreeScan = {
      source,
      files: [],
      invalid: [
        { filePath: "memory/tasks/todo/broken-wt.md", reason: "bad yaml (wt)" },
        // Same path is invalid in this worktree's checkout too — a worktree
        // is a full checkout, so it commonly sees the exact same broken
        // frontmatter main does. Must not be double-counted.
        { filePath: "memory/tasks/todo/shared-broken.md", reason: "bad yaml (wt)" },
      ],
      changedPaths: new Set<string>(),
    };
    const result = mergeFileScans(main, [wt]);
    expect(result.invalid).toEqual([
      { filePath: "memory/tasks/todo/broken-main.md", reason: "bad yaml (main)" },
      { filePath: "memory/tasks/todo/shared-broken.md", reason: "bad yaml (main)" },
      { filePath: "memory/tasks/todo/broken-wt.md", reason: "bad yaml (wt)" },
    ]);
  });
});
