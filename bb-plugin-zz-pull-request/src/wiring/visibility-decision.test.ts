import { describe, expect, it } from "vitest";
import { resolveVisibility, type VisibilityPorts } from "./visibility-decision";
import type { MergedContent } from "../core/merged-content";

const READY = { headSha: "sha-1", hasUncommittedChanges: false, aheadCount: 8 };

function fakePorts(options: { cached?: boolean; measured?: MergedContent } = {}) {
  const log: string[] = [];
  const remembered: string[] = [];
  const ports: VisibilityPorts = {
    async cachedHeadMatches() {
      log.push("cache");
      return options.cached ?? false;
    },
    async rememberMerged(headSha) {
      remembered.push(headSha);
    },
    async measure() {
      log.push("measure");
      return options.measured ?? "unknown";
    },
  };
  return { ports, log, remembered };
}

describe("resolveVisibility", () => {
  // The regression this whole layer exists for: a PR merged by any route
  // (bb's native button, github.com, `gh`) leaves the branch's old commits
  // "ahead" forever, and nothing was ever written to KV. The content is what
  // settles it — see memory/decisions/pr-button-merged-by-content.md.
  it("content already in the base → hidden, even with ahead > 0 and an empty cache", async () => {
    const { ports } = fakePorts({ cached: false, measured: "merged" });

    expect(await resolveVisibility(ports, { workspace: READY, pr: "settled" })).toEqual({
      visible: false,
      reason: "already-merged",
    });
  });

  it("content not in the base yet → visible", async () => {
    const { ports } = fakePorts({ cached: false, measured: "not-merged" });

    expect(await resolveVisibility(ports, { workspace: READY, pr: "settled" })).toEqual({
      visible: true,
      reason: "ready",
    });
  });

  it("no answer from git and no cache → visible, the button is not withheld on a guess", async () => {
    const { ports } = fakePorts({ cached: false, measured: "unknown" });

    expect(await resolveVisibility(ports, { workspace: READY, pr: "absent" })).toEqual({
      visible: true,
      reason: "ready",
    });
  });

  it("a measured `merged` is remembered, so the next poll needs no git", async () => {
    const { ports, remembered } = fakePorts({ measured: "merged" });

    await resolveVisibility(ports, { workspace: READY, pr: "settled" });
    expect(remembered).toEqual(["sha-1"]);
  });

  it("`not-merged` and `unknown` are never cached — only the merged fact is", async () => {
    for (const measured of ["not-merged", "unknown"] as const) {
      const { ports, remembered } = fakePorts({ measured });
      await resolveVisibility(ports, { workspace: READY, pr: "settled" });
      expect(remembered).toEqual([]);
    }
  });

  it("a cache hit answers without measuring at all", async () => {
    const { ports, log } = fakePorts({ cached: true });

    expect(await resolveVisibility(ports, { workspace: READY, pr: "settled" })).toEqual({
      visible: false,
      reason: "already-merged",
    });
    expect(log).toEqual(["cache"]);
  });

  it("a detached/unborn checkout has no HEAD to remember, and none is invented", async () => {
    const { ports, remembered } = fakePorts({ measured: "merged" });
    const workspace = { ...READY, headSha: null };

    expect(await resolveVisibility(ports, { workspace, pr: "settled" })).toEqual({
      visible: false,
      reason: "already-merged",
    });
    expect(remembered).toEqual([]);
  });

  it("a decision that hides on its own never reaches the expensive step", async () => {
    const cases = [
      { workspace: { ...READY, hasUncommittedChanges: true }, pr: "absent" as const },
      { workspace: { ...READY, aheadCount: 0 }, pr: "absent" as const },
      { workspace: READY, pr: "open" as const },
      { workspace: READY, pr: "unknown" as const },
    ];

    for (const input of cases) {
      const { ports, log } = fakePorts({ measured: "merged" });
      const decision = await resolveVisibility(ports, input);
      expect(decision.visible).toBe(false);
      expect(log).toEqual([]);
    }
  });
});
