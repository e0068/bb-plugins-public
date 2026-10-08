// Resolves a BB threadId to the Claude Code sessions that tools/tokens.py
// counts against, via `bb.sdk.threads.events.list`. Never touches
// ~/.bb/bb.db directly — that database belongs to the bb server, not this
// plugin.
//
// A thread is not tied to one session for life: when the provider starts a
// new Claude Code session, bb writes another `thread/identity` event. The
// thread's current session is the one named by its latest identity event;
// the earlier ones still belong to the thread.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Caps how many threads' sessions are kept in memory. */
const DEFAULT_MAX_CACHE_ENTRIES = 500;

export interface ThreadSessionResolverOptions {
  /** Cache bound; defaults to 500 threads — a scan over more threads than this re-reads every one of them each time. */
  maxCacheEntries?: number;
  /** Clock for "checked at" stamps compared with a thread's own `updatedAt` (both in ms, on the same machine); defaults to Date.now. */
  now?: () => number;
}

export interface ThreadSessionResolver {
  /**
   * Every Claude Code session the thread has run on, each once, oldest
   * first; empty while the thread has no `thread/identity` event yet.
   * `changedAt` — the `updatedAt` of a thread that isn't running — lets a
   * scan skip the lookup when it hasn't changed since it was last checked;
   * without it the lookup always runs. Pass it only for a thread at rest:
   * bb writes identity events inside a run without touching `updatedAt`, and
   * only the run's closing transition moves `updatedAt` past them. A lookup
   * only reads the identity events after the last one already seen.
   */
  sessionsOf(threadId: string, changedAt?: number): Promise<readonly string[]>;
  /** The thread's current session — the one its latest identity event names — or null when it has none yet. */
  resolve(threadId: string): Promise<string | null>;
  clearCache(): void;
}

/**
 * What is known about one thread's sessions: all of them in order, the current
 * one, the last identity event read and when it was checked. A thread with no
 * identity event yet is known as no sessions, `current` and `lastSeq` null.
 */
interface KnownSessions {
  sessions: readonly string[];
  current: string | null;
  lastSeq: string | null;
  checkedAt: number;
}

const NOTHING_KNOWN: Omit<KnownSessions, "checkedAt"> = { sessions: [], current: null, lastSeq: null };

/** Folds newly read identity events (in seq order) into what was known before. */
function withEvents(known: Omit<KnownSessions, "checkedAt">, events: ReadonlyArray<{ seq: number | string; sessionId: string }>, checkedAt: number): KnownSessions {
  const last = events[events.length - 1];
  if (last === undefined) return { ...known, checkedAt };
  const sessions = events.reduce<readonly string[]>((acc, e) => (acc.includes(e.sessionId) ? acc : [...acc, e.sessionId]), known.sessions);
  return { sessions, current: last.sessionId, lastSeq: String(last.seq), checkedAt };
}

export function createThreadSessionResolver(bb: BbPluginApi, options: ThreadSessionResolverOptions = {}): ThreadSessionResolver {
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const now = options.now ?? Date.now;
  // Map iteration order is insertion order and every refresh re-inserts its
  // thread, so the first key is the least recently refreshed — a bounded LRU
  // without a dedicated structure. "No session yet" is remembered too: the
  // header's resolve() re-reads on every call anyway, and a scan re-reads a
  // thread once it runs, which is when its first identity event appears.
  const cache = new Map<string, KnownSessions>();

  function remember(threadId: string, known: KnownSessions) {
    cache.delete(threadId);
    if (cache.size >= maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(threadId, known);
  }

  async function refresh(threadId: string): Promise<KnownSessions> {
    const known = cache.get(threadId) ?? NOTHING_KNOWN;
    // Stamped before the lookup, so a thread that comes to rest while it runs
    // carries an updatedAt past this stamp and is re-read by the next scan.
    const checkedAt = now();
    const rows = await bb.sdk.threads.events.list({
      threadId,
      types: ["thread/identity"],
      order: "asc",
      ...(known.lastSeq === null ? {} : { afterSeq: known.lastSeq }),
    });
    const events = rows.flatMap((row) => (row.type === "thread/identity" ? [{ seq: row.seq, sessionId: row.data.providerThreadId }] : []));
    const next = withEvents(known, events, checkedAt);
    remember(threadId, next);
    return next;
  }

  async function current(threadId: string, changedAt: number | undefined): Promise<KnownSessions> {
    const known = cache.get(threadId);
    return known !== undefined && changedAt !== undefined && changedAt < known.checkedAt ? known : refresh(threadId);
  }

  return {
    async sessionsOf(threadId, changedAt) {
      return (await current(threadId, changedAt)).sessions;
    },
    async resolve(threadId) {
      return (await current(threadId, undefined)).current;
    },
    clearCache() {
      cache.clear();
    },
  };
}
