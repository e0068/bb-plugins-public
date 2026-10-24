// bb 0.47.1 убрал из SDK environments.mergePullRequest: «Смёрджить PR» падал на «is not a function». Без метода хоста PR
// вливается запросом к самому GitHub; хост с методом вливает, как раньше.
import { describe, expect, it } from "vitest";

import type { GithubRequest, RepoRef } from "../core/github-requests";
import type { GithubResponse } from "../wiring/create-pr";
import { mergeThroughHostOrGithub, type GithubPull, type Sdk } from "./pr-helpers";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

const pull = (status: number, data: unknown = {}): { gh: GithubPull; calls: GithubRequest[] } => {
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
        return { status, data };
      },
    },
  };
  return { gh, calls };
};

const sdkWithout = { environments: {} } as unknown as Sdk;

describe("mergeThroughHostOrGithub", () => {
  it("без метода хоста вливает PR запросом PUT /pulls/42/merge с методом merge", async () => {
    const { gh, calls } = pull(200, { merged: true });
    await mergeThroughHostOrGithub(sdkWithout, gh, "e1")();
    expect(calls).toEqual([{ method: "PUT", path: "/repos/e0068/bb-plugins/pulls/42/merge", body: { merge_method: "merge" } }]);
  });

  it("отказ GitHub — исключение с кодом и текстом GitHub", async () => {
    const { gh } = pull(405, { message: "Pull Request is not mergeable" });
    await expect(mergeThroughHostOrGithub(sdkWithout, gh, "e1")()).rejects.toThrow("GitHub refused the merge: HTTP 405 — Pull Request is not mergeable");
  });

  it("PR не найден на GitHub — исключение с причиной, без запроса", async () => {
    await expect(mergeThroughHostOrGithub(sdkWithout, { ok: false, reason: "no token" }, "e1")()).rejects.toThrow("no token");
  });

  it("хост с методом вливает сам, GitHub не спрашивается", async () => {
    const merged: string[] = [];
    const sdk = { environments: { mergePullRequest: async ({ environmentId, method }: { environmentId: string; method: string }) => void merged.push(`${environmentId}:${method}`) } } as unknown as Sdk;
    const { gh, calls } = pull(200);
    await mergeThroughHostOrGithub(sdk, gh, "e1")();
    expect(merged).toEqual(["e1:merge"]);
    expect(calls).toEqual([]);
  });
});
