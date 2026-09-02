import { describe, expect, it } from "vitest";
import {
  blobRequest,
  buildTreeEntries,
  commitRequest,
  createRefRequest,
  latestIssueRequest,
  parseNextPrNumber,
  pullRequestRequest,
  treeRequest,
  updateRefRequest,
  type ChangedFile,
  type RepoRef,
} from "./github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

describe("blobRequest", () => {
  it("POST git/blobs with content and encoding", () => {
    expect(blobRequest(repo, "hello", "utf-8")).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/blobs",
      body: { content: "hello", encoding: "utf-8" },
    });
  });
});

describe("buildTreeEntries", () => {
  it("upsert takes sha from the map, delete gives sha: null", () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "a.ts", content: "x", encoding: "utf-8" },
      { kind: "delete", path: "old.ts" },
    ];
    expect(buildTreeEntries(files, { "a.ts": "sha-a" })).toEqual([
      { path: "a.ts", mode: "100644", type: "blob", sha: "sha-a" },
      { path: "old.ts", mode: "100644", type: "blob", sha: null },
    ]);
  });

  it("no sha for an upsert — an error, not a silent skip", () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "a.ts", content: "x", encoding: "utf-8" },
    ];
    expect(() => buildTreeEntries(files, {})).toThrow(/a\.ts/);
  });
});

describe("treeRequest", () => {
  it("POST git/trees with base_tree and entries", () => {
    const entries = [{ path: "a", mode: "100644" as const, type: "blob" as const, sha: "s" }];
    expect(treeRequest(repo, "base-tree", entries)).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/trees",
      body: { base_tree: "base-tree", tree: entries },
    });
  });
});

describe("commitRequest", () => {
  it("POST git/commits with a single parent", () => {
    expect(
      commitRequest(repo, { message: "m", treeSha: "t", parentSha: "p" }),
    ).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/commits",
      body: { message: "m", tree: "t", parents: ["p"] },
    });
  });
});

describe("ref requests", () => {
  it("create — POST git/refs with the full ref", () => {
    expect(createRefRequest(repo, "feature", "c")).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/refs",
      body: { ref: "refs/heads/feature", sha: "c" },
    });
  });

  it("update — PATCH git/refs/heads/<branch> with force", () => {
    expect(updateRefRequest(repo, "feature", "c")).toEqual({
      method: "PATCH",
      path: "/repos/e0068/bb-plugins/git/refs/heads/feature",
      body: { sha: "c", force: true },
    });
  });
});

describe("pullRequestRequest", () => {
  it("POST pulls with head/base", () => {
    expect(
      pullRequestRequest(repo, { title: "T", body: "B", head: "feature", base: "main" }),
    ).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/pulls",
      body: { title: "T", body: "B", head: "feature", base: "main" },
    });
  });
});

describe("latestIssueRequest", () => {
  it("GET issues, newest first, one result", () => {
    expect(latestIssueRequest(repo)).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/issues?state=all&per_page=1",
    });
  });
});

describe("parseNextPrNumber", () => {
  it("latest issue/PR number 41 → next is 42", () => {
    expect(parseNextPrNumber([{ number: 41 }])).toBe(42);
  });

  it("no issues or PRs yet → next is 1", () => {
    expect(parseNextPrNumber([])).toBe(1);
  });

  it("not an array (an error body) → unknown", () => {
    expect(parseNextPrNumber({ message: "Not Found" })).toBeNull();
  });

  it("array entry without a number field → unknown", () => {
    expect(parseNextPrNumber([{}])).toBeNull();
  });
});
