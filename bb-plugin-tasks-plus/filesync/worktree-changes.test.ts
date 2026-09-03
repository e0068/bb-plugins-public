import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { changedFilePaths } from "./worktree-changes.js";

function environment(overrides: Record<string, unknown> = {}) {
  return {
    baseBranch: "main",
    branchName: "claude/x",
    createdAt: 0,
    defaultBranch: "main",
    hostId: "host_1",
    id: "env_x",
    isGitRepo: true,
    isWorktree: true,
    managed: true,
    mergeBaseBranch: "main",
    name: "agent-x",
    path: "/repo",
    projectId: "proj_x",
    status: "ready" as const,
    updatedAt: 0,
    workspaceProvisionType: "managed-worktree" as const,
    ...overrides,
  };
}

function diffFile(overrides: Record<string, unknown> = {}) {
  return {
    additions: 1,
    binary: false,
    changeKind: "modified" as const,
    deletions: 1,
    loadMode: "auto" as const,
    origin: "tracked" as const,
    path: "memory/tasks/todo/a.md",
    previousPath: null,
    ...overrides,
  };
}

describe("changedFilePaths", () => {
  it("returns the changed paths, including a renamed file's previous path", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "worktree-changes-test",
      sdk: {
        environments: {
          get: async () => environment(),
          diffFiles: async () => ({
            outcome: "available" as const,
            files: [
              diffFile({ path: "memory/tasks/in_progress/a.md" }),
              diffFile({
                path: "memory/tasks/todo/b.md",
                previousPath: "memory/tasks/backlog/b.md",
                changeKind: "renamed" as const,
              }),
            ],
            initialPatches: [],
            mergeBaseRef: "abc123",
            shortstat: "",
            truncated: false,
          }),
        },
      },
    });
    try {
      const result = await changedFilePaths(bb, "env_x");
      expect(result).toEqual(
        new Set([
          "memory/tasks/in_progress/a.md",
          "memory/tasks/todo/b.md",
          "memory/tasks/backlog/b.md",
        ]),
      );
    } finally {
      await harness.dispose();
    }
  });

  it("returns an empty set when the environment has no merge base", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "worktree-changes-test",
      sdk: {
        environments: {
          get: async () => environment({ mergeBaseBranch: null }),
          diffFiles: async () => {
            throw new Error("must not be called without a merge base");
          },
        },
      },
    });
    try {
      expect(await changedFilePaths(bb, "env_x")).toEqual(new Set());
    } finally {
      await harness.dispose();
    }
  });

  it("returns an empty set when the diff is not available", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "worktree-changes-test",
      sdk: {
        environments: {
          get: async () => environment(),
          diffFiles: async () => ({
            outcome: "unavailable" as const,
            failure: {
              code: "not_worktree" as const,
              message: "not a worktree",
              workspacePath: "/repo",
            },
          }),
        },
      },
    });
    try {
      expect(await changedFilePaths(bb, "env_x")).toEqual(new Set());
    } finally {
      await harness.dispose();
    }
  });

  it("falls back to an empty set instead of throwing when the calls are unavailable", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "worktree-changes-test",
    });
    try {
      expect(await changedFilePaths(bb, "env_x")).toEqual(new Set());
    } finally {
      await harness.dispose();
    }
  });
});
