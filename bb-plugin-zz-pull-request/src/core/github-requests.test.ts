import { describe, expect, it } from "vitest";
import {
  blobRequest,
  buildTreeEntries,
  commitRequest,
  createRefRequest,
  pullRequestRequest,
  treeRequest,
  updateRefRequest,
  type ChangedFile,
  type RepoRef,
} from "./github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

describe("blobRequest", () => {
  it("POST git/blobs с содержимым и кодировкой", () => {
    expect(blobRequest(repo, "hello", "utf-8")).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/blobs",
      body: { content: "hello", encoding: "utf-8" },
    });
  });
});

describe("buildTreeEntries", () => {
  it("upsert берёт sha из карты, delete даёт sha: null", () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "a.ts", content: "x", encoding: "utf-8" },
      { kind: "delete", path: "old.ts" },
    ];
    expect(buildTreeEntries(files, { "a.ts": "sha-a" })).toEqual([
      { path: "a.ts", mode: "100644", type: "blob", sha: "sha-a" },
      { path: "old.ts", mode: "100644", type: "blob", sha: null },
    ]);
  });

  it("нет sha для upsert — ошибка, а не тихий пропуск", () => {
    const files: ChangedFile[] = [
      { kind: "upsert", path: "a.ts", content: "x", encoding: "utf-8" },
    ];
    expect(() => buildTreeEntries(files, {})).toThrow(/a\.ts/);
  });
});

describe("treeRequest", () => {
  it("POST git/trees с base_tree и записями", () => {
    const entries = [{ path: "a", mode: "100644" as const, type: "blob" as const, sha: "s" }];
    expect(treeRequest(repo, "base-tree", entries)).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/trees",
      body: { base_tree: "base-tree", tree: entries },
    });
  });
});

describe("commitRequest", () => {
  it("POST git/commits с одним родителем", () => {
    expect(
      commitRequest(repo, { message: "m", treeSha: "t", parentSha: "p" }),
    ).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/commits",
      body: { message: "m", tree: "t", parents: ["p"] },
    });
  });
});

describe("ref-запросы", () => {
  it("create — POST git/refs с полным ref", () => {
    expect(createRefRequest(repo, "feature", "c")).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/git/refs",
      body: { ref: "refs/heads/feature", sha: "c" },
    });
  });

  it("update — PATCH git/refs/heads/<branch> с force", () => {
    expect(updateRefRequest(repo, "feature", "c")).toEqual({
      method: "PATCH",
      path: "/repos/e0068/bb-plugins/git/refs/heads/feature",
      body: { sha: "c", force: true },
    });
  });
});

describe("pullRequestRequest", () => {
  it("POST pulls с head/base", () => {
    expect(
      pullRequestRequest(repo, { title: "T", body: "B", head: "feature", base: "main" }),
    ).toEqual({
      method: "POST",
      path: "/repos/e0068/bb-plugins/pulls",
      body: { title: "T", body: "B", head: "feature", base: "main" },
    });
  });
});
