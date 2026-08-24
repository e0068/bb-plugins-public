// A short-TTL, request-coalescing cache in front of one upstream fetch. Every
// open sidebar (each browser tab, each mounted content script) polls this
// plugin's own RPC independently; without this, each of those polls turned
// into its own call to bb.sdk.system.usageLimits(), which proxies to
// Anthropic's account usage endpoint — tightly rate-limited on its own, so a
// handful of concurrently open tabs was enough to trip "rate limited, try
// again shortly" for everyone. Caching the last successful result for a few
// seconds, and sharing one in-flight request across simultaneous callers,
// cuts that fan-out down to roughly one upstream call per TTL window.
export function createUsageLimitsCache<T>(fetcher: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let cached: { at: number; value: T } | null = null;
  let inFlight: Promise<T> | null = null;

  return {
    async get(): Promise<T> {
      if (cached !== null && now() - cached.at < ttlMs) return cached.value;
      if (inFlight !== null) return inFlight;

      inFlight = fetcher()
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
