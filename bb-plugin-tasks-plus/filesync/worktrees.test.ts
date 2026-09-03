import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { listActiveWorktreeSources } from "./worktrees.js";

function thread(overrides: Record<string, unknown> = {}) {
  return {
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
    environmentBranchName: "claude/x",
    environmentHostId: "host_1",
    environmentId: "env_x",
    environmentName: "agent-x",
    environmentWorkspaceDisplayKind: "managed-worktree",
    hasPendingInteraction: false,
    id: "thr_x",
    lastReadAt: null,
    latestAttentionAt: 0,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinSortKey: null,
    pinnedAt: null,
    projectId: "proj_x",
    providerId: "claude",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: null,
    titleFallback: null,
    updatedAt: 1000,
    visibility: "visible",
    ...overrides,
  };
}

function setup(threads: ReturnType<typeof thread>[]) {
  return createFakePluginHost({
    pluginId: "worktrees-test",
    sdk: { threads: { list: async () => threads } },
  });
}

describe("listActiveWorktreeSources", () => {
  it("returns one source per environment backing a worktree thread", async () => {
    const { bb, harness } = setup([thread()]);
    try {
      const result = await listActiveWorktreeSources(bb, "proj_x");
      expect(result).toEqual([
        {
          environmentId: "env_x",
          name: "agent-x",
          branchName: "claude/x",
          updatedAt: 1000,
        },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("excludes threads with no environment or the project-default (non-worktree) environment", async () => {
    const { bb, harness } = setup([
      thread({ id: "thr_none", environmentId: null }),
      thread({
        id: "thr_main",
        environmentId: "env_main",
        environmentWorkspaceDisplayKind: "other",
      }),
    ]);
    try {
      expect(await listActiveWorktreeSources(bb, "proj_x")).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("excludes deleted threads", async () => {
    const { bb, harness } = setup([
      thread({ id: "thr_deleted", deletedAt: 500 }),
    ]);
    try {
      expect(await listActiveWorktreeSources(bb, "proj_x")).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("dedupes an environment shared by several threads, keeping the most recent", async () => {
    const { bb, harness } = setup([
      thread({ id: "thr_1", updatedAt: 100, environmentName: "old-name" }),
      thread({ id: "thr_2", updatedAt: 900, environmentName: "new-name" }),
      thread({ id: "thr_3", updatedAt: 400, environmentName: "mid-name" }),
    ]);
    try {
      const result = await listActiveWorktreeSources(bb, "proj_x");
      expect(result).toEqual([
        {
          environmentId: "env_x",
          name: "new-name",
          branchName: "claude/x",
          updatedAt: 900,
        },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("falls back to no worktrees when threads.list is unavailable, instead of throwing", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "worktrees-test" });
    try {
      expect(await listActiveWorktreeSources(bb, "proj_x")).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });
});
