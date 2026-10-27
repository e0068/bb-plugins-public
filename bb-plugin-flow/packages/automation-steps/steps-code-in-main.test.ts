import { describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";
import type { CliPorts, CliRun } from "./wiring/bb-cli-run";
import type { GitPorts, GitRun } from "./wiring/git-run";

const TREE = "83c99fce74321c0bbe9b3c67361a5c41006f43dd";
const OTHER_TREE = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

const ran = (stdout = "", code = 0, stderr = ""): CliRun => ({ kind: "ran", code, stdout, stderr });
const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });
const code = (value: number): GitRun => ({ code: value, stdout: "", stderr: "" });

/** CLI доски: одна задача BBPL-982 без подзадач; записи статуса и комментарии копятся в журнал. */
const board = (commentAnswer: CliRun = ran("{}")) => {
  const updates: string[][] = [];
  const comments: string[][] = [];
  const cli: CliPorts = {
    run: async (args) => {
      if (args[1] === "current") return ran(JSON.stringify({ tasks: [{ key: "BBPL-982" }] }));
      if (args[1] === "show") return ran(JSON.stringify({ subtasks: [] }));
      if (args[1] === "comment") {
        comments.push([...args]);
        return commentAnswer;
      }
      updates.push([...args]);
      return ran("{}");
    },
  };
  return { cli, updates, comments };
};

/** git дерева треда: отвечает из очереди и записывает, что у него спросили. */
const gitOf = (answers: readonly GitRun[]) => {
  const calls: string[][] = [];
  let index = 0;
  const git: GitPorts = {
    async run(args) {
      calls.push([...args]);
      return answers[index++] ?? code(128);
    },
  };
  return { git, calls };
};

const sdkOf = (environmentId: string | null) =>
  ({
    threads: { get: async () => ({ id: "t1", environmentId, parentThreadId: null, title: "T" }) },
    environments: { get: async () => ({ id: "e1", hostId: "h", path: "/wt", branchName: "b", baseBranch: "main", defaultBranch: null, mergeBaseBranch: null }) },
  }) as unknown as StepPorts["sdk"];

const stepsOver = (cli: CliPorts, git: GitPorts, environmentId: string | null = "e1") =>
  createSteps({ sdk: sdkOf(environmentId), cli, git: () => git, sleep: async () => undefined } as unknown as StepPorts);

describe("шаг «Задача → done» и код ветки в origin/main", () => {
  it("коммит ветки в origin/main — задача уходит в done", async () => {
    const { cli, updates, comments } = board();
    const { git } = gitOf([ok(), ok()]);

    expect(await stepsOver(cli, git)["bb.tasks-done"]("t1")).toMatchObject({ ok: true, detail: "BBPL-982" });
    expect(updates).toEqual([["tasks", "update", "BBPL-982", "--status", "done", "--json"]]);
    expect(comments).toEqual([]);
  });

  it("коммита в main нет, зато содержимое ветки уже там — задача уходит в done", async () => {
    const { cli, updates } = board();
    const { git } = gitOf([ok(), code(1), ok(`${TREE}\n`), ok(`${TREE}\n`)]);

    expect(await stepsOver(cli, git)["bb.tasks-done"]("t1")).toMatchObject({ ok: true });
    expect(updates).toHaveLength(1);
  });

  it("кода ветки в main нет — задача не двигается, в неё пишется комментарий, шаг красный", async () => {
    const { cli, updates, comments } = board();
    const { git } = gitOf([ok(), code(1), ok(`${OTHER_TREE}\n`), ok(`${TREE}\n`)]);

    const outcome = await stepsOver(cli, git)["bb.tasks-done"]("t1");

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("BBPL-982") });
    expect(outcome).toMatchObject({ error: expect.stringContaining("origin/main") });
    expect(updates).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual(["tasks", "comment", "BBPL-982", "--body", expect.stringContaining("origin/main"), "--json"]);
  });

  it("проверить не вышло (fetch упал) — задача тоже остаётся, причина в комментарии", async () => {
    const { cli, updates, comments } = board();
    const { git } = gitOf([code(128)]);

    const outcome = await stepsOver(cli, git)["bb.tasks-done"]("t1");

    expect(outcome).toMatchObject({ ok: false });
    expect(updates).toEqual([]);
    expect(comments).toHaveLength(1);
  });

  it("красный из-за отсутствия кода в main не повторяется — комментарий один", async () => {
    const { cli, comments } = board();
    const { git } = gitOf([ok(), code(1), ok(`${OTHER_TREE}\n`), ok(`${TREE}\n`)]);

    await stepsOver(cli, git)["bb.tasks-done"]("t1");
    expect(comments).toHaveLength(1);
  });

  it("комментарий не записался — задача всё равно не двигается и шаг называет обе беды", async () => {
    const { cli, updates } = board(ran("", 1, "board refused"));
    const { git } = gitOf([ok(), code(1), ok(`${OTHER_TREE}\n`), ok(`${TREE}\n`)]);

    const outcome = await stepsOver(cli, git)["bb.tasks-done"]("t1");

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("board refused") });
    expect(updates).toEqual([]);
  });

  it("у треда нет привязанных задач — git не трогается, шаг зелёный как раньше", async () => {
    const cli: CliPorts = { run: async () => ran(JSON.stringify({ tasks: [] })) };
    const { git, calls } = gitOf([]);

    expect(await stepsOver(cli, git)["bb.tasks-done"]("t1")).toEqual({ ok: true, detail: "no linked tasks" });
    expect(calls).toEqual([]);
  });

  it("тред без окружения с git не проверяется: кода ветки у него нет, задача уходит в done как раньше", async () => {
    const { cli, updates } = board();
    const { git, calls } = gitOf([]);

    expect(await stepsOver(cli, git, null)["bb.tasks-done"]("t1")).toMatchObject({ ok: true });
    expect(calls).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("шаг «Задача → in_review» кода в main не требует", async () => {
    const { cli } = board();
    const { git, calls } = gitOf([]);

    expect(await stepsOver(cli, git)["bb.tasks-in-review"]("t1")).toMatchObject({ ok: true });
    expect(calls).toEqual([]);
  });
});
