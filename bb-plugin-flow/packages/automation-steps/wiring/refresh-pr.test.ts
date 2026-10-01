// Ветка уже открытого PR догоняет ветку треда: коммит PR пересобирается тем же
// способом, что при открытии, и голова ветки на GitHub переставляется на него.
// Когда на GitHub уже то же дерево, ветка не трогается и коммит не создаётся.
import { describe, expect, it } from "vitest";

import type { ChangedFile, GithubRequest, RepoRef } from "../core/github-requests";
import { runRefreshPr, type CreatePrPorts, type GithubResponse } from "./create-pr";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

const files: ChangedFile[] = [
  { kind: "upsert", path: "a.ts", content: "A", encoding: "utf-8" },
  { kind: "delete", path: "old.ts" },
];

const input = { repo, mergeBaseSha: "merge-base", headBranch: "feature", files, title: "Title" };

/** GitHub, у которого голова ветки PR стоит на дереве `headTree`, а новое дерево из файлов ветки — `tree-new`. */
function github(headTree: string): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  const reply = (req: GithubRequest): GithubResponse => {
    if (req.method === "GET" && req.path.endsWith("/branches/feature")) {
      return { status: 200, data: { commit: { sha: "head", commit: { tree: { sha: headTree } } } } };
    }
    if (req.method === "GET" && req.path.endsWith("/git/commits/merge-base")) return { status: 200, data: { sha: "merge-base", tree: { sha: "mb-tree" } } };
    if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: "blob-a" } };
    if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "tree-new" } };
    if (req.path.endsWith("/git/commits")) return { status: 201, data: { sha: "commit-new" } };
    if (req.method === "PATCH" && req.path.endsWith("/git/refs/heads/feature")) return { status: 200, data: {} };
    throw new Error(`unexpected request: ${req.method} ${req.path}`);
  };
  return {
    calls,
    ports: {
      async send(req) {
        calls.push(req);
        return reply(req);
      },
    },
  };
}

describe("runRefreshPr", () => {
  it("ветка на GitHub отстала → новый коммит от merge-base с деревом ветки, голова переставлена на него", async () => {
    const { ports, calls } = github("tree-old");

    expect(await runRefreshPr(ports, input)).toBe("updated");

    const tree = calls.find((c) => c.method === "POST" && c.path.endsWith("/git/trees"));
    expect(tree?.body).toMatchObject({ base_tree: "mb-tree" });
    const commit = calls.find((c) => c.method === "POST" && c.path.endsWith("/git/commits"));
    expect(commit?.body).toMatchObject({ tree: "tree-new", parents: ["merge-base"], message: "Title" });
    const moved = calls.find((c) => c.method === "PATCH");
    expect(moved?.body).toEqual({ sha: "commit-new", force: true });
  });

  it("на GitHub уже то же дерево → ни коммита, ни перестановки ветки", async () => {
    const { ports, calls } = github("tree-new");

    expect(await runRefreshPr(ports, input)).toBe("unchanged");

    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/git/commits"))).toBe(false);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("ветку держат бамп поверх слияния базы поверх коммита PR с тем же деревом → ветка не тронута", async () => {
    const calls: GithubRequest[] = [];
    const commit = (tree: string, parent: string) => ({ status: 200, data: { tree: { sha: tree }, parents: [{ sha: parent }] } });
    const replies: Record<string, GithubResponse> = {
      "/git/commits/update-merge": commit("tree-merged", "own"),
      "/git/commits/own": commit("tree-new", "merge-base"),
      "/git/commits/merge-base": { status: 200, data: { sha: "merge-base", tree: { sha: "mb-tree" } } },
    };
    const ports: CreatePrPorts = {
      async send(req) {
        calls.push(req);
        if (req.method === "GET" && req.path.endsWith("/branches/feature")) {
          return { status: 200, data: { commit: { sha: "bump", parents: [{ sha: "update-merge" }], commit: { tree: { sha: "tree-bumped" } } } } };
        }
        const known = Object.entries(replies).find(([suffix]) => req.method === "GET" && req.path.endsWith(suffix));
        if (known !== undefined) return known[1];
        if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: "blob-a" } };
        if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "tree-new" } };
        throw new Error(`unexpected request: ${req.method} ${req.path}`);
      },
    };

    expect(await runRefreshPr(ports, input)).toBe("unchanged");

    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/git/commits"))).toBe(false);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("ветки PR на GitHub нет → отказ с названной причиной, а не создание новой", async () => {
    const calls: GithubRequest[] = [];
    const ports: CreatePrPorts = {
      async send(req) {
        calls.push(req);
        return { status: 404, data: { message: "Branch not found" } };
      },
    };

    await expect(runRefreshPr(ports, input)).rejects.toThrow(/feature/);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
