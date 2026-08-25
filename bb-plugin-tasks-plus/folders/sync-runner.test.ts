import { describe, expect, it, vi } from "vitest";
import type { ProjectSyncResult } from "../filesync/run.js";
import { runFolderSync, type FolderSyncRunnerDeps } from "./sync-runner.js";
import { FolderSyncStatusStore, type FolderSyncKv } from "./status-store.js";

function fakeKv(): FolderSyncKv {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
}

function result(overrides: Partial<ProjectSyncResult> = {}): ProjectSyncResult {
  return {
    projectId: "p1",
    prefix: "TSK",
    tasksFolder: "memory/tasks",
    fileCount: 2,
    created: 1,
    updated: 1,
    adopted: 0,
    deleted: 0,
    unchanged: 0,
    invalid: [],
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<FolderSyncRunnerDeps> = {},
): FolderSyncRunnerDeps & { publishedProjectIds: string[] } {
  const publishedProjectIds: string[] = [];
  return {
    runFileSync: async () => [result()],
    hasFileLinks: () => false,
    statusStore: new FolderSyncStatusStore(fakeKv()),
    publish: (projectId) => publishedProjectIds.push(projectId),
    now: () => "2026-08-20T00:00:00.000Z",
    publishedProjectIds,
    ...overrides,
  };
}

describe("runFolderSync", () => {
  it("sets syncing, then synced with the summary, and publishes at both ends", async () => {
    const deps = makeDeps();
    await runFolderSync(deps, "p1");
    expect(deps.statusStore.peek("p1")).toEqual({
      kind: "synced",
      syncedAt: "2026-08-20T00:00:00.000Z",
      summary: { created: 1, updated: 1, adopted: 0, deleted: 0, invalid: 0 },
      invalidFiles: [],
    });
    // publish fires once entering "syncing" and once leaving with the result.
    expect(deps.publishedProjectIds).toEqual(["p1", "p1"]);
  });

  it("records invalid files in the summary count and the invalidFiles detail list", async () => {
    const runFileSync = vi.fn(async () => [
      result({
        invalid: [{ filePath: "memory/tasks/todo/a.md", reason: "bad yaml" }],
      }),
    ]);
    const deps = makeDeps({ runFileSync });
    await runFolderSync(deps, "p1");
    expect(deps.statusStore.peek("p1")).toEqual({
      kind: "synced",
      syncedAt: "2026-08-20T00:00:00.000Z",
      summary: { created: 1, updated: 1, adopted: 0, deleted: 0, invalid: 1 },
      invalidFiles: [{ path: "memory/tasks/todo/a.md", reason: "bad yaml" }],
    });
  });

  it("records a thrown scan failure as an error status without deleting anything", async () => {
    const runFileSync = vi.fn(async () => {
      throw new Error("project unreachable");
    });
    const deps = makeDeps({ runFileSync, hasFileLinks: () => true });
    await runFolderSync(deps, "p1");
    expect(deps.statusStore.peek("p1")).toEqual({
      kind: "error",
      failedAt: "2026-08-20T00:00:00.000Z",
      message: "project unreachable",
    });
    // Only the real (non-dry) call was attempted — no dry-run precedes a
    // thrown scan failure since the throw happens inside that same call.
    expect(runFileSync).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty scan when the project already has linked tasks", async () => {
    const runFileSync = vi.fn(async (options: { dryRun?: boolean }) => [
      result({ fileCount: 0, deleted: 3 }),
    ]);
    const deps = makeDeps({ runFileSync, hasFileLinks: () => true });
    await runFolderSync(deps, "p1");
    const status = deps.statusStore.peek("p1");
    expect(status.kind).toBe("error");
    // The dry-run preview short-circuited before any real (deleting) call.
    expect(runFileSync).toHaveBeenCalledTimes(1);
    expect(runFileSync).toHaveBeenCalledWith({ projectId: "p1", dryRun: true });
  });

  it("allows an empty scan when the project has no existing links (first connect)", async () => {
    const runFileSync = vi.fn(async () => [result({ fileCount: 0 })]);
    const deps = makeDeps({ runFileSync, hasFileLinks: () => false });
    await runFolderSync(deps, "p1");
    expect(deps.statusStore.peek("p1").kind).toBe("synced");
    // No linked tasks to protect, so no dry-run preview is needed.
    expect(runFileSync).toHaveBeenCalledTimes(1);
    expect(runFileSync).toHaveBeenCalledWith({ projectId: "p1" });
  });

  it("clears status when the project disappeared from the sync set mid-run", async () => {
    const deps = makeDeps({ runFileSync: async () => [] });
    await deps.statusStore.setSynced(
      "p1",
      { created: 1, updated: 0, adopted: 0, deleted: 0, invalid: 0 },
      [],
      "2026-08-19T00:00:00.000Z",
    );
    await runFolderSync(deps, "p1");
    expect(deps.statusStore.peek("p1")).toEqual({ kind: "not_synced" });
  });
});
