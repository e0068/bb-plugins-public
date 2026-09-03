import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore } from "../api/index.js";
import { runFileSync } from "./run.js";

interface Checkout {
  files: Record<string, string>;
  /** Repo-relative paths this worktree environment has actually changed —
   *  defaults to every file in `files`, since these fixtures build "the
   *  worktree touched exactly what it has" scenarios by default. Set
   *  explicitly to build a "stale worktree, hasn't touched this path"
   *  scenario instead. Ignored for `main`. */
  changedPaths?: string[];
  /** When set, this worktree's `projects.paths` call throws — exercises
   *  run.ts's per-worktree failure handling (skippedWorktrees). */
  scanFails?: boolean;
}

/** A fake bb host serving two checkouts of the same repo-relative path
 *  space: the project's main checkout, and one keyed by `environmentId`
 *  (a worktree) — exactly the routing `createBbFileReader` relies on. Also
 *  stubs the environment-diff and thread-list calls filesync/worktrees.ts
 *  and filesync/worktree-changes.ts need to recognize and scope a
 *  worktree. */
function setupHost(main: Checkout, worktrees: Record<string, Checkout> = {}) {
  const checkoutFor = (environmentId?: string): Checkout =>
    environmentId ? worktrees[environmentId]! : main;

  return createFakePluginHost({
    pluginId: "run-test",
    sdk: {
      projects: {
        paths: async ({ environmentId }: { environmentId?: string }) => {
          const checkout = checkoutFor(environmentId);
          if (checkout.scanFails) throw new Error("workspace unreachable");
          return {
            paths: Object.keys(checkout.files).map((path) => ({
              kind: "file" as const,
              name: path.split("/").pop()!,
              path,
              positions: [],
              score: 0,
            })),
            truncated: false,
          };
        },
        fileContent: async ({
          environmentId,
          path,
        }: {
          environmentId?: string;
          path: string;
        }) => ({
          content: checkoutFor(environmentId).files[path]!,
          contentEncoding: "utf8" as const,
          mimeType: "text/markdown",
          sizeBytes: 0,
        }),
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => ({
          baseBranch: "main",
          branchName: `claude/${environmentId}`,
          createdAt: 0,
          defaultBranch: "main",
          hostId: "host_1",
          id: environmentId,
          isGitRepo: true,
          isWorktree: true,
          managed: true,
          mergeBaseBranch: "main",
          name: environmentId,
          path: `/worktrees/${environmentId}`,
          projectId: "proj_x",
          status: "ready" as const,
          updatedAt: 0,
          workspaceProvisionType: "managed-worktree" as const,
        }),
        diffFiles: async ({ environmentId }: { environmentId: string }) => ({
          outcome: "available" as const,
          files: (
            worktrees[environmentId]?.changedPaths ??
            Object.keys(worktrees[environmentId]?.files ?? {})
          ).map((path) => ({
            additions: 1,
            binary: false,
            changeKind: "modified" as const,
            deletions: 0,
            loadMode: "auto" as const,
            origin: "tracked" as const,
            path,
            previousPath: null,
          })),
          initialPatches: [],
          mergeBaseRef: "abc123",
          shortstat: "",
          truncated: false,
        }),
      },
      threads: {
        list: async () =>
          Object.entries(worktrees).map(([environmentId, _checkout], index) => ({
            activity: {
              activeBackgroundAgentCount: 0,
              activeBackgroundCommandCount: 0,
              activeGoalCount: 0,
              activePlanModeCount: 0,
              activeWorkflowCount: 0,
            },
            archivedAt: null,
            createdAt: 0,
            deletedAt: null,
            environmentBranchName: `claude/${environmentId}`,
            environmentHostId: "host_1",
            environmentId,
            environmentName: environmentId,
            environmentWorkspaceDisplayKind: "managed-worktree" as const,
            hasPendingInteraction: false,
            id: `thr_${index}`,
            lastReadAt: null,
            latestAttentionAt: 0,
            originKind: null,
            originPluginId: null,
            parentThreadId: null,
            pinSortKey: null,
            pinnedAt: null,
            projectId: "proj_x",
            providerId: "claude",
            runtime: { displayStatus: "idle" as const, hostReconnectGraceExpiresAt: null },
            sectionId: null,
            sourceThreadId: null,
            status: "idle" as const,
            title: null,
            titleFallback: null,
            updatedAt: 500,
            visibility: "visible" as const,
          })),
      },
    },
  });
}

function setupProject(bb: Parameters<typeof createStore>[0]) {
  const store = createStore(bb);
  const project = store.tasks.createProject({
    name: "Files",
    prefix: "FS",
    color: "blue",
    linkedBbProjectId: "proj_x",
    tasksFolder: "memory/tasks",
  });
  return { store, project };
}

describe("runFileSync — main + active worktrees", () => {
  it("takes a changed, diverged file from an active worktree and still creates a worktree-only file", async () => {
    const { bb, harness } = setupHost(
      { files: { "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A (main)\n---\n" } },
      {
        env_1: {
          files: {
            "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A (work in progress)\n---\n",
            "memory/tasks/todo/b.md": "---\nslug: b\ntitle: B (new in worktree)\n---\n",
          },
        },
      },
    );
    try {
      const { store, project } = setupProject(bb);
      const [result] = await runFileSync(bb, store, { projectId: project.id });
      expect(result).toMatchObject({ created: 2, updated: 0, skippedWorktrees: 0 });

      const aTaskId = store.tasks.getFileTask(project.id, "a")?.taskId;
      expect(store.tasks.getTask(aTaskId!)?.title).toBe("A (work in progress)");
      expect(store.tasks.getFileTask(project.id, "a")?.origin).toEqual({
        kind: "worktree",
        environmentId: "env_1",
        name: "env_1",
        branchName: "claude/env_1",
      });

      const bTaskId = store.tasks.getFileTask(project.id, "b")?.taskId;
      expect(store.tasks.getTask(bTaskId!)?.title).toBe("B (new in worktree)");
      expect(store.tasks.getFileTask(project.id, "b")?.origin).toMatchObject({
        kind: "worktree",
        environmentId: "env_1",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("keeps main's file when the worktree's copy is byte-identical in mapped fields", async () => {
    const shared = "---\nslug: a\ntitle: A\n---\n";
    const { bb, harness } = setupHost(
      { files: { "memory/tasks/todo/a.md": shared } },
      { env_1: { files: { "memory/tasks/todo/a.md": shared } } },
    );
    try {
      const { store, project } = setupProject(bb);
      await runFileSync(bb, store, { projectId: project.id });
      expect(store.tasks.getFileTask(project.id, "a")?.origin).toEqual({
        kind: "main",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("keeps main's file when the worktree never changed it, even though main has since moved on", async () => {
    const { bb, harness } = setupHost(
      { files: { "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A (after merge)\n---\n" } },
      {
        env_1: {
          files: {
            "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A (before merge)\n---\n",
          },
          changedPaths: [],
        },
      },
    );
    try {
      const { store, project } = setupProject(bb);
      await runFileSync(bb, store, { projectId: project.id });
      const fileTask = store.tasks.getFileTask(project.id, "a");
      expect(fileTask?.origin).toEqual({ kind: "main" });
      expect(store.tasks.getTask(fileTask!.taskId)?.title).toBe("A (after merge)");
    } finally {
      await harness.dispose();
    }
  });

  it("reports a broken worktree as skipped instead of failing the project's sync", async () => {
    const { bb, harness } = setupHost(
      { files: { "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\n---\n" } },
      {
        env_broken: {
          files: { "memory/tasks/todo/b.md": "---\nslug: b\ntitle: B\n---\n" },
          scanFails: true,
        },
      },
    );
    try {
      const { store, project } = setupProject(bb);
      const [result] = await runFileSync(bb, store, { projectId: project.id });
      expect(result).toMatchObject({ created: 1, skippedWorktrees: 1 });
      expect(store.tasks.getFileTask(project.id, "a")?.origin).toEqual({
        kind: "main",
      });
      expect(store.tasks.getFileTask(project.id, "b")).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });
});
