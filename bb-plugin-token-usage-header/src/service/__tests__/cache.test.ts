import { describe, expect, it } from "vitest";
import { cacheKeyForParams, createTokensCache } from "../cache";
import type { TokensRunResult } from "../types";

const OK: TokensRunResult = {
  ok: true,
  data: {
    by: "session",
    buckets: [],
    totals: {
      total: 0,
      input: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      output: 0,
      thinking: 0,
      messages: 0,
      cost: 0,
      costs: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 },
      models: [],
      buckets: 0,
    },
    truncated: false,
  },
};

describe("createTokensCache", () => {
  it("serves the second identical request from cache without recomputing", async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(OK);
    };
    const cache = createTokensCache(30_000);

    await cache.get("k", compute);
    await cache.get("k", compute);
    expect(calls).toBe(1);
  });

  // A failure is usually about the environment rather than about the data:
  // python not found, daemon unavailable. The User fixes the cause within
  // seconds — a cached failure would keep the same error for the whole TTL,
  // and reopening wouldn't change anything.
  it("does not cache a failure: the next request recomputes", async () => {
    const results: TokensRunResult[] = [
      { ok: false, reason: "python_not_found", message: "Python interpreter not found." },
      OK,
    ];
    let calls = 0;
    const compute = () => Promise.resolve(results[calls++] ?? OK);
    const cache = createTokensCache(30_000);

    const first = await cache.get("k", compute);
    expect(first.ok).toBe(false);

    const second = await cache.get("k", compute);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("a successful result is still cached after a failure", async () => {
    const results: TokensRunResult[] = [
      { ok: false, reason: "python_not_found", message: "no python" },
      OK,
    ];
    let calls = 0;
    const compute = () => Promise.resolve(results[calls++] ?? OK);
    const cache = createTokensCache(30_000);

    await cache.get("k", compute);
    await cache.get("k", compute);
    await cache.get("k", compute);

    // First call — failure (not cached), second — success (cached), third
    // served from the cache.
    expect(calls).toBe(2);
  });

  it("dedupes two concurrent requests for the same key into one compute()", async () => {
    let calls = 0;
    let resolveFn!: (v: TokensRunResult) => void;
    const compute = () => {
      calls++;
      return new Promise<TokensRunResult>((resolve) => {
        resolveFn = resolve;
      });
    };
    const cache = createTokensCache(30_000);

    const p1 = cache.get("k", compute);
    const p2 = cache.get("k", compute);
    resolveFn(OK);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(calls).toBe(1);
    expect(r1).toBe(r2);
  });

  it("recomputes once the TTL has elapsed", async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(OK);
    };
    let now = 0;
    const cache = createTokensCache(1_000, () => now);

    await cache.get("k", compute);
    now = 1_001;
    await cache.get("k", compute);

    expect(calls).toBe(2);
  });

  it("clear() forces the next request to recompute", async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(OK);
    };
    const cache = createTokensCache(30_000);

    await cache.get("k", compute);
    cache.clear();
    await cache.get("k", compute);

    expect(calls).toBe(2);
  });

  it("keeps different keys independent", async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(OK);
    };
    const cache = createTokensCache(30_000);

    await cache.get("a", compute);
    await cache.get("b", compute);

    expect(calls).toBe(2);
  });
});

describe("cacheKeyForParams", () => {
  // These drive real cache.get() calls with the keys cacheKeyForParams
  // produces, and assert on compute() call counts — the actual behavior
  // that matters (does an equivalent query hit the cache? does a different
  // slice get its own entry?) — rather than comparing the key strings
  // themselves, which only restates the function's own implementation.
  it("lets equivalent params (regardless of omitted defaults) share one cache entry", async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(OK);
    };
    const cache = createTokensCache(30_000);

    await cache.get(cacheKeyForParams({ by: "session" }), compute);
    await cache.get(cacheKeyForParams({}), compute);

    expect(calls).toBe(1);
  });

  it("keeps different slices in independent cache entries", async () => {
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(OK);
    };
    const cache = createTokensCache(30_000);

    await cache.get(cacheKeyForParams({ by: "agent" }), compute);
    await cache.get(cacheKeyForParams({ by: "session" }), compute);
    await cache.get(cacheKeyForParams({ session: "abc" }), compute);
    await cache.get(cacheKeyForParams({ session: "def" }), compute);

    expect(calls).toBe(4);
  });
});
