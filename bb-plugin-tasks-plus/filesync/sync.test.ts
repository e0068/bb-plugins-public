import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createTasksStore, type FileTaskOrigin } from "../db";
import { scanTaskFolder, type FileReader } from "./scan.js";
import { syncProjectFiles } from "./sync.js";

function reader(files: Record<string, string>): FileReader {
  return {
    listPaths: async () => Object.keys(files),
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
  };
}

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "fs-sync-test" });
  const store = createTasksStore(bb.storage.database());
  const project = store.createProject({
    name: "Files",
    prefix: "FS",
    color: "blue",
    linkedBbProjectId: "proj_x",
    tasksFolder: "memory/tasks",
  });
  return { store, project, harness };
}

async function sync(
  store: ReturnType<typeof createTasksStore>,
  project: { id: string },
  files: Record<string, string>,
  origin?: FileTaskOrigin,
) {
  const { files: scanned, invalid } = await scanTaskFolder(
    reader(files),
    "memory/tasks",
    origin,
  );
  return syncProjectFiles(store, project as never, scanned, {
    invalidFilePaths: new Set(invalid.map((f) => f.filePath)),
  });
}

describe("syncProjectFiles + scanTaskFolder", () => {
  it("creates tasks from frontmatter, folder status, and parent by slug", async () => {
    const { store, project, harness } = setup();
    try {
      const summary = await sync(store, project, {
        "memory/tasks/todo/a.md": [
          "---",
          "slug: a",
          "title: Task A",
          "type: bugfix",
          "estimate: m",
          "priority: high",
          "tokens: 120k",
          "tokens_actual: 140k",
          "checks: [test, review]",
          "labels: [frontend]",
          "---",
          "body",
        ].join("\n"),
        "memory/tasks/backlog/b.md": "---\nslug: b\ntitle: B\nparent: a\n---\n",
        "memory/tasks/nonsense/c.md": "---\nslug: c\ntitle: C\n---\n",
      });
      expect(summary.created).toBe(2); // c is under an unknown status → skipped

      const aId = store.getFileTask(project.id, "a")?.taskId;
      const a = aId ? store.getTask(aId) : undefined;
      expect(a?.status).toBe("todo");
      expect(a?.type).toBe("bugfix");
      expect(a?.estimate).toBe("m");
      expect(a?.priority).toBe("high");
      expect(a?.description).toBe("body");
      expect(a?.planTokens).toBe(120_000);
      expect(a?.factTokens).toBe(140_000);
      expect(store.listTaskChecks(aId!)).toEqual(["review", "test"]);
      expect(store.listLabelsForTask(aId!).map((l) => l.name)).toEqual([
        "frontend",
      ]);

      const bId = store.getFileTask(project.id, "b")?.taskId;
      const b = bId ? store.getTask(bId) : undefined;
      expect(b?.status).toBe("backlog");
      expect(b?.parentTaskId).toBe(aId);
    } finally {
      await harness.dispose();
    }
  });

  it("rewrites the description when the body changes, body only", async () => {
    const { store, project, harness } = setup();
    try {
      const head = "---\nslug: a\ntitle: A\n---\n";
      await sync(store, project, {
        "memory/tasks/todo/a.md": `${head}# First\n\nOriginal text.\n`,
      });
      const aId = store.getFileTask(project.id, "a")?.taskId;
      expect(store.getTask(aId!)?.description).toBe("# First\n\nOriginal text.");

      await sync(store, project, {
        "memory/tasks/todo/a.md": `${head}# First\n\nOriginal text.\n\n## Added later\n`,
      });
      expect(store.getTask(aId!)?.description).toBe(
        "# First\n\nOriginal text.\n\n## Added later",
      );
      // The frontmatter never mentioned the body, so nothing else moved.
      expect(store.getTask(aId!)?.title).toBe("A");
      expect(store.getTask(aId!)?.status).toBe("todo");
    } finally {
      await harness.dispose();
    }
  });

  it("never clears a description the file has nothing to say about", async () => {
    const { store, project, harness } = setup();
    try {
      const head = "---\nslug: a\ntitle: A\n---\n";
      await sync(store, project, { "memory/tasks/todo/a.md": `${head}Text.` });
      const aId = store.getFileTask(project.id, "a")?.taskId;

      // A file that is frontmatter only carries no description — the text on
      // the card stays, whether it came from an earlier body or was typed in.
      await sync(store, project, { "memory/tasks/todo/a.md": head });
      expect(store.getTask(aId!)?.description).toBe("Text.");
      expect(store.getTask(aId!)?.title).toBe("A");
    } finally {
      await harness.dispose();
    }
  });

  it("skips a file whose task is unchanged, however much the bytes moved", async () => {
    const { store, project, harness } = setup();
    try {
      await sync(store, project, {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\nowner: x\n---\nBody\n",
      });
      // Same task, different bytes: CRLF, trailing blank lines, and two keys
      // the mapping does not read. The digest covers the mapped task, so none
      // of this is an update...
      const same = await sync(store, project, {
        "memory/tasks/todo/a.md":
          "---\r\nslug: a\r\ntitle: A\r\nowner: y\r\nkey: ABC-1\r\n---\r\nBody\r\n\n\n",
      });
      expect(same).toMatchObject({ unchanged: 1, updated: 0 });

      // ...while a field the mapping does read still is.
      const moved = await sync(store, project, {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: B\n---\nBody\n",
      });
      expect(moved).toMatchObject({ unchanged: 0, updated: 1 });
    } finally {
      await harness.dispose();
    }
  });

  it("keeps a whole file with no frontmatter as the description", async () => {
    const { store, project, harness } = setup();
    try {
      await sync(store, project, {
        "memory/tasks/todo/plain.md": "# Plain\n\nNo frontmatter here.\n",
      });
      const id = store.getFileTask(project.id, "plain")?.taskId;
      expect(store.getTask(id!)?.title).toBe("plain"); // slug from the filename
      expect(store.getTask(id!)?.description).toBe("# Plain\n\nNo frontmatter here.");
    } finally {
      await harness.dispose();
    }
  });

  it("updates on change, moves status by folder, and skips unchanged", async () => {
    const { store, project, harness } = setup();
    try {
      const v1 = {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\nestimate: m\n---\n",
        "memory/tasks/backlog/b.md": "---\nslug: b\ntitle: B\n---\n",
      };
      await sync(store, project, v1);

      const v2 = {
        // a moved todo → in_progress and estimate m → l
        "memory/tasks/in_progress/a.md":
          "---\nslug: a\ntitle: A\nestimate: l\n---\n",
        // b unchanged
        "memory/tasks/backlog/b.md": v1["memory/tasks/backlog/b.md"],
      };
      const summary = await sync(store, project, v2);
      expect(summary.updated).toBe(1);
      expect(summary.unchanged).toBe(1);

      const aId = store.getFileTask(project.id, "a")?.taskId;
      expect(store.getTask(aId!)?.status).toBe("in_progress");
      expect(store.getTask(aId!)?.estimate).toBe("l");
    } finally {
      await harness.dispose();
    }
  });

  it("deletes the task when its file disappears", async () => {
    const { store, project, harness } = setup();
    try {
      await sync(store, project, {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\n---\n",
        "memory/tasks/todo/b.md": "---\nslug: b\ntitle: B\n---\n",
      });
      const summary = await sync(store, project, {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\n---\n",
      });
      expect(summary.deleted).toBe(1);
      expect(summary.unchanged).toBe(1);
      expect(store.getFileTask(project.id, "b")).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  it("adopts an existing task by legacy marker slug instead of creating a duplicate", async () => {
    const { store, project, harness } = setup();
    try {
      const legacy = store.createTask({
        projectId: project.id,
        title: "WGSL groups (legacy)",
        description:
          "Body text.\n\n---\nSource: memory/tasks/backlog/wgsl-e2-groups.md · slug: wgsl-e2-groups\n",
      });
      const summary = await sync(store, project, {
        "memory/tasks/backlog/wgsl-e2-groups.md": [
          "---",
          "slug: wgsl-e2-groups",
          "title: WGSL groups",
          "---",
          "body",
        ].join("\n"),
      });

      expect(summary.adopted).toBe(1);
      expect(summary.created).toBe(0);

      const fileTask = store.getFileTask(project.id, "wgsl-e2-groups");
      expect(fileTask?.taskId).toBe(legacy.id);
      // The file has a body, so it wins; had it been frontmatter only, the
      // hand-written text and its legacy marker would have had to survive.
      expect(store.getTask(legacy.id)?.description).toBe("body");
      // No duplicate task was created for this file.
      const allTasks = store.listTasks({ projectId: project.id });
      expect(allTasks.map((task) => task.id)).toEqual([legacy.id]);
    } finally {
      await harness.dispose();
    }
  });

  it("adopting on a bodyless file keeps the hand-written text and its marker", async () => {
    const { store, project, harness } = setup();
    try {
      const description =
        "Hand-written on the board.\n\n---\nSource: memory/tasks/backlog/x.md · slug: x\n";
      const legacy = store.createTask({
        projectId: project.id,
        title: "X (legacy)",
        description,
      });
      const summary = await sync(store, project, {
        "memory/tasks/backlog/x.md": "---\nslug: x\ntitle: X\n---\n",
      });
      expect(summary.adopted).toBe(1);
      expect(store.getTask(legacy.id)?.description).toBe(description);
    } finally {
      await harness.dispose();
    }
  });

  it("creates a new task when no legacy marker matches the file's slug", async () => {
    const { store, project, harness } = setup();
    try {
      store.createTask({
        projectId: project.id,
        title: "Unrelated legacy task",
        description: "Source: some/other/path.md · slug: some-other-slug\n",
      });

      const summary = await sync(store, project, {
        "memory/tasks/backlog/new-file.md": "---\nslug: new-file\ntitle: New\n---\n",
      });

      expect(summary.adopted).toBe(0);
      expect(summary.created).toBe(1);
      // The unmatched legacy task is untouched: still no file_tasks link.
      const allTasks = store.listTasks({ projectId: project.id });
      expect(allTasks).toHaveLength(2);
    } finally {
      await harness.dispose();
    }
  });

  it("leaves a task with no matching file alone — never deletes it", async () => {
    const { store, project, harness } = setup();
    try {
      const orphan = store.createTask({
        projectId: project.id,
        title: "No matching file",
        description: "Source: gone/path.md · slug: gone-slug\n",
      });

      const summary = await sync(store, project, {
        "memory/tasks/backlog/other.md": "---\nslug: other\ntitle: Other\n---\n",
      });

      expect(summary.deleted).toBe(0);
      expect(store.getTask(orphan.id)).toBeDefined();
      expect(store.getFileTaskByTaskId(orphan.id)).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  it("marks a file with a colon-broken title INVALID and does not create a card for it", async () => {
    const { store, project, harness } = setup();
    try {
      const summary = await sync(store, project, {
        "memory/tasks/todo/a.md":
          "---\ntitle: Custom plugin: rings\n---\nbody",
      });
      expect(summary.invalid).toBe(1);
      expect(summary.created).toBe(0);
      expect(store.getFileTask(project.id, "a")).toBeUndefined();
    } finally {
      await harness.dispose();
    }
  });

  it("does not delete a task when its file becomes INVALID on a later sync", async () => {
    const { store, project, harness } = setup();
    try {
      await sync(store, project, {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\n---\nbody",
      });
      const aId = store.getFileTask(project.id, "a")?.taskId;
      expect(store.getTask(aId!)?.title).toBe("A");

      // The same file becomes malformed (unquoted colon in the title).
      const summary = await sync(store, project, {
        "memory/tasks/todo/a.md":
          "---\nslug: a\ntitle: A: broken\n---\nbody",
      });

      expect(summary.invalid).toBe(1);
      expect(summary.deleted).toBe(0);
      // The card survives untouched, at its last valid title.
      expect(store.getFileTask(project.id, "a")?.taskId).toBe(aId);
      expect(store.getTask(aId!)?.title).toBe("A");
    } finally {
      await harness.dispose();
    }
  });

  it("dry run reports adopt/create/update/would-delete without writing anything", async () => {
    const { store, project, harness } = setup();
    try {
      const legacy = store.createTask({
        projectId: project.id,
        title: "WGSL groups (legacy)",
        description:
          "Source: memory/tasks/backlog/wgsl-e2-groups.md · slug: wgsl-e2-groups\n",
      });

      const files = {
        "memory/tasks/backlog/wgsl-e2-groups.md": [
          "---",
          "slug: wgsl-e2-groups",
          "title: WGSL groups",
          "---",
        ].join("\n"),
        "memory/tasks/todo/brand-new.md": "---\nslug: brand-new\ntitle: Brand new\n---\n",
      };
      const { files: scanned } = await scanTaskFolder(reader(files), "memory/tasks");
      const summary = syncProjectFiles(store, project as never, scanned, {
        dryRun: true,
      });

      expect(summary.adopted).toBe(1);
      expect(summary.created).toBe(1);
      expect(summary.deleted).toBe(0);

      // Nothing was actually written.
      expect(store.getFileTask(project.id, "wgsl-e2-groups")).toBeUndefined();
      expect(store.getFileTask(project.id, "brand-new")).toBeUndefined();
      expect(store.getFileTaskByTaskId(legacy.id)).toBeUndefined();
      expect(store.listTasks({ projectId: project.id })).toHaveLength(1);
    } finally {
      await harness.dispose();
    }
  });
});

describe("syncProjectFiles + scanTaskFolder — file origin", () => {
  const worktreeOrigin: FileTaskOrigin = {
    kind: "worktree",
    environmentId: "env_a",
    name: "agent-a",
    branchName: "claude/a",
  };

  it("persists a worktree origin alongside the file link", async () => {
    const { store, project, harness } = setup();
    try {
      await sync(
        store,
        project,
        { "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\n---\n" },
        worktreeOrigin,
      );
      expect(store.getFileTask(project.id, "a")?.origin).toEqual(worktreeOrigin);
    } finally {
      await harness.dispose();
    }
  });

  it("defaults to a main origin", async () => {
    const { store, project, harness } = setup();
    try {
      await sync(store, project, {
        "memory/tasks/todo/a.md": "---\nslug: a\ntitle: A\n---\n",
      });
      expect(store.getFileTask(project.id, "a")?.origin).toEqual({ kind: "main" });
    } finally {
      await harness.dispose();
    }
  });

  it("re-syncs when only the origin changes, even with identical content and path", async () => {
    const { store, project, harness } = setup();
    try {
      const content = "---\nslug: a\ntitle: A\n---\n";
      await sync(store, project, { "memory/tasks/todo/a.md": content });
      expect(store.getFileTask(project.id, "a")?.origin).toEqual({ kind: "main" });

      // Same bytes, same path — but now sourced from a worktree instead of
      // main. Without an origin check in the "unchanged" fast path this would
      // be silently skipped and the stale main origin would never clear.
      const summary = await sync(
        store,
        project,
        { "memory/tasks/todo/a.md": content },
        worktreeOrigin,
      );
      expect(summary).toMatchObject({ unchanged: 0, updated: 1 });
      expect(store.getFileTask(project.id, "a")?.origin).toEqual(worktreeOrigin);
    } finally {
      await harness.dispose();
    }
  });

  it("skips as unchanged once content, path, and origin all match", async () => {
    const { store, project, harness } = setup();
    try {
      const content = "---\nslug: a\ntitle: A\n---\n";
      await sync(
        store,
        project,
        { "memory/tasks/todo/a.md": content },
        worktreeOrigin,
      );
      const summary = await sync(
        store,
        project,
        { "memory/tasks/todo/a.md": content },
        worktreeOrigin,
      );
      expect(summary).toMatchObject({ unchanged: 1, updated: 0 });
    } finally {
      await harness.dispose();
    }
  });
});
