// Layer 3 (shell), the testable part — the "measure once per HEAD" protocol
// shared by every button that needs to know whether a branch's content is
// already in the base.
//
// The measurement itself opens with a `git fetch` and costs seconds, while the
// buttons re-ask on every 20-second poll of an open thread. So the fact is
// measured once per HEAD and remembered in KV; a HEAD already recorded as
// merged skips the whole run. Only the POSITIVE fact is cached — a
// `not-merged` branch can land at any moment, so caching a negative would
// freeze the button in the wrong state.
//
// Both callers (the "Pull Request" button via visibility-decision.ts and the
// "Done & Archive" button via local-archive-facts.ts) hold the same KV record,
// so one measurement serves both.
import { resolveContentVerdict, type MergedContent } from "../core/merged-content";

export interface ContentCachePorts {
  /** Has this exact HEAD already been recorded as merged? */
  cachedHeadMatches(headSha: string | null): Promise<boolean>;
  /** Remember a HEAD whose content was measured as already in the base. */
  rememberMerged(headSha: string): Promise<void>;
  /** Measure the fact with git. The expensive step. */
  measure(): Promise<MergedContent>;
}

export async function measureContentCached(
  ports: ContentCachePorts,
  headSha: string | null,
): Promise<MergedContent> {
  const cached = await ports.cachedHeadMatches(headSha);
  const content = cached ? "unknown" : await ports.measure();
  if (content === "merged" && headSha) await ports.rememberMerged(headSha);
  // Folds cache and measurement: the fact wins when there is one, the cache
  // answers only when there is none, and a miss stays `unknown` rather than
  // guessing "not merged".
  return resolveContentVerdict(content, cached);
}
