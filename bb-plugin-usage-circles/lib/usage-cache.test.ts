import { describe, expect, it, vi } from "vitest";
import { createUsageLimitsCache } from "./usage-cache";

describe("createUsageLimitsCache", () => {
  it("reuses the cached value within the TTL window", async () => {
    let calls = 0;
    let time = 0;
    const cache = createUsageLimitsCache(
      async () => {
        calls++;
        return calls;
      },
      1000,
      () => time,
    );

    expect(await cache.get()).toBe(1);
    time += 500;
    expect(await cache.get()).toBe(1);
    expect(calls).toBe(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    let calls = 0;
    let time = 0;
    const cache = createUsageLimitsCache(
      async () => {
        calls++;
        return calls;
      },
      1000,
      () => time,
    );

    await cache.get();
    time += 1000;
    expect(await cache.get()).toBe(2);
    expect(calls).toBe(2);
  });

  it("coalesces concurrent callers into one in-flight fetch", async () => {
    let calls = 0;
    let resolveFetch: (value: number) => void = () => {};
    const cache = createUsageLimitsCache(
      () =>
        new Promise<number>((resolve) => {
          calls++;
          resolveFetch = resolve;
        }),
      1000,
    );

    const first = cache.get();
    const second = cache.get();
    resolveFetch(42);

    expect(await first).toBe(42);
    expect(await second).toBe(42);
    expect(calls).toBe(1);
  });

  it("does not cache a rejected fetch, so the next call retries", async () => {
    let calls = 0;
    const cache = createUsageLimitsCache(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return "ok";
    }, 1000);

    await expect(cache.get()).rejects.toThrow("boom");
    expect(await cache.get()).toBe("ok");
    expect(calls).toBe(2);
  });
});
