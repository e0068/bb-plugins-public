import { describe, expect, it } from "vitest";
import { describeMainPullFailure } from "./main-pull-reason";

// git runs under LC_ALL=C (see git-client.ts), so these are the stable English
// shapes the classifier keys on.
const DIVERGED_MERGE = [
  "hint: Diverging branches can't be fast-forwarded, you need to either:",
  "hint:   git merge --no-ff",
  "hint:   git rebase",
  'hint: Disable this message with "git config advice.diverging false"',
  "fatal: Not possible to fast-forward, aborting.",
].join("\n");

const DIVERGED_FETCH = [
  "From github.com:e0068/bb-plugins",
  " ! [rejected]          main -> main (non-fast-forward)",
  "error: some local refs could not be updated; try to run",
  " 'git remote prune origin' to remove any old, conflicting branches",
].join("\n");

const CHECKED_OUT_ELSEWHERE =
  "fatal: refusing to fetch into branch 'refs/heads/main' checked out at '/Users/e0068/Documents/Projects/bb-plugins'";

const UNCOMMITTED = [
  "error: Your local changes to the following files would be overwritten by merge:",
  "\tsrc/app.tsx",
  "Please commit your changes or stash them before you merge.",
  "Aborting",
].join("\n");

describe("describeMainPullFailure", () => {
  it("a merge that can't be fast-forwarded → one line naming the divergence, no hint block", () => {
    const reason = describeMainPullFailure(DIVERGED_MERGE);
    expect(reason).toContain("diverged");
    expect(reason).not.toContain("hint:");
    expect(reason).not.toContain("advice");
  });

  it("a fetch rejected as non-fast-forward → the same divergence reason", () => {
    expect(describeMainPullFailure(DIVERGED_FETCH)).toBe(describeMainPullFailure(DIVERGED_MERGE));
  });

  it("the branch is checked out in another working copy → a transient 'busy' reason, distinct from divergence", () => {
    const busy = describeMainPullFailure(CHECKED_OUT_ELSEWHERE);
    expect(busy).toContain("another working copy");
    expect(busy).not.toBe(describeMainPullFailure(DIVERGED_MERGE));
  });

  it("uncommitted changes block the pull → their own reason, no raw git noise", () => {
    const dirty = describeMainPullFailure(UNCOMMITTED);
    expect(dirty).toContain("uncommitted");
    expect(dirty).not.toContain("Aborting");
  });

  it("an unrecognised failure → the text with git's hint lines stripped", () => {
    const reason = describeMainPullFailure("hint: try harder\nfatal: no network");
    expect(reason).toBe("fatal: no network");
  });

  it("a bare exit-code fallback survives unchanged", () => {
    expect(describeMainPullFailure("code 128")).toBe("code 128");
  });
});
