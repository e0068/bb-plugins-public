import { describe, expect, it } from "vitest";

import type { GitPorts, GitRun } from "./git-run";
import { headOfBaseCheckout, refreshLocalPlugins } from "./local-plugin-refresh";
import type { PluginsPort } from "./plugin-reinstall";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });

const WORKTREES = ["worktree /repo", "HEAD aaa", "branch refs/heads/main", "", "worktree /trees/thr", "HEAD bbb", "branch refs/heads/bb/thr", ""].join("\n");

const git = (diff: string): { ports: GitPorts; calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    ports: {
      async run(args) {
        calls.push([...args]);
        if (args[0] === "worktree") return ok(WORKTREES);
        if (args.includes("rev-parse")) return ok("aaa\n");
        if (args.includes("diff")) return ok(diff);
        return { code: 1, stdout: "", stderr: "unexpected" };
      },
    },
  };
};

const plugins = (fail: string | null = null) => {
  const installed: string[] = [];
  const port: PluginsPort = {
    list: async () => ({
      plugins: [
        { id: "flow", source: "path:/repo/bb-plugin-flow", version: "0.6.173" },
        { id: "mail", source: "path:/repo/bb-plugin-mail", version: "0.2.0" },
        { id: "notes", source: "path:/repo/bb-plugin-notes", version: "0.1.0" },
      ],
    }),
    applyUpdate: async () => {
      throw new Error("applyUpdate на плагине из папки ничего не пересобирает");
    },
    install: async ({ source }) => {
      if (fail !== null && source.includes(fail)) throw new Error("build failed");
      installed.push(source);
    },
    remove: async () => {
      throw new Error("remove стёр бы настройки плагина");
    },
  };
  return { port, installed };
};

const noImports = async () => ({ ok: true as const, edges: [] });

describe("пересборка плагинов из основной копии после Pull Main", () => {
  it("копия с main и её вершина находятся до подтягивания", async () => {
    expect(await headOfBaseCheckout(git("").ports, "main")).toEqual({ path: "/repo", head: "aaa" });
  });

  it("плагин, чей код пришёл с main, переустанавливается из той же папки; Flow, который ведёт шаг, — откладывается на конец цепочки", async () => {
    const { port, installed } = plugins();
    const report = await refreshLocalPlugins(port, git("bb-plugin-mail/server.ts\nbb-plugin-flow/app/widget.tsx\n").ports, { path: "/repo", head: "aaa" }, "flow", noImports);
    expect(installed).toEqual(["path:/repo/bb-plugin-mail"]);
    expect(report).toEqual({ refreshed: ["mail"], problems: [], pendingSelf: "flow" });
  });

  it("main не сдвинулся — ни один плагин не трогается", async () => {
    const { port, installed } = plugins();
    expect(await refreshLocalPlugins(port, git("").ports, { path: "/repo", head: "aaa" }, "flow", noImports)).toEqual({ refreshed: [], problems: [], pendingSelf: null });
    expect(installed).toEqual([]);
  });

  it("неудачная сборка называет плагин и оставленную версию, остальные плагины пересобираются", async () => {
    const { port, installed } = plugins("mail");
    const report = await refreshLocalPlugins(port, git("bb-plugin-mail/a.ts\nbb-plugin-notes/b.ts\n").ports, { path: "/repo", head: "aaa" }, "flow", noImports);
    expect(installed).toEqual(["path:/repo/bb-plugin-notes"]);
    expect(report.refreshed).toEqual(["notes"]);
    expect(report.problems).toEqual(['"mail" from path:/repo/bb-plugin-mail, version 0.2.0 still installed: build failed']);
  });
});
