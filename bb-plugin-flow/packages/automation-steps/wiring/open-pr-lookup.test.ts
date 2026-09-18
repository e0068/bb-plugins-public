import { describe, expect, it } from "vitest";
import { findLiveOpenPr } from "./open-pr-lookup";
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

describe("findLiveOpenPr", () => {
  it("GETs open PRs for the head→base pair and returns the found one", async () => {
    const { ports, calls } = fakePorts({
      status: 200,
      data: [{ number: 41, html_url: "https://github.com/e0068/bb-plugins/pull/41" }],
    });
    await expect(findLiveOpenPr(ports, repo, "bb/thr_abc", "main")).resolves.toEqual({
      number: 41,
      url: "https://github.com/e0068/bb-plugins/pull/41",
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/repos/e0068/bb-plugins/pulls?head=e0068%3Abb%2Fthr_abc&base=main&state=open",
      },
    ]);
  });

  it("no open PR → null", async () => {
    const { ports } = fakePorts({ status: 200, data: [] });
    await expect(findLiveOpenPr(ports, repo, "bb/thr_abc", "main")).resolves.toBeNull();
  });

  it("a non-200 (rate limit, auth failure) → null, not thrown", async () => {
    const { ports } = fakePorts({ status: 403, data: { message: "rate limited" } });
    await expect(findLiveOpenPr(ports, repo, "bb/thr_abc", "main")).resolves.toBeNull();
  });
});
