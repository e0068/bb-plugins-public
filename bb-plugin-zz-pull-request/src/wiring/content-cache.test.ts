import { describe, expect, it } from "vitest";
import { measureContentCached, type ContentCachePorts } from "./content-cache";
import type { MergedContent } from "../core/merged-content";

/** Records what the protocol did, so the ordering promises are checked without git or KV. */
function fakePorts(verdict: MergedContent, cachedSha: string | null = null) {
  const measured: number[] = [];
  const remembered: string[] = [];
  return {
    measured,
    remembered,
    ports: {
      cachedHeadMatches: async (headSha) => headSha !== null && headSha === cachedSha,
      rememberMerged: async (headSha) => {
        remembered.push(headSha);
      },
      measure: async () => {
        measured.push(1);
        return verdict;
      },
    } satisfies ContentCachePorts,
  };
}

describe("measureContentCached", () => {
  it("a cache miss pays for the measurement and returns its verdict", async () => {
    const { ports, measured } = fakePorts("merged");
    expect(await measureContentCached(ports, "head1")).toBe("merged");
    expect(measured).toHaveLength(1);
  });

  it("a cache hit answers \"merged\" without measuring at all", async () => {
    const { ports, measured } = fakePorts("not-merged", "head1");
    expect(await measureContentCached(ports, "head1")).toBe("merged");
    expect(measured).toHaveLength(0);
  });

  it("a measured \"merged\" is remembered, so the next call is free", async () => {
    const { ports, remembered } = fakePorts("merged");
    await measureContentCached(ports, "head1");
    expect(remembered).toEqual(["head1"]);
  });

  it("only the merged fact is cached — a negative or a non-answer is not", async () => {
    for (const verdict of ["not-merged", "unknown"] as const) {
      const { ports, remembered } = fakePorts(verdict);
      await measureContentCached(ports, "head1");
      expect(remembered).toEqual([]);
    }
  });

  it("without a HEAD there is nothing to remember, and none is invented", async () => {
    const { ports, remembered } = fakePorts("merged");
    expect(await measureContentCached(ports, null)).toBe("merged");
    expect(remembered).toEqual([]);
  });

  it("git gave no answer and the cache is empty → the verdict stays unknown", async () => {
    const { ports } = fakePorts("unknown");
    expect(await measureContentCached(ports, "head1")).toBe("unknown");
  });
});
