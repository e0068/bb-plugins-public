// @vitest-environment node
// Волна, влитая в ветку родителя шагом «Смёрджить PR», сама говорит об этом
// треду-родителю: иначе его агент ищет PR в main и считает волну несданной.
// Стык с настоящим git.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const CHILD_TITLE = "Механизм функций — волна 0";

const trees = () => {
  const root = mkdtempSync(join(tmpdir(), "parent-note-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const parent = join(root, "parent");
  git(root, "clone", "-q", origin, parent);
  git(parent, "config", "core.hooksPath", "/dev/null");
  git(parent, "config", "user.email", "t@t");
  git(parent, "config", "user.name", "t");
  commit(parent, "shared.md", "base\n");
  git(parent, "push", "-q", "origin", "main");
  git(parent, "checkout", "-q", "-b", PARENT_BRANCH);
  const child = join(root, "child");
  git(parent, "worktree", "add", "-q", "-b", CHILD_BRANCH, child, PARENT_BRANCH);
  return { parent, child };
};

/** Тред «child» — волна треда «parent»; «root» — тред без родителя на main. */
const sdkOf = ({ parent, child }: { parent: string; child: string }) =>
  ({
    threads: {
      get: async ({ threadId }: { threadId: string }) =>
        threadId === "child"
          ? { id: "child", title: CHILD_TITLE, environmentId: "e-child", parentThreadId: "parent" }
          : { id: threadId, title: "Зонтик", environmentId: `e-${threadId}`, parentThreadId: null },
    },
    environments: {
      get: async ({ environmentId }: { environmentId: string }) =>
        environmentId === "e-child"
          ? { id: "e-child", path: child, branchName: CHILD_BRANCH, mergeBaseBranch: PARENT_BRANCH, defaultBranch: "main", baseBranch: "main" }
          : { id: "e-parent", path: parent, branchName: PARENT_BRANCH, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "main" },
      mergePullRequest: async () => {},
      pullRequest: async () => ({ outcome: "unavailable" }),
    },
  }) as unknown as StepPorts["sdk"];

const untouched = async () => {
  throw new Error("плагины не трогаются");
};

const stepsTelling = (paths: { parent: string; child: string }) => {
  const told: Array<{ threadId: string; text: string }> = [];
  const steps = createSteps({
    sdk: sdkOf(paths),
    kv: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins: { list: untouched, applyUpdate: untouched, install: untouched, remove: untouched },
    ownPluginId: "flow",
    sleep: async () => {},
    tell: async (threadId, text) => void told.push({ threadId, text }),
  });
  return { steps, told };
};

describe("волна, влитая в ветку родителя, говорит об этом родителю", () => {
  it("«Смёрджить PR» оставляет в треде родителя одно сообщение с названием волны, обеими ветками и коммитом", async () => {
    const paths = trees();
    const { steps, told } = stepsTelling(paths);
    commit(paths.child, "wave.md", "wave\n");
    expect(await steps["git.merge"]("child")).toMatchObject({ ok: true });
    const head = git(paths.parent, "rev-parse", "HEAD");
    expect(told).toHaveLength(1);
    expect(told[0]?.threadId).toBe("parent");
    for (const fact of [CHILD_TITLE, CHILD_BRANCH, PARENT_BRANCH, head.slice(0, 7)]) expect(told[0]?.text).toContain(fact);
  });

  it("ветка уже влита шагом «Открыть PR» — «Смёрджить PR» всё равно говорит родителю, а «Открыть PR» молчит", async () => {
    const paths = trees();
    const { steps, told } = stepsTelling(paths);
    commit(paths.child, "wave.md", "wave\n");
    await steps["git.create-pr"]("child");
    expect(told).toEqual([]);
    expect(await steps["git.merge"]("child")).toEqual({ ok: true, detail: `already in ${PARENT_BRANCH}` });
    expect(told.map(({ threadId }) => threadId)).toEqual(["parent"]);
  });

  it("родителю не сказать — шаг всё равно успешен, а в деталях сказано, что родитель не узнал", async () => {
    const paths = trees();
    commit(paths.child, "wave.md", "wave\n");
    const steps = createSteps({
      sdk: sdkOf(paths),
      kv: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] },
      settings: { get: async () => ({ githubToken: "token" }) },
      plugins: { list: untouched, applyUpdate: untouched, install: untouched, remove: untouched },
      ownPluginId: "flow",
      sleep: async () => {},
      tell: async () => {
        throw new Error("thread is archived");
      },
    });
    const outcome = await steps["git.merge"]("child");
    expect(outcome).toMatchObject({ ok: true, detail: expect.stringContaining("thread is archived") });
  });

  it("тред без родителя ничего никому не пишет", async () => {
    const { steps, told } = stepsTelling(trees());
    await steps["git.merge"]("root");
    expect(told).toEqual([]);
  });
});
