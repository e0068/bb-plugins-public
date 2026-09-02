// Resolves a BB threadId to the Claude Code sessionId that tools/tokens.py
// counts against, via `bb.sdk.threads.events.list`. Never touches
// ~/.bb/bb.db directly — that database belongs to the bb server, not this
// plugin.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Caps how many resolved threadId->sessionId pairs are kept in memory. */
const DEFAULT_MAX_CACHE_ENTRIES = 500;

export interface ThreadSessionResolverOptions {
  /** Positive-result cache bound; defaults to 500 threads. */
  maxCacheEntries?: number;
}

export interface ThreadSessionResolver {
  /**
   * Returns the provider (Claude Code) session id for a thread, or null when
   * the thread has no `thread/identity` event yet (e.g. it was just
   * created and hasn't started a turn). Only a *found* sessionId is cached
   * — once a thread has an identity it never changes, so that's safe to
   * remember indefinitely (bounded by `maxCacheEntries`, oldest evicted
   * first). A `null` result is never cached: the thread may get its
   * identity on the very next turn, and caching "no session yet" would
   * freeze the header on that message forever.
   */
  resolve(threadId: string): Promise<string | null>;
  clearCache(): void;
}

export function createThreadSessionResolver(bb: BbPluginApi, options: ThreadSessionResolverOptions = {}): ThreadSessionResolver {
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  // Map iteration order is insertion order, so the first key is the oldest
  // — enough for a simple bounded FIFO without a dedicated LRU structure.
  const cache = new Map<string, string>();

  return {
    async resolve(threadId) {
      const cached = cache.get(threadId);
      if (cached !== undefined) return cached;

      const rows = await bb.sdk.threads.events.list({
        threadId,
        types: ["thread/identity"],
        limit: "1",
      });
      const identity = rows.find((row) => row.type === "thread/identity");
      const sessionId = identity?.data.providerThreadId ?? null;

      if (sessionId !== null) {
        // `!cache.has(threadId)` isn't needed here: a cache hit would already
        // have returned above via the early exit, so this thread is
        // guaranteed to be absent from the cache.
        if (cache.size >= maxCacheEntries) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        cache.set(threadId, sessionId);
      }
      return sessionId;
    },
    clearCache() {
      cache.clear();
    },
  };
}
