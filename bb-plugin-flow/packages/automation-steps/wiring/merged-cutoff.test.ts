import { describe, expect, it } from "vitest";

import type { ResolvedBase } from "../core/base-branch";
import { findMergedCutoff } from "./merged-cutoff";
import type { GitPorts, GitRun } from "./git-run";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });

/** Поддельный git: список собственных коммитов от свежих к старым и дерево слияния каждого с базой. */
const fake = (state: { own: readonly string[]; trees: Record<string, string>; baseTree?: string; listCode?: number }) => {
  const calls: string[][] = [];
  const ports: GitPorts = {
    async run(args) {
      calls.push([...args]);
      if (args[0] === "rev-list") return state.listCode === undefined ? ok(`${state.own.join("\n")}\n`) : { code: state.listCode, stdout: "", stderr: "no such ref" };
      if (args[0] === "merge-tree") return ok(`${state.trees[args[3]!] ?? "other"}\n`);
      if (args[0] === "rev-parse") return ok(`${state.baseTree ?? "base"}\n`);
      return { code: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    },
  };
  return { ports, calls };
};

const base: ResolvedBase = { mode: "origin", statusBase: "origin/main", githubBase: "main" };

describe("findMergedCutoff", () => {
  it("срез — самый свежий коммит, чьё содержимое уже в базе", async () => {
    const { ports, calls } = fake({ own: ["c4", "c3", "c2", "c1"], trees: { c2: "base", c1: "base" } });
    expect(await findMergedCutoff(ports, base)).toBe("c2");
    // Старые коммиты не проверяются: они влиты тем же мёрджем.
    expect(calls.filter((c) => c[0] === "merge-tree").map((c) => c[3])).toEqual(["c4", "c3", "c2"]);
  });

  it("вся ветка своя — среза нет", async () => {
    expect(await findMergedCutoff(fake({ own: ["c2", "c1"], trees: {} }).ports, base)).toBeNull();
  });

  it("собственных коммитов нет — среза нет", async () => {
    expect(await findMergedCutoff(fake({ own: [], trees: {} }).ports, base)).toBeNull();
  });

  it("git не ответил списком — срез не выдумывается", async () => {
    expect(await findMergedCutoff(fake({ own: [], trees: {}, listCode: 128 }).ports, base)).toBeNull();
  });

  it("предел проверок соблюдается: за ним ветка разбирается прежним слиянием", async () => {
    const own = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const { ports, calls } = fake({ own, trees: { c25: "base" } });
    expect(await findMergedCutoff(ports, base, 20)).toBeNull();
    expect(calls.filter((c) => c[0] === "merge-tree")).toHaveLength(20);
  });
});
