import { describe, expect, it } from "vitest";
import {
  PULL_FILES_PAGE_SIZE,
  listMergedPullRequestsRequest,
  parseMergedPullNumber,
  parsePullFiles,
  pullFilesRequest,
  type RepoRef,
} from "./github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

describe("listMergedPullRequestsRequest", () => {
  it("asks for the closed PRs of one head→base pair — GitHub keeps the head's name after the branch is deleted", () => {
    expect(listMergedPullRequestsRequest(repo, "bb/thr_abc", "main")).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/pulls?head=e0068%3Abb%2Fthr_abc&base=main&state=closed",
    });
  });
});

describe("parseMergedPullNumber", () => {
  it("the first merged PR's number", () => {
    expect(parseMergedPullNumber([{ number: 503, merged_at: "2026-09-24T19:36:23Z" }])).toBe(503);
  });

  it("a PR closed without merging is passed over for the merged one after it", () => {
    expect(
      parseMergedPullNumber([
        { number: 510, merged_at: null },
        { number: 503, merged_at: "2026-09-24T19:36:23Z" },
      ]),
    ).toBe(503);
  });

  it("no merged PR among the closed ones → null", () => {
    expect(parseMergedPullNumber([{ number: 510, merged_at: null }])).toBeNull();
    expect(parseMergedPullNumber([])).toBeNull();
  });

  it("not an array (an error body) → null", () => {
    expect(parseMergedPullNumber({ message: "Not Found" })).toBeNull();
  });
});

describe("pullFilesRequest", () => {
  it("reads one page of the PR's own file list, a full page at a time", () => {
    expect(pullFilesRequest(repo, 503, 2)).toEqual({
      method: "GET",
      path: `/repos/e0068/bb-plugins/pulls/503/files?per_page=${PULL_FILES_PAGE_SIZE}&page=2`,
    });
  });
});

describe("parsePullFiles", () => {
  it("the file names of the page", () => {
    expect(parsePullFiles([{ filename: "bb-plugin-flow/app.tsx" }, { filename: "docs/INDEX.md" }])).toEqual([
      "bb-plugin-flow/app.tsx",
      "docs/INDEX.md",
    ]);
  });

  it("an empty page is an empty list, not a failure", () => {
    expect(parsePullFiles([])).toEqual([]);
  });

  it("not an array (an error body) → null", () => {
    expect(parsePullFiles({ message: "Not Found" })).toBeNull();
  });

  it("entries without a file name are dropped", () => {
    expect(parsePullFiles([{ filename: "a.ts" }, { status: "added" }, null])).toEqual(["a.ts"]);
  });
});
