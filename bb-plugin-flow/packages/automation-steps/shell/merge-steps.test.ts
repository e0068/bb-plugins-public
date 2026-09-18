import { describe, expect, it } from "vitest";

import { encodeBase64 } from "../core/base64";
import type { GithubRequest, RepoRef } from "../core/github-requests";
import type { GithubResponse } from "../wiring/create-pr";
import type { PluginsPort } from "../wiring/plugin-reinstall";
import { reinstallAfterMerge, settleVersionsForMerge, type GithubPull } from "./pr-helpers";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

const pkg = (version: string): string => `${JSON.stringify({ name: "bb-plugin-x", version }, null, 2)}\n`;

interface World {
  changedPaths: string[];
  files?: Record<string, string>;
  compareStatus?: number;
  /** Живой открытый PR на эту ветку: `true` — GitHub показывает, значит ещё не влит. */
  openPr?: boolean;
  /** Ответ GitHub на вопрос об открытых PR, когда он не 200. */
  openPrStatus?: number;
}

/** A PR that GitHub answers for, with only the calls these two helpers make. */
function pull(world: World): { gh: GithubPull; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  const gh: GithubPull = {
    ok: true,
    repo,
    baseBranch: "main",
    headBranch: "bb/thr_x",
    number: 42,
    ports: {
      async send(req: GithubRequest): Promise<GithubResponse> {
        calls.push(req);
        if (req.path.includes("/pulls?head=")) {
          const status = world.openPrStatus ?? 200;
          return {
            status,
            data: status === 200 ? (world.openPr ? [{ number: 42, html_url: "https://github.com/e0068/bb-plugins/pull/42" }] : []) : { message: "Bad credentials" },
          };
        }
        if (req.path.includes("/compare/")) {
          const status = world.compareStatus ?? 200;
          return {
            status,
            data:
              status === 200
                ? { behind_by: 0, files: world.changedPaths.map((filename) => ({ filename })) }
                : { message: "Not Found" },
          };
        }
        if (req.path.includes("/contents/")) {
          const [, path, ref] = /\/contents\/(.+)\?ref=(.+)$/.exec(req.path) as RegExpExecArray;
          const text = (world.files ?? {})[`${decodeURIComponent(ref)}:${decodeURIComponent(path)}`];
          return text === undefined
            ? { status: 404, data: { message: "Not Found" } }
            : { status: 200, data: { encoding: "base64", content: encodeBase64(text) } };
        }
        if (req.path.includes("/branches/")) return { status: 200, data: { commit: { sha: "headsha" } } };
        if (req.path.endsWith("/git/commits") && req.method === "POST") return { status: 201, data: { sha: "bumpsha" } };
        if (req.path.includes("/git/commits/")) return { status: 200, data: { tree: { sha: "headtree" } } };
        if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: `blob${calls.length}` } };
        if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "newtree" } };
        if (req.path.includes("/git/refs/")) return { status: 200, data: {} };
        throw new Error(`unexpected request ${req.method} ${req.path}`);
      },
    },
  };
  return { gh, calls };
}

const noPull: GithubPull = { ok: false, reason: "bb reports no pull request for this branch" };

function fakePlugins(installed: readonly { id: string; source: string }[]): {
  port: PluginsPort;
  updated: string[];
} {
  const updated: string[] = [];
  return {
    updated,
    port: {
      list: async () => ({ plugins: [...installed] }),
      applyUpdate: async ({ pluginId }) => void updated.push(pluginId),
      install: async () => undefined,
      remove: async () => undefined,
    },
  };
}

describe("settleVersionsForMerge", () => {
  it("no pull request → the reason is named, nothing is bumped, nothing throws", async () => {
    const report = await settleVersionsForMerge(noPull, "major");
    expect(report.unavailable).toBe("bb reports no pull request for this branch");
    expect(report.bumped).toEqual([]);
    expect(report.problems).toEqual([
      "versions not settled: bb reports no pull request for this branch",
    ]);
  });

  it("the level reaches the bump as given", async () => {
    const { gh } = pull({
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await settleVersionsForMerge(gh, "major");
    expect(report.unavailable).toBeNull();
    expect(report.bumped).toEqual([{ root: "bb-plugin-x", to: "1.0.0" }]);
  });

  it("GitHub refusing the comparison is a named problem, not a throw", async () => {
    const { gh } = pull({ changedPaths: [], compareStatus: 404 });
    const report = await settleVersionsForMerge(gh, "patch");
    expect(report.bumped).toEqual([]);
    expect(report.problems.join(" ")).toContain("could not compare");
  });
});

describe("reinstallAfterMerge", () => {
  it("no pull request → the reason is named and no plugin is touched", async () => {
    const { port, updated } = fakePlugins([{ id: "flow", source: "git:https://github.com/e0068/bb-plugins.git@main" }]);
    const report = await reinstallAfterMerge(noPull, port, "flow");
    expect(report.unavailable).toBe("bb reports no pull request for this branch");
    expect(updated).toEqual([]);
  });

  it("the plugins to update are the ones the branch changed", async () => {
    const { gh } = pull({ changedPaths: ["bb-plugin-tasks-plus/server.ts", "memory/INDEX.md"] });
    const { port, updated } = fakePlugins([
      { id: "tasks-plus", source: "git:https://github.com/e0068/bb-plugins.git@main" },
      { id: "decisions", source: "git:https://github.com/e0068/bb-plugins.git@main" },
    ]);
    const report = await reinstallAfterMerge(gh, port, "flow");
    expect(report.unavailable).toBeNull();
    expect(updated).toEqual(["tasks-plus"]);
    expect(report.reinstalled).toEqual(["tasks-plus"]);
  });

  it("the plugin running the chain comes back pending, not updated here", async () => {
    const { gh } = pull({ changedPaths: ["bb-plugin-flow/server.ts"] });
    const { port, updated } = fakePlugins([
      { id: "flow", source: "git:https://github.com/e0068/bb-plugins.git@main" },
    ]);
    const report = await reinstallAfterMerge(gh, port, "flow");
    expect(updated).toEqual([]);
    expect(report.pendingSelfUpdate).toBe("flow");
  });

  it("GitHub still shows a live PR on this branch → nothing is updated, and the step says why", async () => {
    const { gh, calls } = pull({ changedPaths: ["bb-plugin-tasks-plus/server.ts"], openPr: true });
    const { port, updated } = fakePlugins([
      { id: "tasks-plus", source: "git:https://github.com/e0068/bb-plugins.git@main" },
    ]);
    const report = await reinstallAfterMerge(gh, port, "flow");
    expect(report.unavailable).toBe("the pull request is not merged yet");
    expect(updated).toEqual([]);
    // Ни сравнения, ни чтения файлов: отказ до всякой работы.
    expect(calls.map((c) => c.path.includes("/pulls?head="))).toEqual([true]);
  });

  it("GitHub failing the open-PR check is 'could not ask', not 'merged'", async () => {
    const { gh } = pull({ changedPaths: ["bb-plugin-tasks-plus/server.ts"], openPrStatus: 401 });
    const { port, updated } = fakePlugins([
      { id: "tasks-plus", source: "git:https://github.com/e0068/bb-plugins.git@main" },
    ]);
    const report = await reinstallAfterMerge(gh, port, "flow");
    expect(report.unavailable).toContain("could not check whether the pull request is merged");
    expect(updated).toEqual([]);
  });

  it("GitHub refusing the comparison is named, and no plugin is touched", async () => {
    const { gh } = pull({ changedPaths: [], compareStatus: 404 });
    const { port, updated } = fakePlugins([{ id: "flow", source: "git:https://github.com/e0068/bb-plugins.git@main" }]);
    const report = await reinstallAfterMerge(gh, port, "flow");
    expect(report.unavailable).toContain("could not read the files of the pull request");
    expect(updated).toEqual([]);
  });
});
