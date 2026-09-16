import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForMergeability } from "./mergeability-wait";
import type { GithubRequest, RepoRef } from "../core/github-requests";
import type { CreatePrPorts, GithubResponse } from "./create-pr";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

// GitHub as it behaves after a PR's head moved: `mergeable` is null for a
// while, then a verdict. `answers` is consumed one per poll; the last one
// repeats forever.
function github(answers: readonly (boolean | null)[]) {
  const calls: GithubRequest[] = [];
  const ports: CreatePrPorts = {
    async send(req: GithubRequest): Promise<GithubResponse> {
      calls.push(req);
      const mergeable = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { status: 200, data: { mergeable } };
    },
  };
  return { ports, calls };
}

describe("waitForMergeability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks GitHub itself, not a cache: GET pulls/<number>", async () => {
    const { ports, calls } = github([true]);
    await waitForMergeability(ports, repo, 283);
    expect(calls).toEqual([{ method: "GET", path: "/repos/e0068/bb-plugins/pulls/283" }]);
  });

  it("holds while mergeable is null and returns the verdict the moment it is in", async () => {
    const { ports, calls } = github([null, null, null, true]);
    const waiting = waitForMergeability(ports, repo, 283);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await waiting).toBe("mergeable");
    expect(calls).toHaveLength(4);
  });

  it("a conflict is a verdict too — no point waiting for a merge that will be refused", async () => {
    const { ports } = github([null, false]);
    const waiting = waitForMergeability(ports, repo, 283);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await waiting).toBe("conflicting");
  });

  it("gives up after 30 seconds with unknown — the merge is then attempted so bb's own error is the one reported", async () => {
    const { ports, calls } = github([null]);
    const waiting = waitForMergeability(ports, repo, 283);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls.length).toBeGreaterThanOrEqual(29);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waiting).toBe("unknown");
  });

  it("a failed request counts as unknown and keeps polling rather than aborting", async () => {
    const calls: GithubRequest[] = [];
    const ports: CreatePrPorts = {
      async send(req) {
        calls.push(req);
        return calls.length < 3
          ? { status: 502, data: { message: "bad gateway" } }
          : { status: 200, data: { mergeable: true } };
      },
    };
    const waiting = waitForMergeability(ports, repo, 283);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waiting).toBe("mergeable");
    expect(calls).toHaveLength(3);
  });
});
