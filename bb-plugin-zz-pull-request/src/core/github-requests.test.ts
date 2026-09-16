import { describe, expect, it } from "vitest";
import {
  blobRequest,
  compareRequest,
  parseComparison,
  updateBranchRequest,
  buildTreeEntries,
  commitRequest,
  contentsRequest,
  createRefRequest,
  getCommitRequest,
  getPullRequestRequest,
  latestIssueRequest,
  listOpenPullRequestsRequest,
  parseFileContent,
  parseNextPrNumber,
  parseOpenPullRequest,
  parsePullMergeability,
  pullRequestRequest,
  treeRequest,
  updateRefRequest,
  type ChangedFile,
  type RepoRef,
} from "./github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

describe("getCommitRequest", () => {
  it("GET git/commits/<sha>", () => {
    expect(getCommitRequest(repo, "abc")).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/git/commits/abc",
    });
  });
});

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

describe("contentsRequest", () => {
  it("GET contents/<path>?ref=<ref>", () => {
    expect(contentsRequest(repo, "bb-plugin-x/package.json", "main")).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/contents/bb-plugin-x/package.json?ref=main",
    });
  });

  it("encodes a ref with characters unsafe in a query string", () => {
    expect(contentsRequest(repo, "package.json", "feature/a b").path).toBe(
      "/repos/e0068/bb-plugins/contents/package.json?ref=feature%2Fa%20b",
    );
  });

  it("encodes each path segment on its own, keeping the '/' separators", () => {
    expect(contentsRequest(repo, "bb-plugin x/pack age.json", "main").path).toBe(
      "/repos/e0068/bb-plugins/contents/bb-plugin%20x/pack%20age.json?ref=main",
    );
  });
});

describe("parseFileContent", () => {
  it("a file response's base64 content", () => {
    expect(parseFileContent({ type: "file", content: "aGVsbG8=\n", encoding: "base64" })).toBe(
      "aGVsbG8=\n",
    );
  });

  it("an error body (no content field) → unknown", () => {
    expect(parseFileContent({ message: "Not Found" })).toBeNull();
  });

  it("a file over 1 MB (empty content, no base64 encoding) → unknown, not an empty file", () => {
    expect(parseFileContent({ type: "file", content: "", encoding: "none" })).toBeNull();
  });

  it("a directory listing (an array) → unknown", () => {
    expect(parseFileContent([{ type: "file", content: "x" }])).toBeNull();
  });

  it("null or a non-object body → unknown", () => {
    expect(parseFileContent(null)).toBeNull();
    expect(parseFileContent("not an object")).toBeNull();
  });

  it("encoding: base64 but a non-string content field → unknown", () => {
    expect(parseFileContent({ type: "file", content: null, encoding: "base64" })).toBeNull();
  });
});

describe("listOpenPullRequestsRequest", () => {
  it("GET pulls filtered by head, base and state=open", () => {
    expect(listOpenPullRequestsRequest(repo, "bb/thr_abc", "main")).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/pulls?head=e0068%3Abb%2Fthr_abc&base=main&state=open",
    });
  });
});

describe("parseOpenPullRequest", () => {
  it("one open PR → its number and url", () => {
    expect(parseOpenPullRequest([{ number: 41, html_url: "https://github.com/e0068/bb-plugins/pull/41" }])).toEqual({
      number: 41,
      url: "https://github.com/e0068/bb-plugins/pull/41",
    });
  });

  it("takes the first entry when GitHub returns more than one", () => {
    expect(
      parseOpenPullRequest([
        { number: 41, html_url: "https://x/41" },
        { number: 40, html_url: "https://x/40" },
      ]),
    ).toEqual({ number: 41, url: "https://x/41" });
  });

  it("no open PR (empty array) → null", () => {
    expect(parseOpenPullRequest([])).toBeNull();
  });

  it("not an array (an error body) → null", () => {
    expect(parseOpenPullRequest({ message: "Not Found" })).toBeNull();
  });

  it("entry missing number or html_url → null", () => {
    expect(parseOpenPullRequest([{ number: 41 }])).toBeNull();
    expect(parseOpenPullRequest([{ html_url: "https://x/41" }])).toBeNull();
  });
});

describe("compareRequest", () => {
  it("asks GitHub how the head stands against the base, with the files it changed", () => {
    expect(compareRequest({ owner: "e0068", repo: "bb-plugins" }, "main", "bb/thr_x")).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/compare/main...bb/thr_x",
    });
  });

  it("escapes a branch name's segments but keeps the slashes GitHub needs to read the ref", () => {
    expect(compareRequest({ owner: "o", repo: "r" }, "main", "feature/a b").path).toBe(
      "/repos/o/r/compare/main...feature/a%20b",
    );
  });
});

describe("parseComparison", () => {
  const body = {
    behind_by: 3,
    files: [{ filename: "bb-plugin-x/app.tsx" }, { filename: "memory/INDEX.md" }],
  };

  it("reads how far behind the head is and which files it touches", () => {
    expect(parseComparison(body)).toEqual({
      behindBy: 3,
      changedPaths: ["bb-plugin-x/app.tsx", "memory/INDEX.md"],
    });
  });

  it("a comparison with no files listed is still a comparison", () => {
    expect(parseComparison({ behind_by: 0 })).toEqual({ behindBy: 0, changedPaths: [] });
  });

  it("an entry without a filename is dropped, not guessed at", () => {
    expect(parseComparison({ behind_by: 0, files: [{ sha: "abc" }] })).toEqual({
      behindBy: 0,
      changedPaths: [],
    });
  });

  it("an error body (no behind_by) → null", () => {
    expect(parseComparison({ message: "Not Found" })).toBeNull();
    expect(parseComparison(null)).toBeNull();
  });
});

describe("updateBranchRequest", () => {
  it("asks GitHub to merge the base into the PR branch, pinned to the head we looked at", () => {
    expect(updateBranchRequest({ owner: "o", repo: "r" }, 42, "abc123")).toEqual({
      method: "PUT",
      path: "/repos/o/r/pulls/42/update-branch",
      body: { expected_head_sha: "abc123" },
    });
  });
});

describe("getPullRequestRequest", () => {
  it("GET pulls/<number>", () => {
    expect(getPullRequestRequest(repo, 283)).toEqual({
      method: "GET",
      path: "/repos/e0068/bb-plugins/pulls/283",
    });
  });
});

// GitHub answers `mergeable: null` while it is still computing the PR after
// its head moved — that null is the whole reason this parser exists.
describe("parsePullMergeability", () => {
  it("true → mergeable, false → conflicting", () => {
    expect(parsePullMergeability({ mergeable: true })).toBe("mergeable");
    expect(parsePullMergeability({ mergeable: false })).toBe("conflicting");
  });

  it("null — still computing — and anything malformed read as unknown", () => {
    expect(parsePullMergeability({ mergeable: null })).toBe("unknown");
    expect(parsePullMergeability({})).toBe("unknown");
    expect(parsePullMergeability(null)).toBe("unknown");
    expect(parsePullMergeability("nope")).toBe("unknown");
  });
});
