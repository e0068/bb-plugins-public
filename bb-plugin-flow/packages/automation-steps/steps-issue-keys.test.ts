import { describe, expect, it } from "vitest";

import { isStepId, STEP_IDS, STEP_LABELS } from "./catalog";
import { createSteps, type StepPorts } from "./steps";
import type { CliPorts, CliRun } from "./wiring/bb-cli-run";

// Задача, рождённая в ветке, живёт без ключа, а правки из дерева треда его не
// выдают. Ключи выдаёт шаг сразу после FF Branch ← Main: номера идут после
// наибольшего в только что подтянутом main, а выданное уезжает коммитом в PR.

const sdk = (over: { dirty: boolean }) => {
  const commits: string[] = [];
  const api = {
    threads: { get: async () => ({ id: "t1", environmentId: "e1", projectId: "proj_1", title: "T" }) },
    environments: {
      status: async () => ({ outcome: "available", workspace: { workingTree: { hasUncommittedChanges: over.dirty } } }),
      commit: async ({ environmentId }: { environmentId: string }) => {
        commits.push(environmentId);
        return { ok: true, action: "commit", commitSha: "abc", commitSubject: "Ключи задач", message: "" };
      },
    },
  } as unknown as StepPorts["sdk"];
  return { api, commits };
};

const cli = (answer: CliRun) => {
  const calls: { args: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
  const ports: CliPorts = {
    run: async (args, env) => {
      calls.push({ args, env });
      return answer;
    },
  };
  return { ports, calls };
};

const ports = (api: StepPorts["sdk"], cliPorts: CliPorts): StepPorts => ({
  sdk: api,
  kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] } as unknown as StepPorts["kv"],
  settings: { get: async () => ({ githubToken: undefined }) },
  cli: cliPorts,
  plugins: {} as StepPorts["plugins"],
  ownPluginId: "flow",
  sleep: async () => undefined,
});

const issued = (keys: { slug: string; key: string }[]): CliRun => ({ kind: "ran", code: 0, stdout: JSON.stringify({ issued: keys }), stderr: "" });

describe("шаг «Выдать ключи задачам»", () => {
  it("стоит в каталоге сразу после FF Branch ← Main и до открытия PR", () => {
    expect(isStepId("bb.tasks-issue-keys")).toBe(true);
    expect(STEP_LABELS["bb.tasks-issue-keys"]).toEqual({ en: "Issue task keys", ru: "Выдать ключи задачам" });
    expect(STEP_IDS.indexOf("bb.tasks-issue-keys")).toBe(STEP_IDS.indexOf("git.fast-forward") + 1);
  });

  it("выдаёт ключи из дерева треда, от имени его проекта, и коммитит их", async () => {
    const { api, commits } = sdk({ dirty: true });
    const run = cli(issued([{ slug: "epic", key: "BBPL-533" }, { slug: "child", key: "BBPL-534" }]));

    expect(await createSteps(ports(api, run.ports))["bb.tasks-issue-keys"]("t1")).toEqual({ ok: true, detail: "BBPL-533, BBPL-534" });
    expect(run.calls).toEqual([{ args: ["tasks", "keys", "issue", "--json"], env: { BB_THREAD_ID: "t1", BB_PROJECT_ID: "proj_1" } }]);
    expect(commits).toEqual(["e1"]);
  });

  it("выдавать нечего — шаг проходит без коммита", async () => {
    const { api, commits } = sdk({ dirty: false });

    expect(await createSteps(ports(api, cli(issued([])).ports))["bb.tasks-issue-keys"]("t1")).toEqual({ ok: true, detail: "no unnamed tasks" });
    expect(commits).toEqual([]);
  });

  it("отказ команды — провал шага с её текстом, без коммита", async () => {
    const { api, commits } = sdk({ dirty: true });
    const refused = cli({ kind: "ran", code: 1, stdout: "", stderr: "unknown command: keys" });

    expect(await createSteps(ports(api, refused.ports))["bb.tasks-issue-keys"]("t1")).toEqual({ ok: false, error: "Task keys were not issued: unknown command: keys" });
    expect(commits).toEqual([]);
  });
});

describe("шаг «Выдать ключи задачам» — что он не делает", () => {
  it("выдавать нечего, а дерево грязное — чужие правки шаг не коммитит", async () => {
    const { api, commits } = sdk({ dirty: true });

    expect(await createSteps(ports(api, cli(issued([])).ports))["bb.tasks-issue-keys"]("t1")).toEqual({ ok: true, detail: "no unnamed tasks" });
    expect(commits).toEqual([]);
  });

  it("нечитаемый ответ команды — провал шага, а не «выдавать нечего», и без коммита", async () => {
    const { api, commits } = sdk({ dirty: true });
    const garbled = cli({ kind: "ran", code: 0, stdout: "not json", stderr: "" });

    expect(await createSteps(ports(api, garbled.ports))["bb.tasks-issue-keys"]("t1")).toEqual({
      ok: false,
      error: "Task keys were not issued: unreadable answer: not json",
    });
    expect(commits).toEqual([]);
  });

  it("у дочернего треда, чья ветка уходит в ветку родителя, шаг не нужен: ключи выдаст шаг родителя против main", async () => {
    const parentBranch = "bb/umbrella-thr_p";
    const api = {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          threadId === "child"
            ? { id: "child", environmentId: "e-child", parentThreadId: "parent", projectId: "proj_1" }
            : { id: "parent", environmentId: "e-parent", parentThreadId: null, projectId: "proj_1" },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) =>
          environmentId === "e-child"
            ? { id: "e-child", path: "/child", branchName: "bb/wave-0-thr_c", mergeBaseBranch: parentBranch, defaultBranch: "main", baseBranch: "main" }
            : { id: "e-parent", path: "/parent", branchName: parentBranch, mergeBaseBranch: null, defaultBranch: "main", baseBranch: "main" },
      },
    } as unknown as StepPorts["sdk"];
    const run = cli(issued([{ slug: "wave", key: "BBPL-533" }]));

    expect(await createSteps(ports(api, run.ports))["bb.tasks-issue-keys"]("child")).toEqual({
      ok: true,
      detail: `not needed — the branch goes into ${parentBranch}, the parent thread's branch`,
    });
    expect(run.calls).toEqual([]);
  });
});
