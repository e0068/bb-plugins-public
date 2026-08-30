import { describe, expect, it } from "vitest";
import {
  EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION,
  binTotal,
  deriveThreadLiveness,
  parseThreadsTimeline,
  widthFractions,
  type ThreadEntry,
  type ThreadLivenessInput,
} from "../threads-timeline";

const validTimeline = {
  schemaVersion: EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION,
  unit: 300,
  threads: [
    {
      session: "71e96791-4523-42b7-8994-caa3330e5f9f",
      project: "-Users-e0068-Documents-Projects-bb-plugins",
      title: "71e96791-4523-42b7-8994-caa3330e5f9f",
      start: "2026-08-20T13:44:51.138Z",
      end: "2026-08-20T14:46:48.357Z",
      durationSec: 3717,
      totalTokens: 4809213,
      totalCost: 12.5,
      workflowCount: 1,
      bins: [
        {
          t: "2026-08-20T13:40:00.000Z",
          agents: [
            { key: "main", total: 3411232 },
            { key: "agent-a9e92d5bea00f5cb7", total: 1397981 },
          ],
        },
      ],
    },
  ],
  agentLabels: {
    main: "Главный агент",
    "agent-a9e92d5bea00f5cb7": "H4: тесты",
  },
};

describe("parseThreadsTimeline", () => {
  it("parses a valid timeline report", () => {
    const result = parseThreadsTimeline(JSON.stringify(validTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.unit).toBe(300);
    expect(result.data.threads).toHaveLength(1);
    expect(result.data.threads[0].bins[0].agents).toHaveLength(2);
  });

  // threads_timeline.py's own JSON never carries bbProjectId/bbProjectName/
  // threadId/bbThreadTitle — those come from
  // src/service/threads-timeline-service.ts's BB project enrichment, which
  // runs after parsing. A freshly parsed thread must start out unmatched
  // (all four null), not undefined/missing.
  it("defaults bbProjectId/bbProjectName/threadId/bbThreadTitle to null and isAlive/isWorking to false — the script itself never sends them", () => {
    const result = parseThreadsTimeline(JSON.stringify(validTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads[0]).toMatchObject({
      bbProjectId: null,
      bbProjectName: null,
      threadId: null,
      bbThreadTitle: null,
      // Liveness is a BB-thread property attached by the service; a freshly
      // parsed (unmatched) thread is neither alive-coloured nor working.
      isAlive: false,
      isWorking: false,
    });
  });

  it("carries agentLabels through as-is, keyed the same as bins[].agents[].key", () => {
    const result = parseThreadsTimeline(JSON.stringify(validTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.agentLabels).toEqual({
      main: "Главный агент",
      "agent-a9e92d5bea00f5cb7": "H4: тесты",
    });
  });

  it("accepts an empty agentLabels object (a slice with no threads)", () => {
    const result = parseThreadsTimeline(JSON.stringify({ ...validTimeline, threads: [], agentLabels: {} }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.agentLabels).toEqual({});
  });

  it("fails with invalid_shape when agentLabels is missing", () => {
    const { agentLabels: _drop, ...rest } = validTimeline;
    const result = parseThreadsTimeline(JSON.stringify(rest));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails with invalid_shape when agentLabels has a non-string value", () => {
    const broken = { ...validTimeline, agentLabels: { main: 42 } };
    const result = parseThreadsTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails with invalid_json on empty input", () => {
    const result = parseThreadsTimeline("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });

  it("fails with invalid_json on garbage input", () => {
    const result = parseThreadsTimeline("not json {{{");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });

  it("fails with invalid_shape on a non-object top level", () => {
    const result = parseThreadsTimeline(JSON.stringify([1, 2, 3]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("recognizes the script's own {error: ...} envelope as script_error", () => {
    const result = parseThreadsTimeline(JSON.stringify({ error: "boom: transcript directory missing" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("boom: transcript directory missing");
  });

  it("fails with schema_version_mismatch when the version is missing", () => {
    const { schemaVersion: _drop, ...rest } = validTimeline;
    const result = parseThreadsTimeline(JSON.stringify(rest));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("Пересборка плагина не поможет");
  });

  it("fails with schema_version_mismatch when the version is a newer number", () => {
    const result = parseThreadsTimeline(
      JSON.stringify({ ...validTimeline, schemaVersion: EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION + 1 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("Нужна пересборка плагина.");
  });

  it("fails with invalid_shape when a bin's agent entry is missing a field", () => {
    const broken = {
      ...validTimeline,
      threads: [
        {
          ...validTimeline.threads[0],
          bins: [{ t: "2026-08-20T13:40:00.000Z", agents: [{ key: "main" }] }],
        },
      ],
    };
    const result = parseThreadsTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails with invalid_shape on an unknown extra field (.strict())", () => {
    const broken = { ...validTimeline, extra: "unexpected" };
    const result = parseThreadsTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails with invalid_shape when threads is not an array", () => {
    const broken = { ...validTimeline, threads: "nope" };
    const result = parseThreadsTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  // Guards the split between the raw script schema and the enriched
  // ThreadEntry type: if threads_timeline.py ever started emitting one of
  // these fields itself, .strict() on the raw per-thread schema must still
  // catch it as an unrecognized key, not silently accept a script-supplied
  // value that's supposed to come exclusively from BB enrichment.
  it("fails with invalid_shape when the raw thread object already carries bbProjectId (not part of the script's own contract)", () => {
    const broken = {
      ...validTimeline,
      threads: [{ ...validTimeline.threads[0], bbProjectId: "proj-1" }],
    };
    const result = parseThreadsTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails with invalid_shape when the raw thread object already carries bbThreadTitle (not part of the script's own contract)", () => {
    const broken = {
      ...validTimeline,
      threads: [{ ...validTimeline.threads[0], bbThreadTitle: "Design review" }],
    };
    const result = parseThreadsTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });
});

function thread(durationSec: number, session = `s-${durationSec}`): ThreadEntry {
  return {
    session,
    project: "proj",
    title: session,
    start: "2026-08-20T00:00:00.000Z",
    end: "2026-08-20T00:00:00.000Z",
    durationSec,
    totalTokens: 0,
    totalCost: 0,
    workflowCount: 0,
    bins: [],
    bbProjectId: null,
    bbProjectName: null,
    threadId: null,
    bbThreadTitle: null,
    isAlive: false,
    isWorking: false,
  };
}

describe("widthFractions", () => {
  it("returns an empty array for no threads", () => {
    expect(widthFractions([])).toEqual([]);
  });

  it("gives the longest thread a fraction of 1.0 and scales the rest proportionally", () => {
    const threads = [thread(100), thread(50), thread(25)];
    expect(widthFractions(threads)).toEqual([1, 0.5, 0.25]);
  });

  it("gives every thread 1.0 when all durations are zero", () => {
    const threads = [thread(0), thread(0)];
    expect(widthFractions(threads)).toEqual([1, 1]);
  });

  it("preserves index correspondence with the input array", () => {
    const threads = [thread(10), thread(40)];
    const fractions = widthFractions(threads);
    expect(fractions[0]).toBeCloseTo(0.25);
    expect(fractions[1]).toBeCloseTo(1);
  });
});

describe("binTotal", () => {
  it("sums total across every agent in the bin", () => {
    const total = binTotal({
      t: "2026-08-20T00:00:00.000Z",
      agents: [
        { key: "main", total: 10 },
        { key: "agent-a", total: 5 },
      ],
    });
    expect(total).toBe(15);
  });

  it("returns 0 for a bin with no agents", () => {
    expect(binTotal({ t: "2026-08-20T00:00:00.000Z", agents: [] })).toBe(0);
  });
});

describe("deriveThreadLiveness", () => {
  const NOW = 1_700_000_000_000;
  const WINDOW = 2 * 60_000;
  // A live thread, last active exactly now, no background work — the baseline.
  const alive: ThreadLivenessInput = { archivedAt: null, lastActivityMs: NOW, nowMs: NOW, workingWindowMs: WINDOW, activeWorkCount: 0 };

  it("marks a non-archived thread alive, an archived one dead", () => {
    expect(deriveThreadLiveness(alive).isAlive).toBe(true);
    expect(deriveThreadLiveness({ ...alive, archivedAt: NOW }).isAlive).toBe(false);
  });

  it("is working when the last activity is within the window", () => {
    expect(deriveThreadLiveness({ ...alive, lastActivityMs: NOW - WINDOW + 1 }).isWorking).toBe(true);
  });

  it("is not working when the last activity is older than the window", () => {
    expect(deriveThreadLiveness({ ...alive, lastActivityMs: NOW - WINDOW - 1 }).isWorking).toBe(false);
  });

  it("treats the exact window edge as still working", () => {
    expect(deriveThreadLiveness({ ...alive, lastActivityMs: NOW - WINDOW }).isWorking).toBe(true);
  });

  it("counts a lastActivity slightly in the future (clock skew) as working", () => {
    expect(deriveThreadLiveness({ ...alive, lastActivityMs: NOW + 5_000 }).isWorking).toBe(true);
  });

  it("is working when background work runs, even with a stale last activity", () => {
    expect(deriveThreadLiveness({ ...alive, lastActivityMs: NOW - WINDOW - 60_000, activeWorkCount: 1 }).isWorking).toBe(true);
  });

  it("is not working when a NaN last activity has no background work to fall back on", () => {
    expect(deriveThreadLiveness({ ...alive, lastActivityMs: Number.NaN }).isWorking).toBe(false);
  });

  it("never reports an archived thread as working, even when just active", () => {
    const { isAlive, isWorking } = deriveThreadLiveness({ ...alive, archivedAt: NOW, activeWorkCount: 3 });
    expect(isAlive).toBe(false);
    expect(isWorking).toBe(false);
  });

  // Invariant over the whole finite input space: working always implies alive —
  // the dot can never blink on a dead card.
  it("keeps isWorking ⇒ isAlive across every combination", () => {
    for (const archivedAt of [null, NOW]) {
      for (const lastActivityMs of [NOW, NOW - WINDOW - 1, Number.NaN]) {
        for (const activeWorkCount of [0, 2]) {
          const { isAlive, isWorking } = deriveThreadLiveness({ archivedAt, lastActivityMs, nowMs: NOW, workingWindowMs: WINDOW, activeWorkCount });
          if (isWorking) expect(isAlive).toBe(true);
        }
      }
    }
  });
});
