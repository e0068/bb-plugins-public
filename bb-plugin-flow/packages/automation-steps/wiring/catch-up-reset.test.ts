import { describe, expect, it } from "vitest";

import type { ResolvedBase } from "../core/base-branch";
import { runCatchUp } from "./catch-up";
import type { GitPorts, GitRun } from "./git-run";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });

/** Поддельный git, умеющий отвечать и про содержимое: слияние в памяти даёт дерево, которое сравнивается с деревом базы. */
const fake = (state: { behind: number; ahead: number; mergeTree: string; baseTree: string; reset?: GitRun }) => {
  const calls: string[][] = [];
  const ports: GitPorts = {
    async run(args) {
      calls.push([...args]);
      const line = args.join(" ");
      if (args[0] === "fetch") return ok();
      if (args[0] === "symbolic-ref") return ok("work\n");
      if (args[0] === "status") return ok("");
      if (line.startsWith("rev-parse -q --verify")) return { code: 1, stdout: "", stderr: "" };
      if (line.startsWith("rev-list --count HEAD..")) return ok(`${state.behind}\n`);
      if (args[0] === "rev-list") return ok(`${state.ahead}\n`);
      if (args[0] === "merge-tree") return ok(`${state.mergeTree}\n`);
      if (args[0] === "rev-parse") return ok(`${state.baseTree}\n`);
      if (args[0] === "reset") return state.reset ?? ok();
      return { code: 1, stdout: "", stderr: `unexpected ${line}` };
    },
  };
  return { ports, calls };
};

const origin: ResolvedBase = { mode: "origin", statusBase: "origin/main", githubBase: "main" };

describe("runCatchUp на ветке, чей PR уже влит", () => {
  it("содержимое ветки уже в базе — ветка доводится до базы без слияния", async () => {
    const { ports, calls } = fake({ behind: 5, ahead: 3, mergeTree: "tree1", baseTree: "tree1" });
    expect(await runCatchUp(ports, origin)).toBe("reset-to-base");
    expect(calls.some((c) => c[0] === "reset")).toBe(true);
    expect(calls.find((c) => c[0] === "reset")).toEqual(["reset", "--hard", "origin/main"]);
    expect(calls.some((c) => c[0] === "merge")).toBe(false);
  });

  it("содержимое ветки в базу не входит — прежнее слияние", async () => {
    const { ports, calls } = fake({ behind: 5, ahead: 3, mergeTree: "tree2", baseTree: "tree1" });
    await runCatchUp(ports, origin).catch(() => null);
    expect(calls.some((c) => c[0] === "reset")).toBe(false);
  });

  it("отказ git на доведении до базы — ошибка с его текстом", async () => {
    const { ports } = fake({ behind: 5, ahead: 3, mergeTree: "tree1", baseTree: "tree1", reset: { code: 128, stdout: "", stderr: "index.lock exists" } });
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/index\.lock exists/);
  });

  it("содержимое меряется один раз и без второго fetch", async () => {
    const { ports, calls } = fake({ behind: 5, ahead: 3, mergeTree: "tree1", baseTree: "tree1" });
    await runCatchUp(ports, origin);
    expect(calls.filter((c) => c[0] === "fetch")).toHaveLength(1);
    expect(calls.filter((c) => c[0] === "merge-tree")).toHaveLength(1);
  });
});

describe("незаконченная операция в дереве", () => {
  /** Тот же поддельный git, но с остановленным rebase: MERGE_HEAD нет, REBASE_HEAD есть. */
  const stopped = () => {
    const calls: string[][] = [];
    const ports: GitPorts = {
      async run(args) {
        calls.push([...args]);
        const line = args.join(" ");
        if (args[0] === "fetch") return ok();
        if (line === "rev-parse -q --verify REBASE_HEAD") return ok("abc\n");
        if (args[0] === "symbolic-ref") return { code: 1, stdout: "", stderr: "" };
        if (args[0] === "rev-parse") return { code: 1, stdout: "", stderr: "" };
        if (args[0] === "status") return ok("");
        return { code: 1, stdout: "", stderr: `unexpected ${line}` };
      },
    };
    return { ports, calls };
  };

  it("остановленный rebase — отказ до всякой работы, и чужая операция не отменяется", async () => {
    const { ports, calls } = stopped();
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/unfinished rebase/);
    expect(calls.some((c) => c[0] === "rebase" || c[0] === "merge" || c[0] === "reset")).toBe(false);
  });
});

describe("дерево не на ветке", () => {
  it("отделённый HEAD без единой псевдоссылки — отказ: так выглядит rebase, вставший на break", async () => {
    const calls: string[][] = [];
    const ports: GitPorts = {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "fetch") return ok();
        if (args[0] === "symbolic-ref") return { code: 1, stdout: "", stderr: "" };
        if (args[0] === "rev-parse") return { code: 1, stdout: "", stderr: "" };
        if (args[0] === "status") return ok("");
        return { code: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
      },
    };
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/not on a branch/);
    expect(calls.some((c) => c[0] === "rebase" || c[0] === "merge" || c[0] === "reset")).toBe(false);
  });
});
