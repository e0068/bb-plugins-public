import { describe, expect, it } from "vitest";
import { measureArchiveFacts, type ArchiveFactsPorts } from "./local-archive-facts";
import type { MergedContent } from "../core/merged-content";
import type { GitPorts, GitRun } from "./git-run";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });
const fail = (code = 1): GitRun => ({ code, stdout: "", stderr: "boom" });

/** A fake git that answers per command name and records the calls it was given. */
function fakeGit(answers: Record<string, GitRun>): GitPorts & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      return answers[args[0]] ?? fail(128);
    },
  };
}

/**
 * The content verdict arrives through the shared cache protocol
 * (content-cache.ts), whose own promises are pinned there — here it is a
 * stub, so these tests are about what THIS module does with the verdict.
 */
function ports(git: GitPorts, content: MergedContent): ArchiveFactsPorts & { measured: number[] } {
  const measured: number[] = [];
  return {
    git,
    measured,
    cachedHeadMatches: async () => false,
    rememberMerged: async () => {},
    measure: async () => {
      measured.push(1);
      return content;
    },
  };
}

const HEAD = { "rev-parse": ok("head1\n") };

describe("measureArchiveFacts", () => {
  it("content already in the base + clean tree → landed and clean", async () => {
    expect(await measureArchiveFacts(ports(fakeGit({ ...HEAD, status: ok("") }), "merged"))).toEqual({
      landing: "landed",
      workingTree: "clean",
    });
  });

  it("content already in the base + uncommitted changes → landed but dirty", async () => {
    const git = fakeGit({ ...HEAD, status: ok(" M app.tsx\n") });
    expect(await measureArchiveFacts(ports(git, "merged"))).toEqual({
      landing: "landed",
      workingTree: "dirty",
    });
  });

  it("landed, but git refuses to read the tree → landed with the tree unmeasured", async () => {
    const git = fakeGit({ ...HEAD, status: fail(128) });
    expect(await measureArchiveFacts(ports(git, "merged"))).toEqual({
      landing: "landed",
      workingTree: "unknown",
    });
  });

  it("the branch still carries content of its own → not-merged", async () => {
    expect(await measureArchiveFacts(ports(fakeGit(HEAD), "not-merged"))).toEqual({
      landing: "not-merged",
      workingTree: "unknown",
    });
  });

  it("no answer about the content → the landing stays unmeasured, never a negative", async () => {
    expect(await measureArchiveFacts(ports(fakeGit(HEAD), "unknown"))).toEqual({
      landing: "unknown",
      workingTree: "unknown",
    });
  });

  it("the tree is not measured once the landing already disqualifies the button", async () => {
    const git = fakeGit(HEAD);
    await measureArchiveFacts(ports(git, "not-merged"));
    expect(git.calls.map(([name]) => name)).not.toContain("status");
  });

  it("keys the cache on the local HEAD, read before anything expensive runs", async () => {
    const git = fakeGit({ ...HEAD, status: ok("") });
    const p = ports(git, "merged");
    await measureArchiveFacts(p);
    expect(git.calls[0]).toEqual(["rev-parse", "HEAD"]);
    expect(p.measured).toHaveLength(1);
  });

  it("an unreadable HEAD is no reason to invent one — the measurement still runs", async () => {
    const git = fakeGit({ "rev-parse": fail(128), status: ok("") });
    expect(await measureArchiveFacts(ports(git, "merged"))).toEqual({
      landing: "landed",
      workingTree: "clean",
    });
  });
});
