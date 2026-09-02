import { describe, expect, it } from "vitest";
import { fetchNextPrNumber } from "./next-pr-number";
import type { CreatePrPorts, GithubResponse } from "./create-pr";
import type { GithubRequest, RepoRef } from "../core/github-requests";

const repo: RepoRef = { owner: "e0068", repo: "bb-plugins" };

function fakePorts(reply: GithubResponse): { ports: CreatePrPorts; calls: GithubRequest[] } {
  const calls: GithubRequest[] = [];
  return {
    calls,
    ports: {
      async send(req) {
        calls.push(req);
        return reply;
      },
    },
  };
}

describe("fetchNextPrNumber", () => {
  it("GETs the latest issue and returns its number + 1", async () => {
    const { ports, calls } = fakePorts({ status: 200, data: [{ number: 162 }] });
    await expect(fetchNextPrNumber(ports, repo)).resolves.toBe(163);
    expect(calls).toEqual([
      { method: "GET", path: "/repos/e0068/bb-plugins/issues?state=all&per_page=1" },
    ]);
  });

  it("a repo with no issues or PRs yet → 1", async () => {
    const { ports } = fakePorts({ status: 200, data: [] });
    await expect(fetchNextPrNumber(ports, repo)).resolves.toBe(1);
  });

  it("a non-200 (rate limit, auth failure) → unknown, not thrown", async () => {
    const { ports } = fakePorts({ status: 403, data: { message: "rate limited" } });
    await expect(fetchNextPrNumber(ports, repo)).resolves.toBeNull();
  });
});
