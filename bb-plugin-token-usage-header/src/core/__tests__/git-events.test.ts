import { describe, expect, it } from "vitest";
import {
  gitEventLabel,
  gitEventLinkUrl,
  gitEventSchema,
  githubRepoSlugFromRemoteUrl,
  shortCommitHash,
  type GitEvent,
} from "../git-events";

describe("gitEventSchema", () => {
  it("accepts a valid commit event", () => {
    const event = {
      type: "commit",
      ts: "2026-08-26T23:00:00.000Z",
      hash: "a5ee9a4b3c2d1e0f",
      message: "token-usage-header 0.2.0",
      url: "https://github.com/e0068/bb-plugins/commit/a5ee9a4b3c2d1e0f",
    };
    expect(gitEventSchema.safeParse(event).success).toBe(true);
  });

  it("accepts a push event with a null branch and null url", () => {
    const event = { type: "push", ts: "2026-08-26T23:00:00.000Z", branch: null, url: null };
    expect(gitEventSchema.safeParse(event).success).toBe(true);
  });

  it("accepts a pr event", () => {
    const event = {
      type: "pr",
      ts: "2026-08-26T23:00:00.000Z",
      number: 73,
      url: "https://github.com/e0068/bb-plugins/pull/73",
      repository: "e0068/bb-plugins",
    };
    expect(gitEventSchema.safeParse(event).success).toBe(true);
  });

  it("accepts a merge event", () => {
    const event = {
      type: "merge",
      ts: "2026-08-26T23:00:00.000Z",
      number: 73,
      url: "https://github.com/e0068/bb-plugins/pull/73",
      repository: "e0068/bb-plugins",
    };
    expect(gitEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects a pr event with a null url (unlike commit/push, pr/merge always have one)", () => {
    const event = { type: "pr", ts: "t", number: 1, url: null, repository: "a/b" };
    expect(gitEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(gitEventSchema.safeParse({ type: "bogus", ts: "t" }).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    const event = { type: "push", ts: "t", branch: null, url: null, extra: true };
    expect(gitEventSchema.safeParse(event).success).toBe(false);
  });
});

describe("githubRepoSlugFromRemoteUrl", () => {
  it.each([
    ["git@github.com:e0068/bb-plugins.git", "e0068/bb-plugins"],
    ["git@github.com:e0068/bb-plugins", "e0068/bb-plugins"],
    ["https://github.com/e0068/bb-plugins.git", "e0068/bb-plugins"],
    ["https://github.com/e0068/bb-plugins", "e0068/bb-plugins"],
    ["ssh://git@github.com/e0068/bb-plugins.git", "e0068/bb-plugins"],
    ["https://github.com/e0068/bb-plugins/", "e0068/bb-plugins"],
  ])("parses %s -> %s", (remote, expected) => {
    expect(githubRepoSlugFromRemoteUrl(remote)).toBe(expected);
  });

  it.each([
    ["git@gitlab.com:owner/repo.git"],
    ["https://gitlab.com/owner/repo"],
    [""],
    ["not a url at all"],
  ])("returns null for a non-GitHub or malformed remote (%s)", (remote) => {
    expect(githubRepoSlugFromRemoteUrl(remote)).toBeNull();
  });
});

describe("shortCommitHash", () => {
  it("truncates to 7 characters", () => {
    expect(shortCommitHash("a5ee9a4b3c2d1e0f")).toBe("a5ee9a4");
  });

  it("returns a shorter hash unchanged", () => {
    expect(shortCommitHash("a5e")).toBe("a5e");
  });
});

describe("gitEventLabel", () => {
  it("formats a commit as its short hash plus message", () => {
    const event: GitEvent = { type: "commit", ts: "t", hash: "a5ee9a4b3c2d1e0f", message: "fix bug", url: null };
    expect(gitEventLabel(event)).toBe("a5ee9a4 fix bug");
  });

  it("formats a push with a known branch", () => {
    const event: GitEvent = { type: "push", ts: "t", branch: "main", url: null };
    expect(gitEventLabel(event)).toBe("Push → main");
  });

  it("formats a push with an unknown branch", () => {
    const event: GitEvent = { type: "push", ts: "t", branch: null, url: null };
    expect(gitEventLabel(event)).toBe("Push");
  });

  it("formats a pr", () => {
    const event: GitEvent = { type: "pr", ts: "t", number: 73, url: "u", repository: "a/b" };
    expect(gitEventLabel(event)).toBe("PR #73 opened");
  });

  it("formats a merge", () => {
    const event: GitEvent = { type: "merge", ts: "t", number: 73, url: "u", repository: "a/b" };
    expect(gitEventLabel(event)).toBe("PR #73 merged");
  });
});

describe("gitEventLinkUrl", () => {
  it("returns the event's own url field for every variant", () => {
    expect(gitEventLinkUrl({ type: "commit", ts: "t", hash: "h", message: "m", url: "u" })).toBe("u");
    expect(gitEventLinkUrl({ type: "push", ts: "t", branch: null, url: null })).toBeNull();
    expect(gitEventLinkUrl({ type: "pr", ts: "t", number: 1, url: "u", repository: "a/b" })).toBe("u");
    expect(gitEventLinkUrl({ type: "merge", ts: "t", number: 1, url: "u", repository: "a/b" })).toBe("u");
  });
});
