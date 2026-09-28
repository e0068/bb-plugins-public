// Layer 1 (core) — turn raw git output from a failed local-main pull into a
// short, human reason for the "main not pulled" badge and its toast.
//
// git's own text is a multi-line advice block (`hint: ...`, ending in
// "Disable this message with git config advice.diverging false") plus a terse
// fatal line — unreadable dumped into a toast. This also names WHICH kind of
// failure it was, because they are not the same to the user:
//   - a divergence is permanent — the local branch has commits origin doesn't
//     (the usual state after a squash merge), and no retry fast-forwards it;
//   - a busy branch or uncommitted changes are transient — a retry works once
//     the other working copy is free or its changes are put away.
//
// The plugin runs git under LC_ALL=C (see git-client.ts), so the phrases keyed
// on here are stable English, not the caller's locale.
export function describeMainPullFailure(gitOutput: string): string {
  const text = gitOutput.trim();
  if (/not possible to fast-forward|non-fast-forward|can't be fast-forwarded/i.test(text)) {
    return "local main has diverged from origin and can't be fast-forwarded (the usual state after a squash merge)";
  }
  if (/refusing to (?:fetch|update) into branch .* checked out/i.test(text)) {
    return "main is checked out in another working copy — retry once it is free";
  }
  if (/changes .* would be overwritten|commit your changes or stash/i.test(text)) {
    return "the main working copy has uncommitted changes blocking the pull";
  }
  return stripGitAdvice(text);
}

// The fallback for an unrecognised failure: drop git's `hint:` advice lines
// (noise in a toast) and keep the real error/fatal lines. If nothing is left,
// the original text stands rather than an empty reason.
function stripGitAdvice(text: string): string {
  const kept = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^hint:/i.test(line));
  return kept.length > 0 ? kept.join("; ") : text;
}
