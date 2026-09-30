// @vitest-environment node
// Ветка уже влита, а прочитать родителя для сообщения не вышло — шаг всё равно
// успешен: сданная работа не красится красным из-за несказанного.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `${file}: ${text}`);
};

const PARENT_BRANCH = "bb/umbrella-thr_p";
const CHILD_BRANCH = "bb/wave-0-thr_c";

describe("влитая ветка и несказанное родителю", () => {
  it("HEAD родителя после влития не читается — шаг успешен, ветка влита, в деталях сказано, что родитель не узнал", async () => {
    const root = mkdtempSync(join(tmpdir(), "parent-note-unread-"));
    dirs.push(root);
    const parent = join(root, "parent");
    git(root, "init", "-q", "-b", "main", parent);
    git(parent, "config", "user.email", "t@t");
    git(parent, "config", "user.name", "t");
    commit(parent, "shared.md", "base\n");
    git(parent, "checkout", "-q", "-b", PARENT_BRANCH);
    const child = join(root, "child");
    git(parent, "worktree", "add", "-q", "-b", CHILD_BRANCH, child, PARENT_BRANCH);
    commit(child, "wave.md", "wave\n");
    // Хук после слияния портит HEAD дерева родителя: влитие прошло, а прочитать вершину его ветки уже нельзя.
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "post-merge"), `#!/bin/sh\necho broken > "$(git rev-parse --git-dir)/HEAD"\n`, { mode: 0o755 });
    git(parent, "config", "core.hooksPath", hooks);
    const sdk = {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          threadId === "child" ? { id: "child", title: "Волна", environmentId: "e-child", parentThreadId: "parent" } : { id: "parent", title: "Зонтик", environmentId: "e-parent", parentThreadId: null },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) =>
          environmentId === "e-child"
            ? { id: "e-child", path: child, branchName: CHILD_BRANCH, mergeBaseBranch: PARENT_BRANCH, defaultBranch: "main", baseBranch: "main" }
            : { id: "e-parent", path: parent, branchName: PARENT_BRANCH, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "main" },
      },
    } as unknown as StepPorts["sdk"];
    const untouched = async () => {
      throw new Error("плагины не трогаются");
    };
    const told: string[] = [];
    const steps = createSteps({
      sdk,
      kv: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
      settings: { get: async () => ({ githubToken: "token" }) },
      plugins: { list: untouched, applyUpdate: untouched, install: untouched, remove: untouched },
      ownPluginId: "flow",
      sleep: async () => {},
      tell: async (threadId) => void told.push(threadId),
    });
    expect(await steps["git.merge"]("child")).toMatchObject({ ok: true, detail: expect.stringContaining("the parent thread was not told") });
    expect(told).toEqual([]);
    expect(git(child, "merge-base", "--is-ancestor", CHILD_BRANCH, PARENT_BRANCH)).toBe("");
  });
});
