import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore } from "../api/index.js";
import { foldersRpcContract } from "./contract.js";
import { registerFolders } from "./index.js";

const BB_PROJECT_ID = "proj_bbplugins";

function bbProjectResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: BB_PROJECT_ID,
    name: "bb-plugins",
    kind: "standard" as const,
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
    sources: [
      {
        id: "src_1",
        projectId: BB_PROJECT_ID,
        hostId: "host_1",
        type: "local_path" as const,
        path: "/Users/e0068/Documents/Projects/bb-plugins",
        isDefault: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    ...overrides,
  };
}

function emptyFolder() {
  return { paths: [], truncated: false };
}

function setup(sdkOverrides: Record<string, unknown> = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      projects: {
        get: async () => bbProjectResponse(),
        list: async () => [bbProjectResponse()],
        paths: async () => emptyFolder(),
        fileContent: async () => {
          throw new Error("no files stubbed");
        },
        ...(sdkOverrides.projects as Record<string, unknown> | undefined),
      },
    },
  });
  const store = createStore(bb);
  registerFolders(bb, store);
  return { bb, harness, store };
}

async function listFolders(harness: ReturnType<typeof setup>["harness"]) {
  return foldersRpcContract.listSyncedFolders.output.parse(
    await harness.callRpc("listSyncedFolders", null),
  ).folders;
}

describe("folders RPC", () => {
  it("lists nothing when no folder is connected", async () => {
    const { harness } = setup();
    try {
      expect(await listFolders(harness)).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("connecting a folder creates a board, links it, and runs the initial sync", async () => {
    const { harness, store } = setup({
      projects: {
        paths: async () => ({
          paths: [
            {
              kind: "file",
              name: "task-one.md",
              path: "memory/tasks/todo/task-one.md",
              positions: [],
              score: 0,
            },
          ],
          truncated: false,
        }),
        fileContent: async () => ({
          content: "---\nslug: task-one\ntitle: Task One\n---\nBody\n",
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: 10,
        }),
      },
    });
    try {
      const result = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      if (!result.ok) throw new Error(result.error.message);
      expect(result.folder).toMatchObject({
        projectName: "bb-plugins",
        tasksFolder: "memory/tasks",
        linkedBbProjectId: BB_PROJECT_ID,
        linkedBbProjectName: "bb-plugins",
        repoPath: "/Users/e0068/Documents/Projects/bb-plugins",
        taskCount: 1,
        status: {
          kind: "synced",
          summary: { created: 1, updated: 0, adopted: 0, deleted: 0 },
        },
      });

      const project = store.tasks.getProject(result.folder.projectId);
      expect(project?.linkedBbProjectId).toBe(BB_PROJECT_ID);
      expect(store.tasks.listTasks({ projectId: result.folder.projectId })).toHaveLength(
        1,
      );

      const listed = await listFolders(harness);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.projectId).toBe(result.folder.projectId);
    } finally {
      await harness.dispose();
    }
  });

  it("reuses an already-linked project instead of creating a duplicate board", async () => {
    const { harness, store } = setup();
    try {
      const existing = store.tasks.createProject({
        name: "BB Plugins",
        prefix: "BBPL",
        color: "blue",
        linkedBbProjectId: BB_PROJECT_ID,
      });

      const result = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      if (!result.ok) throw new Error(result.error.message);
      expect(result.folder.projectId).toBe(existing.id);
      expect(store.tasks.listProjects()).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });

  it("refuses to connect the same bb project twice", async () => {
    const { harness } = setup();
    try {
      const first = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      expect(first.ok).toBe(true);

      const second = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/other",
        }),
      );
      expect(second).toMatchObject({
        ok: false,
        error: { code: "folder_already_connected" },
      });
    } finally {
      await harness.dispose();
    }
  });

  it("rejects an absolute or traversal-escaping tasksFolder input", async () => {
    const { harness } = setup();
    try {
      await expect(
        harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "/etc/passwd",
        }),
      ).rejects.toThrow();
      await expect(
        harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "../secrets",
        }),
      ).rejects.toThrow();
    } finally {
      await harness.dispose();
    }
  });

  it("removeSyncedFolder stops sync and keeps tasks by default, unlinking file_tasks", async () => {
    const { harness, store } = setup({
      projects: {
        paths: async () => ({
          paths: [
            {
              kind: "file",
              name: "task-one.md",
              path: "memory/tasks/todo/task-one.md",
              positions: [],
              score: 0,
            },
          ],
          truncated: false,
        }),
        fileContent: async () => ({
          content: "---\nslug: task-one\ntitle: Task One\n---\nBody\n",
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: 10,
        }),
      },
    });
    try {
      const added = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      if (!added.ok) throw new Error(added.error.message);
      const projectId = added.folder.projectId;
      const [task] = store.tasks.listTasks({ projectId });
      expect(task).toBeDefined();

      const removed = foldersRpcContract.removeSyncedFolder.output.parse(
        await harness.callRpc("removeSyncedFolder", {
          projectId,
          alsoDeleteTasks: false,
        }),
      );
      expect(removed).toEqual({ ok: true, deletedTaskCount: 0 });

      expect(store.tasks.getProject(projectId)?.tasksFolder).toBeNull();
      expect(store.tasks.listFileTasks(projectId)).toEqual([]);
      // The task itself survives — only the file link was removed.
      expect(store.tasks.getTask(task!.id)).toBeDefined();
      expect(await listFolders(harness)).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("removeSyncedFolder with alsoDeleteTasks removes the file-linked tasks", async () => {
    const { harness, store } = setup({
      projects: {
        paths: async () => ({
          paths: [
            {
              kind: "file",
              name: "task-one.md",
              path: "memory/tasks/todo/task-one.md",
              positions: [],
              score: 0,
            },
          ],
          truncated: false,
        }),
        fileContent: async () => ({
          content: "---\nslug: task-one\ntitle: Task One\n---\nBody\n",
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: 10,
        }),
      },
    });
    try {
      const added = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      if (!added.ok) throw new Error(added.error.message);
      const projectId = added.folder.projectId;
      const [task] = store.tasks.listTasks({ projectId });

      const removed = foldersRpcContract.removeSyncedFolder.output.parse(
        await harness.callRpc("removeSyncedFolder", {
          projectId,
          alsoDeleteTasks: true,
        }),
      );
      expect(removed).toEqual({ ok: true, deletedTaskCount: 1 });
      expect(store.tasks.getTask(task!.id)).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  it("syncFolderNow re-runs sync on demand", async () => {
    const { harness, store } = setup();
    try {
      const added = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      if (!added.ok) throw new Error(added.error.message);

      const result = foldersRpcContract.syncFolderNow.output.parse(
        await harness.callRpc("syncFolderNow", {
          projectId: added.folder.projectId,
        }),
      );
      expect(result.folder?.status.kind).toBe("synced");
    } finally {
      await harness.dispose();
    }
  });

  it("listSyncableBbProjects only lists bb projects with a local source, flagging connected ones", async () => {
    const remoteOnly = {
      ...bbProjectResponse({ id: "proj_remote", name: "Remote only" }),
      sources: [],
    };
    const { harness } = setup({
      projects: {
        list: async () => [bbProjectResponse(), remoteOnly],
      },
    });
    try {
      const added = foldersRpcContract.addSyncedFolder.output.parse(
        await harness.callRpc("addSyncedFolder", {
          bbProjectId: BB_PROJECT_ID,
          tasksFolder: "memory/tasks",
        }),
      );
      expect(added.ok).toBe(true);

      const { bbProjects } = foldersRpcContract.listSyncableBbProjects.output.parse(
        await harness.callRpc("listSyncableBbProjects", null),
      );
      expect(bbProjects).toEqual([
        {
          id: BB_PROJECT_ID,
          name: "bb-plugins",
          repoPath: "/Users/e0068/Documents/Projects/bb-plugins",
          alreadyConnected: true,
        },
      ]);
    } finally {
      await harness.dispose();
    }
  });
});
