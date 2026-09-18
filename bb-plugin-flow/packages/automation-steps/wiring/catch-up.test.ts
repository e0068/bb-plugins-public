import { describe, expect, it } from "vitest";

import type { ResolvedBase } from "../core/base-branch";
import { runCatchUp } from "./catch-up";
import type { GitPorts, GitRun } from "./git-run";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });

/** Поддельный git: отвечает по argv и пишет вызовы. */
const fake = (state: { behind: number; ahead: number; dirty?: boolean; merge?: GitRun; conflicts?: string; fetch?: GitRun; abort?: GitRun; merging?: boolean }) => {
  const calls: string[][] = [];
  const ports: GitPorts = {
    async run(args) {
      calls.push([...args]);
      const line = args.join(" ");
      if (args[0] === "fetch") return state.fetch ?? ok();
      if (args[0] === "status") return ok(state.dirty === true ? " M a.ts\n" : "");
      if (line.startsWith("rev-list --count HEAD..")) return ok(`${state.behind}\n`);
      if (args[0] === "rev-list") return ok(`${state.ahead}\n`);
      if (line.startsWith("diff --name-only")) return ok(state.conflicts ?? "");
      if (line === "merge --abort") return state.abort ?? ok();
      if (line === "rev-parse -q --verify MERGE_HEAD") return state.merging === true ? ok("abc\n") : { code: 1, stdout: "", stderr: "" };
      if (args[0] === "merge") return state.merge ?? ok();
      return { code: 1, stdout: "", stderr: `unexpected ${line}` };
    },
  };
  return { ports, calls };
};

const origin: ResolvedBase = { mode: "origin", statusBase: "origin/main", githubBase: "main" };
const local: ResolvedBase = { mode: "local", statusBase: "main", githubBase: "main" };
const merges = (calls: string[][]) => calls.filter((c) => c[0] === "merge");

describe("runCatchUp — подтянуть ветку к вершине базы", () => {
  it("не отстаёт, даже со своими коммитами, — успех без слияния", async () => {
    const { ports, calls } = fake({ behind: 0, ahead: 6 });
    expect(await runCatchUp(ports, origin)).toBe("up-to-date");
    expect(calls[0]).toEqual(["fetch", "origin", "main"]);
    expect(merges(calls)).toEqual([]);
  });

  it("отстаёт без своих коммитов — перемотка", async () => {
    const { ports, calls } = fake({ behind: 3, ahead: 0 });
    expect(await runCatchUp(ports, origin)).toBe("fast-forwarded");
    expect(merges(calls)).toEqual([["merge", "--ff-only", "origin/main"]]);
  });

  it("разошлась — слияние вершины базы в ветку", async () => {
    const { ports, calls } = fake({ behind: 4, ahead: 6 });
    expect(await runCatchUp(ports, origin)).toBe("merged");
    expect(merges(calls)).toEqual([["merge", "--no-edit", "origin/main"]]);
  });

  it("незакоммиченные правки — отказ до всякого слияния", async () => {
    const { ports, calls } = fake({ behind: 4, ahead: 6, dirty: true });
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/uncommitted/);
    expect(merges(calls)).toEqual([]);
  });

  it("режим local — без fetch, сравнение с локальной базой", async () => {
    const { ports, calls } = fake({ behind: 2, ahead: 1 });
    expect(await runCatchUp(ports, local)).toBe("merged");
    expect(calls.some((c) => c[0] === "fetch")).toBe(false);
    expect(merges(calls)).toEqual([["merge", "--no-edit", "main"]]);
  });

  it("fetch не прошёл — ошибка с текстом git, дальше ничего", async () => {
    const { ports, calls } = fake({ behind: 1, ahead: 0, fetch: { code: 1, stdout: "", stderr: "no network" } });
    await expect(runCatchUp(ports, origin)).rejects.toThrow("no network");
    expect(calls).toHaveLength(1);
  });

  it("незавершённое слияние в дереве — отказ до всякого слияния, чужое слияние не отменяется", async () => {
    const { ports, calls } = fake({ behind: 4, ahead: 6, merging: true });
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/unfinished merge/);
    expect(merges(calls)).toEqual([]);
  });

  it("имена конфликтных файлов стоят в начале ошибки: обрезанная строка в интерфейсе всё равно называет их", async () => {
    const { ports, calls } = fake({ behind: 4, ahead: 6, merge: { code: 1, stdout: "CONFLICT", stderr: "" }, conflicts: "docs/architecture/bb-plugin-flow.md\nbb-plugin-flow/README.md\n" });
    const error = await runCatchUp(ports, origin).then(() => null, (e: Error) => e);
    expect(calls.at(-1)).toEqual(["merge", "--abort"]);
    expect(error?.message.slice(0, 80)).toContain("docs/architecture/bb-plugin-flow.md");
    expect(error?.message).toContain("bb-plugin-flow/README.md");
    expect(error?.message).toMatch(/aborted|untouched/);
  });

  it("отмена конфликтного слияния не прошла — ошибка говорит, что дерево осталось посреди слияния", async () => {
    const { ports } = fake({ behind: 4, ahead: 6, merge: { code: 1, stdout: "CONFLICT", stderr: "" }, conflicts: "a.md\n", abort: { code: 128, stdout: "", stderr: "index.lock exists" } });
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/mid-merge.*index\.lock exists/);
  });

  it("git отказал до начала слияния — ошибка с текстом git, без отмены", async () => {
    const { ports, calls } = fake({ behind: 4, ahead: 6, merge: { code: 2, stdout: "", stderr: "untracked working tree files would be overwritten" } });
    await expect(runCatchUp(ports, origin)).rejects.toThrow(/would be overwritten/);
    expect(calls.some((c) => c.join(" ") === "merge --abort")).toBe(false);
  });
});

