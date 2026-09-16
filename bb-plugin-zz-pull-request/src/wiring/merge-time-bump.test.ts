import { describe, expect, it } from "vitest";
import { bumpVersionsBeforeMerge } from "./merge-time-bump";
import { encodeBase64 } from "../core/base64";
import type { GithubRequest, RepoRef } from "../core/github-requests";
import type { CreatePrPorts, GithubResponse } from "./create-pr";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };
const input = { repo, baseBranch: "main", headBranch: "bb/thr_x", pullNumber: 42 };

interface WorldFile {
  /** package.json / package-lock.json text at a ref, keyed `<ref>:<path>`. */
  [key: string]: string;
}

interface World {
  behindBy: number;
  changedPaths: string[];
  files: WorldFile;
  /** HTTP status for the update-branch call; 202 is GitHub's success. */
  updateBranchStatus?: number;
  compareStatus?: number;
}

function fakeGithub(world: World): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  const ports: CreatePrPorts = {
    async send(req: GithubRequest): Promise<GithubResponse> {
      calls.push(req);
      if (req.path.includes("/compare/")) {
        const status = world.compareStatus ?? 200;
        return {
          status,
          data:
            status === 200
              ? { behind_by: world.behindBy, files: world.changedPaths.map((filename) => ({ filename })) }
              : { message: "Not Found" },
        };
      }
      if (req.path.endsWith("/update-branch")) {
        return { status: world.updateBranchStatus ?? 202, data: { message: "merge conflict" } };
      }
      if (req.path.includes("/contents/")) {
        const [, path, ref] = /\/contents\/(.+)\?ref=(.+)$/.exec(req.path) as RegExpExecArray;
        const text = world.files[`${decodeURIComponent(ref)}:${decodeURIComponent(path)}`];
        return text === undefined
          ? { status: 404, data: { message: "Not Found" } }
          : { status: 200, data: { encoding: "base64", content: encodeBase64(text) } };
      }
      if (req.path.includes("/branches/")) {
        return { status: 200, data: { commit: { sha: "headsha" } } };
      }
      if (req.path.endsWith("/git/commits") && req.method === "POST") {
        return { status: 201, data: { sha: "bumpsha" } };
      }
      if (req.path.includes("/git/commits/")) {
        return { status: 200, data: { tree: { sha: "headtree" } } };
      }
      if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: `blob${calls.length}` } };
      if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "newtree" } };
      if (req.path.includes("/git/refs/")) return { status: 200, data: {} };
      throw new Error(`unexpected request ${req.method} ${req.path}`);
    },
  };
  return { ports, calls };
}

const pkg = (version: string): string =>
  `${JSON.stringify({ name: "bb-plugin-x", version }, null, 2)}\n`;

const lock = (version: string): string =>
  `${JSON.stringify(
    { name: "bb-plugin-x", version, lockfileVersion: 3, packages: { "": { name: "bb-plugin-x", version } } },
    null,
    2,
  )}\n`;

function bodyOf(calls: readonly GithubRequest[], suffix: string): Record<string, unknown> {
  const call = calls.find((c) => c.path.endsWith(suffix) && c.method === "POST");
  return (call?.body ?? {}) as Record<string, unknown>;
}

describe("bumpVersionsBeforeMerge", () => {
  it("the PR touches no plugin at all → nothing read, nothing written", async () => {
    const { ports, calls } = fakeGithub({ behindBy: 0, changedPaths: ["memory/INDEX.md"], files: {} });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["memory/INDEX.md"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("the branch already carries a higher version → left alone, no commit", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("the base moved past the branch → a commit setting the version one past the BASE", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/package.json"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.12"),
      },
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-x/package.json"],
      bumped: [{ root: "bb-plugin-x", to: "0.2.13" }],
      problems: [],
      headMoved: true,
    });
    expect(bodyOf(calls, "/git/blobs").content).toContain(`"version": "0.2.13"`);
    expect(bodyOf(calls, "/git/commits")).toMatchObject({
      tree: "newtree",
      parents: ["headsha"],
    });
    expect(calls.some((c) => c.method === "PATCH" && c.path.includes("/git/refs/heads/bb/thr_x"))).toBe(true);
  });

  it("a package-lock.json alongside it follows to the very same version", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/server.ts"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-x/package-lock.json": lock("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    await bumpVersionsBeforeMerge(ports, input);
    const written = calls
      .filter((c) => c.path.endsWith("/git/blobs"))
      .map((c) => (c.body as { content: string }).content);
    expect(written).toHaveLength(2);
    expect(written.every((content) => content.includes(`"version": "0.2.12"`))).toBe(true);
  });

  it("the branch is behind the base → it is caught up first, pinned to the head we measured", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 4,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report.bumped).toEqual([{ root: "bb-plugin-x", to: "0.2.12" }]);
    expect(report.headMoved).toBe(true);
    const update = calls.find((c) => c.path.endsWith("/update-branch"));
    expect(update).toMatchObject({ method: "PUT", body: { expected_head_sha: "headsha" } });
    // The bump must be computed from the caught-up head: the package.json
    // read that feeds the commit comes AFTER the update-branch call.
    const reads = calls.map((c) => c.path.includes("/contents/"));
    expect(calls.indexOf(update as GithubRequest)).toBeLessThan(reads.lastIndexOf(true));
  });

  // Catching up rewrites the PR's head, and GitHub then recomputes its
  // mergeability — a merge fired in that window fails. Paying that price
  // when there is nothing to bump (the version already grew on an earlier
  // press) turned every retry of the Merge button into another rewrite.
  it("already ahead and behind the base → no catch-up, the head is left alone", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 4,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.12"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls.some((c) => c.path.endsWith("/update-branch"))).toBe(false);
    expect(calls.some((c) => c.path.includes("/git/"))).toBe(false);
  });

  it("catching up fails (a real conflict) → said out loud, and nothing is committed on top of it", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 4,
      updateBranchStatus: 422,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
      },
    });
    const report = await bumpVersionsBeforeMerge(ports, input);
    expect(report.bumped).toEqual([]);
    expect(report.problems).toEqual([
      "could not catch bb/thr_x up with main before bumping versions (HTTP 422: merge conflict)",
    ]);
    expect(report.headMoved).toBe(false);
    expect(calls.some((c) => c.path.includes("/git/blobs"))).toBe(false);
  });

  it("the comparison itself fails → reported, never read as \"nothing changed\"", async () => {
    const { ports } = fakeGithub({ behindBy: 0, compareStatus: 404, changedPaths: [], files: {} });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: [],
      bumped: [],
      problems: ["could not compare bb/thr_x with main (HTTP 404)"],
      headMoved: false,
    });
  });

  it("a touched root with no package.json anywhere is not a versioned root, and not a problem", async () => {
    const { ports, calls } = fakeGithub({
      behindBy: 0,
      changedPaths: ["packages/plugin-base/tsconfig.json"],
      files: {},
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["packages/plugin-base/tsconfig.json"],
      bumped: [],
      problems: [],
      headMoved: false,
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a version nobody can reason about is a problem, not a silent skip", async () => {
    const { ports } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("1.0.0-rc.1"),
        "main:bb-plugin-x/package.json": pkg("0.9.9"),
      },
    });
    expect(await bumpVersionsBeforeMerge(ports, input)).toEqual({
      changedPaths: ["bb-plugin-x/app.tsx"],
      bumped: [],
      problems: ["bb-plugin-x: no readable version on the branch"],
      headMoved: false,
    });
  });

  it("several touched plugins are each bumped against their own base version", async () => {
    const { ports } = fakeGithub({
      behindBy: 0,
      changedPaths: ["bb-plugin-x/app.tsx", "bb-plugin-y/server.ts"],
      files: {
        "bb/thr_x:bb-plugin-x/package.json": pkg("0.2.11"),
        "main:bb-plugin-x/package.json": pkg("0.2.11"),
        "bb/thr_x:bb-plugin-y/package.json": pkg("1.4.0"),
        "main:bb-plugin-y/package.json": pkg("1.4.7"),
      },
    });
    expect((await bumpVersionsBeforeMerge(ports, input)).bumped).toEqual([
      { root: "bb-plugin-x", to: "0.2.12" },
      { root: "bb-plugin-y", to: "1.4.8" },
    ]);
  });
});
