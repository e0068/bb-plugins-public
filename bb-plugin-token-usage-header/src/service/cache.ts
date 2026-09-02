// Short-lived in-memory cache for tokens-runner results, keyed by slice.
// Counting is expensive (tools/tokens.py reads every transcript under the
// slice), so identical queries within the TTL are served from cache, and
// concurrent identical queries share one in-flight run instead of spawning
// a process each.
import type { TokensQueryParams, TokensRunResult } from "./types";

const DEFAULT_TTL_MS = 30_000;

export interface TokensCache {
  /**
   * Returns the cached result for `key` if still fresh; otherwise calls
   * `compute()` once, caches its promise immediately (so concurrent callers
   * for the same key await the same in-flight run), and returns it.
   */
  get(key: string, compute: () => Promise<TokensRunResult>): Promise<TokensRunResult>;
  /** Drops every cached entry, including in-flight ones. */
  clear(): void;
}

/** `now` is injectable so tests can control TTL expiry deterministically. */
export function createTokensCache(ttlMs = DEFAULT_TTL_MS, now: () => number = Date.now): TokensCache {
  const entries = new Map<string, { expiresAt: number; promise: Promise<TokensRunResult> }>();

  return {
    get(key, compute) {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        return existing.promise;
      }

      const promise = compute();
      const entry = { expiresAt: now() + ttlMs, promise };
      entries.set(key, entry);

      /** Drop the entry, unless it's since been replaced by a fresher one. */
      const dropIfCurrent = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };

      // compute() is contractually never-throwing (tokens-runner always
      // resolves to a tagged result), but if it ever does reject, don't let
      // a stale rejection sit in the cache for the rest of the TTL.
      promise.catch(dropIfCurrent);
      // Failures aren't cached for the same reason: they're usually about
      // the environment rather than about the data — python not found,
      // daemon unavailable. The User fixes the cause within seconds, while a
      // cached failure would keep holding the same error for the whole TTL,
      // not reacting to reopening.
      promise.then((result) => {
        if (!result.ok) dropIfCurrent();
      }, dropIfCurrent);
      return promise;
    },
    clear() {
      entries.clear();
    },
  };
}

/** Canonical cache key for a slice — order-independent, missing fields normalized. */
export function cacheKeyForParams(params: TokensQueryParams): string {
  return JSON.stringify({
    by: params.by ?? "session",
    project: params.project ?? null,
    session: params.session ?? null,
    since: params.since ?? null,
    until: params.until ?? null,
    top: params.top ?? null,
  });
}
