import { describe, expect, it } from "vitest";
import { checkMergedContent } from "./merged-content";
import type { GitPorts, GitRun } from "./git-run";

const TREE = "83c99fce74321c0bbe9b3c67361a5c41006f43dd";
const OTHER_TREE = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });
const fail = (code = 1, stderr = "boom"): GitRun => ({ code, stdout: "", stderr });

/** Records the argv of every call and answers from the queue in order. */
function fakeGit(answers: readonly GitRun[]): GitPorts & { calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      return answers[index++] ?? fail(128, "unexpected call");
    },
  };
}

describe("checkMergedContent", () => {
  it("fetches the base first, then measures — a stale ref would lie", async () => {
    const git = fakeGit([ok(), ok(`${TREE}\n`), ok(`${TREE}\n`)]);

    expect(await checkMergedContent(git, "main")).toBe("merged");
    expect(git.calls).toEqual([
      ["fetch", "origin", "main"],
      ["merge-tree", "--write-tree", "origin/main", "HEAD"],
      ["rev-parse", "origin/main^{tree}"],
    ]);
  });

  it("the merge result differs from the base tree → the branch has its own content", async () => {
    const git = fakeGit([ok(), ok(`${OTHER_TREE}\n`), ok(`${TREE}\n`)]);

    expect(await checkMergedContent(git, "main")).toBe("not-merged");
  });

  it("a conflict is an answer, and the base tree is not even asked for", async () => {
    const git = fakeGit([ok(), { code: 1, stdout: `${OTHER_TREE}\n`, stderr: "" }]);

    expect(await checkMergedContent(git, "main")).toBe("not-merged");
    expect(git.calls).toHaveLength(2);
  });

  // Without a fetch the local `origin/<base>` may be stale — the very state
  // that produced the ghost button. A failed fetch means the fact cannot be
  // measured, so nothing is measured: the answer is `unknown`, and the
  // cached HEAD gets the final say upstream.
  it("a failed fetch stops the check — no measuring against a stale ref", async () => {
    const git = fakeGit([fail(128, "could not resolve host")]);

    expect(await checkMergedContent(git, "main")).toBe("unknown");
    expect(git.calls).toEqual([["fetch", "origin", "main"]]);
  });

  it("a git failure inside the measurement gives no answer", async () => {
    const git = fakeGit([ok(), fail(128), ok(`${TREE}\n`)]);

    expect(await checkMergedContent(git, "main")).toBe("unknown");
  });

  it("a base name with a slash reaches git unchanged", async () => {
    const git = fakeGit([ok(), ok(`${TREE}\n`), ok(`${TREE}\n`)]);

    await checkMergedContent(git, "release/1.2");
    expect(git.calls[1]).toEqual([
      "merge-tree",
      "--write-tree",
      "origin/release/1.2",
      "HEAD",
    ]);
  });
});
