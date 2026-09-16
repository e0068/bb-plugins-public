// Shell — remembers which merged PRs the user has already seen, in the
// client's localStorage. A merged glyph holds on a thread row until the thread
// is visited once; after that the (thread, PR number) pair is recorded here so
// the glyph never comes back for that same merge. Keying by PR number (not just
// thread id) lets a fresh PR in the same thread show its own merged glyph.

const KEY = "bb-plugin-zz-pull-request:merged-seen";

/** The stable id for one merged event: a thread's branch and the PR number. */
export function seenId(threadId: string, prNumber: number): string {
  return `${threadId}#${prNumber}`;
}

export function loadSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveSeen(seen: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // A storage that rejects writes (private mode, quota) just means the glyph
    // reappears next session — not worth failing the decoration over.
  }
}
