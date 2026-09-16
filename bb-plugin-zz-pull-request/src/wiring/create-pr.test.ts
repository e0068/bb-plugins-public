import { describe, expect, it } from "vitest";
import { runCreatePr, type GithubResponse, type CreatePrPorts } from "./create-pr";
import type { ChangedFile, GithubRequest, RepoRef } from "../core/github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

const files: ChangedFile[] = [
  { kind: "upsert", path: "a.ts", content: "A", encoding: "utf-8" },
  { kind: "delete", path: "old.ts" },
];

// Fake send: queues replies + records calls. The reply is picked by a
// function based on the request, which lets tests return 200/404 for
// getBranch head in different cases.
function fakePorts(
  reply: (req: GithubRequest) => GithubResponse,
): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
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

const base = {
  status: 200,
  data: { commit: { sha: "base-tip", commit: { tree: { sha: "base-tip-tree" } } } },
};

const mergeBaseCommit = { status: 200, data: { sha: "merge-base", tree: { sha: "mb-tree" } } };

function happyReply(headExists: boolean, mergeBase: GithubResponse = mergeBaseCommit) {
  return (req: GithubRequest): GithubResponse => {
    if (req.method === "GET" && req.path.endsWith("/branches/main")) return base;
    if (req.method === "GET" && req.path.endsWith("/git/commits/merge-base")) return mergeBase;
    if (req.method === "GET" && req.path.endsWith("/branches/feature")) {
      return headExists
        ? { status: 200, data: { name: "feature" } }
        : { status: 404, data: { message: "Branch not found" } };
    }
    if (req.path.endsWith("/git/blobs")) return { status: 201, data: { sha: "blob-a" } };
    if (req.path.endsWith("/git/trees")) return { status: 201, data: { sha: "tree-new" } };
    if (req.path.endsWith("/git/commits")) return { status: 201, data: { sha: "commit-new" } };
    if (req.path.endsWith("/git/refs")) return { status: 201, data: {} };
    if (req.method === "PATCH" && req.path.includes("/git/refs/heads/"))
      return { status: 200, data: {} };
    if (req.path.endsWith("/pulls"))
      return { status: 201, data: { html_url: "https://github.com/e0068/bb-plugins/pull/7", number: 7 } };
    throw new Error(`unexpected request: ${req.method} ${req.path}`);
  };
}

const input = {
  repo,
  baseBranch: "main",
  mergeBaseSha: "merge-base",
  headBranch: "feature",
  files,
  title: "Title",
  body: "Body",
};

describe("runCreatePr", () => {
  it("new branch: blob→tree→commit→createRef→pull, returns url and number", async () => {
    const { ports, calls } = fakePorts(happyReply(false));
    const result = await runCreatePr(ports, input);

    expect(result).toEqual({
      url: "https://github.com/e0068/bb-plugins/pull/7",
      number: 7,
    });
    // A blob is only created for upsert (not for delete).
    const blobCalls = calls.filter((c) => c.path.endsWith("/git/blobs"));
    expect(blobCalls).toHaveLength(1);
    const tree = calls.find((c) => c.method === "POST" && c.path.endsWith("/git/trees"))!;
    expect((tree.body as { tree: unknown[] }).tree).toEqual([
      { path: "a.ts", mode: "100644", type: "blob", sha: "blob-a" },
      { path: "old.ts", mode: "100644", type: "blob", sha: null },
    ]);
    // The branch didn't exist — we create the ref rather than update it.
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs"))).toBe(true);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("the commit sits on the merge-base, not on the base's tip: its parent and base_tree come from the merge-base", async () => {
    const { ports, calls } = fakePorts(happyReply(false));
    await runCreatePr(ports, input);
    const tree = calls.find((c) => c.method === "POST" && c.path.endsWith("/git/trees"))!;
    expect((tree.body as { base_tree: string }).base_tree).toBe("mb-tree");
    const commit = calls.find((c) => c.method === "POST" && c.path.endsWith("/git/commits"))!;
    expect((commit.body as { parents: string[] }).parents).toEqual(["merge-base"]);
  });

  it("branch already on remote: ref is updated (PATCH), not created", async () => {
    const { ports, calls } = fakePorts(happyReply(true));
    await runCreatePr(ports, input);
    expect(calls.some((c) => c.method === "PATCH" && c.path.includes("/git/refs/heads/feature"))).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs"))).toBe(false);
  });

  it("base not found — a clear error", async () => {
    const { ports } = fakePorts((req) =>
      req.path.endsWith("/branches/main")
        ? { status: 404, data: { message: "Not Found" } }
        : { status: 200, data: {} },
    );
    await expect(runCreatePr(ports, input)).rejects.toThrow(/base "main" not found/);
  });

  it("merge-base not on GitHub (base force-pushed) — an error naming the step and the sha", async () => {
    const missing = { status: 404, data: { message: "Not Found" } };
    const { ports, calls } = fakePorts(happyReply(false, missing));
    await expect(runCreatePr(ports, input)).rejects.toThrow(/reading merge-base merge-b.*Not Found/);
    expect(calls.some((c) => c.path.endsWith("/git/blobs"))).toBe(false);
  });

  it("blob creation failure — an error with the step and GitHub's message", async () => {
    const { ports } = fakePorts((req) => {
      if (req.path.endsWith("/branches/main")) return base;
      if (req.path.endsWith("/git/commits/merge-base")) return mergeBaseCommit;
      if (req.path.endsWith("/git/blobs"))
        return { status: 403, data: { message: "rate limited" } };
      return { status: 200, data: {} };
    });
    await expect(runCreatePr(ports, input)).rejects.toThrow(/creating blob a\.ts.*rate limited/);
  });
});
