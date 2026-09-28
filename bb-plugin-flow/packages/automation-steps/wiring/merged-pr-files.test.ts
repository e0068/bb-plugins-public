import { describe, expect, it } from "vitest";
import { PULL_FILES_PAGE_SIZE, type GithubRequest, type RepoRef } from "../core/github-requests";
import type { CreatePrPorts, GithubResponse } from "./create-pr";
import { mergedPullRequestFiles } from "./merged-pr-files";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

interface World {
  /** What GitHub lists as the closed PRs of the branch. */
  closed?: unknown[];
  closedStatus?: number;
  /** Every file of PR #503, served page by page. */
  files?: string[];
  /** A page GitHub fails with, and the status it fails with. */
  failPage?: { page: number; status: number };
}

function fakeGithub(world: World): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  const ports: CreatePrPorts = {
    async send(req: GithubRequest): Promise<GithubResponse> {
      calls.push(req);
      if (req.path.includes("/pulls?head=") && req.path.endsWith("state=closed")) {
        const status = world.closedStatus ?? 200;
        return status === 200
          ? { status, data: world.closed ?? [{ number: 503, merged_at: "2026-09-24T19:36:23Z" }] }
          : { status, data: { message: "Bad credentials" } };
      }
      const files = /\/pulls\/503\/files\?per_page=(\d+)&page=(\d+)$/.exec(req.path);
      if (files) {
        const [size, page] = [Number(files[1]), Number(files[2])];
        if (world.failPage?.page === page) return { status: world.failPage.status, data: { message: "Server Error" } };
        const slice = (world.files ?? []).slice((page - 1) * size, page * size);
        return { status: 200, data: slice.map((filename) => ({ filename })) };
      }
      throw new Error(`unexpected request ${req.method} ${req.path}`);
    },
  };
  return { ports, calls };
}

const manyFiles = (count: number): string[] => Array.from({ length: count }, (_, i) => `bb-plugin-p${i}/index.ts`);

describe("mergedPullRequestFiles", () => {
  it("the merged PR is found by its branch name and its own files are read — no live branch needed", async () => {
    const { ports } = fakeGithub({ files: ["bb-plugin-flow/app.tsx", "docs/INDEX.md"] });
    expect(await mergedPullRequestFiles(ports, repo, "bb/thr_x", "main")).toEqual({
      ok: true,
      paths: ["bb-plugin-flow/app.tsx", "docs/INDEX.md"],
    });
  });

  it("a PR with more files than one page yields every file", async () => {
    const files = manyFiles(PULL_FILES_PAGE_SIZE * 2 + 7);
    const { ports } = fakeGithub({ files });
    const result = await mergedPullRequestFiles(ports, repo, "bb/thr_x", "main");
    expect(result).toEqual({ ok: true, paths: files });
  });

  it("a list that ends exactly on a page boundary stops at the empty page after it", async () => {
    const files = manyFiles(PULL_FILES_PAGE_SIZE);
    const { ports, calls } = fakeGithub({ files });
    const result = await mergedPullRequestFiles(ports, repo, "bb/thr_x", "main");
    expect(result).toEqual({ ok: true, paths: files });
    expect(calls.filter((c) => c.path.includes("/files?")).length).toBe(2);
  });

  it("no merged PR from the branch → named, and no file list is asked for", async () => {
    const { ports, calls } = fakeGithub({ closed: [{ number: 510, merged_at: null }] });
    expect(await mergedPullRequestFiles(ports, repo, "bb/thr_x", "main")).toEqual({
      ok: false,
      reason: "GitHub shows no merged pull request from bb/thr_x into main",
    });
    expect(calls.some((c) => c.path.includes("/files?"))).toBe(false);
  });

  it("GitHub failing the lookup is 'could not ask', with the status", async () => {
    const { ports } = fakeGithub({ closedStatus: 401 });
    expect(await mergedPullRequestFiles(ports, repo, "bb/thr_x", "main")).toEqual({
      ok: false,
      reason: "could not find the merged pull request (HTTP 401)",
    });
  });

  it("a page GitHub fails is a failure of the whole list, not a shorter list", async () => {
    const { ports } = fakeGithub({ files: manyFiles(PULL_FILES_PAGE_SIZE + 5), failPage: { page: 2, status: 502 } });
    expect(await mergedPullRequestFiles(ports, repo, "bb/thr_x", "main")).toEqual({
      ok: false,
      reason: "could not read the files of pull request #503 (HTTP 502)",
    });
  });
});
