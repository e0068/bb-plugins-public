import { describe, expect, it } from "vitest";
import {
  buildUsageWindowModel,
  COLORING_OPTIONS,
  DEFAULT_COLORING,
  formatAbsoluteReset,
  formatRelativeReset,
  inferWindowDurationMs,
  normalizeUsage,
  PACE_MIN_ELAPSED,
  parseColoring,
  segmentFillFractions,
  selectProvider,
  statusLabel,
  tierForWindow,
  type Coloring,
  type UsageTier,
} from "./usage-model";

describe("inferWindowDurationMs", () => {
  it("reads an hour count out of the label when there is one", () => {
    expect(inferWindowDurationMs("5-hour limit")).toBe(5 * 60 * 60 * 1000);
    expect(inferWindowDurationMs("1 hour limit")).toBe(60 * 60 * 1000);
  });
  it("treats a 'session' label as the 5-hour window — live data's actual label, no hour count in it", () => {
    expect(inferWindowDurationMs("Current session")).toBe(5 * 60 * 60 * 1000);
  });
  it("falls back to a week for anything without an hour count or 'session'", () => {
    expect(inferWindowDurationMs("Weekly limit")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inferWindowDurationMs("Fable")).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("buildUsageWindowModel", () => {
  const now = Date.parse("2026-08-21T12:00:00Z");

  it("clamps usedPercent and derives the color tier", () => {
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 150, resetsAt: null }, now);
    expect(model.usedPercent).toBe(100);
    expect(model.tier).toBe("red");
  });

  it("uses a single continuous segment for an hour-cycle window", () => {
    const resetsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString(); // 2h left of 5h
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 31, resetsAt }, now);
    expect(model.segmentCount).toBe(1);
    expect(model.elapsedFraction).toBeCloseTo(0.6, 5);
    expect(model.segmentsElapsed).toBe(0);
  });

  it("uses seven day segments for a weekly window", () => {
    const resetsAt = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3d left of 7d
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 80, resetsAt }, now);
    expect(model.segmentCount).toBe(7);
    expect(model.elapsedFraction).toBeCloseTo(4 / 7, 5);
    expect(model.segmentsElapsed).toBe(4);
  });

  it("reports no elapsed fraction when resetsAt is null", () => {
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 0, resetsAt: null }, now);
    expect(model.elapsedFraction).toBeNull();
    expect(model.segmentsElapsed).toBeNull();
    expect(model.resetRelativeLabel).toBe("—");
    expect(model.resetAbsoluteLabel).toBe("—");
  });

  it("clamps elapsed fraction for a reset time already in the past", () => {
    const resetsAt = new Date(now - 60_000).toISOString();
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 10, resetsAt }, now);
    expect(model.elapsedFraction).toBe(1);
    expect(model.segmentsElapsed).toBe(1);
  });
});

describe("formatRelativeReset", () => {
  const now = Date.parse("2026-08-21T12:00:00Z");

  it("formats days and hours", () => {
    const resetsAt = new Date(now + (3 * 24 + 7) * 60 * 60 * 1000).toISOString();
    expect(formatRelativeReset(resetsAt, now)).toBe("3d 7h");
  });
  it("formats hours and minutes", () => {
    const resetsAt = new Date(now + 61 * 60 * 1000).toISOString();
    expect(formatRelativeReset(resetsAt, now)).toBe("1h 1m");
  });
  it("formats minutes only", () => {
    const resetsAt = new Date(now + 5 * 60 * 1000).toISOString();
    expect(formatRelativeReset(resetsAt, now)).toBe("5m");
  });
  it("reads a past reset as already elapsed", () => {
    const resetsAt = new Date(now - 1000).toISOString();
    expect(formatRelativeReset(resetsAt, now)).toBe("less than a minute");
  });
  it("falls back to a dash with no resetsAt", () => {
    expect(formatRelativeReset(null, now)).toBe("—");
  });
});

describe("formatAbsoluteReset", () => {
  it("renders the weekday and zero-padded time", () => {
    // 2026-08-21 is a Friday.
    expect(formatAbsoluteReset("2026-08-21T06:05:00Z")).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  });
  it("falls back to a dash with no resetsAt", () => {
    expect(formatAbsoluteReset(null)).toBe("—");
  });
});

describe("statusLabel", () => {
  it("gives a fixed label for known statuses", () => {
    expect(statusLabel("not_installed")).toBe("Claude Code is not installed");
    expect(statusLabel("unauthenticated")).toBe("Not authenticated");
    expect(statusLabel("expired")).toBe("Authentication session expired");
  });
  it("prefers the provider message for an error status", () => {
    expect(statusLabel("error", "boom")).toBe("boom");
    expect(statusLabel("error")).toBe("Failed to fetch data");
  });
});

describe("normalizeUsage", () => {
  it("narrows an ok response down to label/usedPercent/resetsAt", () => {
    const result = normalizeUsage({
      status: "ok",
      windows: [
        { label: "Current session", usedPercent: 31, resetsAt: "2026-08-21T23:30:00Z" },
        { label: "Weekly limit", usedPercent: 80, resetsAt: null },
      ],
    });
    expect(result).toEqual({
      status: "ok",
      windows: [
        { label: "Current session", usedPercent: 31, resetsAt: "2026-08-21T23:30:00Z" },
        { label: "Weekly limit", usedPercent: 80, resetsAt: null },
      ],
    });
  });

  it("defaults to an empty window list when the ok response has none", () => {
    expect(normalizeUsage({ status: "ok" })).toEqual({ status: "ok", windows: [] });
  });

  it("passes through a non-ok, non-error status as-is", () => {
    expect(normalizeUsage({ status: "unauthenticated" })).toEqual({ status: "unauthenticated" });
    expect(normalizeUsage({ status: "not_installed" })).toEqual({ status: "not_installed" });
    expect(normalizeUsage({ status: "expired" })).toEqual({ status: "expired" });
  });

  it("carries the error message through, or falls back to a generic one", () => {
    expect(normalizeUsage({ status: "error", message: "boom" })).toEqual({ status: "error", message: "boom" });
    expect(normalizeUsage({ status: "error" })).toEqual({ status: "error", message: "Failed to fetch data" });
  });

  it("treats a missing claudeCode provider as not_installed instead of throwing", () => {
    // usageLimits() can return an object without claudeCode → that's undefined in getState.
    // Without the guard, reading .status off undefined crashed getState on every call (BP-52).
    expect(normalizeUsage(undefined)).toEqual({ status: "not_installed" });
  });
});

describe("segmentFillFractions", () => {
  it("fills whole segments and only part of the one currently running", () => {
    expect(segmentFillFractions(3.5 / 7, 7)).toEqual([1, 1, 1, 0.5, 0, 0, 0]);
  });

  it("leaves every segment empty when the elapsed share is unknown", () => {
    expect(segmentFillFractions(null, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps every share within 0..1 and their sum equal to the elapsed segments", () => {
    for (let step = 0; step <= 100; step++) {
      const elapsed = step / 100;
      const fills = segmentFillFractions(elapsed, 7);
      expect(fills.length).toBe(7);
      expect(fills.every((fill) => fill >= 0 && fill <= 1)).toBe(true);
      expect(fills.reduce((sum, fill) => sum + fill, 0)).toBeCloseTo(elapsed * 7, 10);
    }
  });

  it("never lets a later segment fill more than an earlier one", () => {
    for (let step = 0; step <= 100; step++) {
      const fills = segmentFillFractions(step / 100, 7);
      expect(fills.every((fill, i) => i === 0 || fill <= fills[i - 1])).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Ring color: two modes, each with its own yellow/red pair.

const SEVERITY: Record<UsageTier, number> = { unknown: -1, blue: 0, yellow: 1, red: 2 };

function coloring(mode: Coloring["mode"], over: Partial<Pick<Coloring, "usage" | "pace">> = {}): Coloring {
  return { ...DEFAULT_COLORING, mode, ...over };
}

describe("tierForWindow", () => {
  it("colors by the share of the limit burned in usage mode", () => {
    const usage = coloring("usage");
    expect(tierForWindow(10, 0.9, usage)).toBe("blue");
    expect(tierForWindow(70, 0.1, usage)).toBe("yellow");
    expect(tierForWindow(95, 0.99, usage)).toBe("red");
  });

  it("is yellow exactly at the yellow threshold and red exactly at the red one", () => {
    const usage = coloring("usage", { usage: { yellow: 30, red: 40 } });
    expect(tierForWindow(29.9, 0.5, usage)).toBe("blue");
    expect(tierForWindow(30, 0.5, usage)).toBe("yellow");
    expect(tierForWindow(39.9, 0.5, usage)).toBe("yellow");
    expect(tierForWindow(40, 0.5, usage)).toBe("red");
    expect(tierForWindow(59.9, 0.5, DEFAULT_COLORING)).toBe("blue");
    expect(tierForWindow(60, 0.5, DEFAULT_COLORING)).toBe("yellow");
    expect(tierForWindow(90, 0.5, DEFAULT_COLORING)).toBe("red");
  });

  it("never reports unknown in usage mode, whatever the elapsed time", () => {
    for (const elapsed of [null, 0, PACE_MIN_ELAPSED / 2, PACE_MIN_ELAPSED, 0.5, 1]) {
      for (let used = 0; used <= 100; used += 5) {
        expect(tierForWindow(used, elapsed, coloring("usage"))).not.toBe("unknown");
      }
    }
  });

  it("colors by how far usage runs ahead of elapsed time in pace mode", () => {
    // Pace thresholds 20/50: usage 1.2x ahead of time is yellow, 1.5x is red.
    const pace = coloring("pace");
    expect(tierForWindow(60, 0.5, pace)).toBe("yellow");
    expect(tierForWindow(75, 0.5, pace)).toBe("red");
    expect(tierForWindow(80, 0.5, pace)).toBe("red");
    expect(tierForWindow(30, 0.5, pace)).toBe("blue");
    expect(tierForWindow(59, 0.5, pace)).toBe("blue");
  });

  it("gives the same color to the same lead early and late in the window", () => {
    // 30% ahead of time both at 10% and at 70% of the window.
    const pace = coloring("pace");
    expect(tierForWindow(13, 0.1, pace)).toBe("yellow");
    expect(tierForWindow(91, 0.7, pace)).toBe("yellow");
    // The same 20-point gap is red early (3x ahead) and only yellow late (1.29x).
    expect(tierForWindow(30, 0.1, pace)).toBe("red");
    expect(tierForWindow(90, 0.7, pace)).toBe("yellow");
  });

  it("is unknown in pace mode while less than PACE_MIN_ELAPSED of the window has passed", () => {
    const pace = coloring("pace");
    expect(tierForWindow(50, 0, pace)).toBe("unknown");
    expect(tierForWindow(0, 0, pace)).toBe("unknown");
    expect(tierForWindow(50, PACE_MIN_ELAPSED / 2, pace)).toBe("unknown");
  });

  it("judges the pace from exactly PACE_MIN_ELAPSED on", () => {
    expect(tierForWindow(0, PACE_MIN_ELAPSED, coloring("pace"))).toBe("blue");
  });

  it("is unknown in pace mode when the reset time is unknown", () => {
    expect(tierForWindow(50, null, coloring("pace"))).toBe("unknown");
    expect(tierForWindow(0, null, coloring("pace"))).toBe("unknown");
  });

  it("never gets less severe as usage grows at a fixed elapsed time", () => {
    for (const mode of ["usage", "pace"] as const) {
      for (const elapsed of [0.05, 0.25, 0.5, 0.9, 1]) {
        let previous = -Infinity;
        for (let used = 0; used <= 100; used += 0.5) {
          const severity = SEVERITY[tierForWindow(used, elapsed, coloring(mode))];
          expect(severity).toBeGreaterThanOrEqual(previous);
          previous = severity;
        }
      }
    }
  });

  it("lets red win when the thresholds are swapped", () => {
    const swapped = coloring("usage", { usage: { yellow: 90, red: 60 } });
    expect(tierForWindow(70, 0.5, swapped)).toBe("red");
    expect(tierForWindow(50, 0.5, swapped)).toBe("blue");
  });
});

describe("parseColoring", () => {
  const noThresholds = { usageYellow: undefined, usageRed: undefined, paceYellow: undefined, paceRed: undefined };

  it("reads the second dropdown option as pace and anything else as usage", () => {
    expect(parseColoring({ mode: COLORING_OPTIONS[1], ...noThresholds }).mode).toBe("pace");
    expect(parseColoring({ mode: COLORING_OPTIONS[0], ...noThresholds }).mode).toBe("usage");
    for (const mode of [undefined, null, "pace", 42, true, ""]) {
      expect(parseColoring({ mode, ...noThresholds }).mode).toBe("usage");
    }
  });

  it("falls back to 60/90 and 20/50 for thresholds that are not finite numbers", () => {
    for (const junk of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, "50", true]) {
      const parsed = parseColoring({ mode: undefined, usageYellow: junk, usageRed: junk, paceYellow: junk, paceRed: junk });
      expect(parsed.usage).toEqual({ yellow: 60, red: 90 });
      expect(parsed.pace).toEqual({ yellow: 20, red: 50 });
    }
    expect(parseColoring({ mode: undefined, ...noThresholds })).toEqual(DEFAULT_COLORING);
  });

  it("clamps usage thresholds into 0..100 and pace thresholds to at least 0", () => {
    const parsed = parseColoring({ mode: undefined, usageYellow: -5, usageRed: 150, paceYellow: -10, paceRed: 500 });
    expect(parsed.usage).toEqual({ yellow: 0, red: 100 });
    expect(parsed.pace).toEqual({ yellow: 0, red: 500 });
  });

  it("always returns finite thresholds within their ranges", () => {
    const values: unknown[] = [undefined, null, "x", true, Number.NaN, -Infinity, Infinity, -1e9, -1, 0, 0.5, 42, 100, 101, 1e9];
    for (const a of values) {
      for (const b of values) {
        const { usage, pace } = parseColoring({ mode: a, usageYellow: a, usageRed: b, paceYellow: b, paceRed: a });
        for (const t of [usage.yellow, usage.red, pace.yellow, pace.red]) expect(Number.isFinite(t)).toBe(true);
        for (const t of [usage.yellow, usage.red]) expect(t >= 0 && t <= 100).toBe(true);
        for (const t of [pace.yellow, pace.red]) expect(t >= 0).toBe(true);
      }
    }
  });
});

describe("buildUsageWindowModel coloring", () => {
  it("colors the window by the coloring it is given", () => {
    const now = Date.parse("2026-08-21T12:00:00Z");
    // Half of a 5-hour window gone, 80% burned: yellow by share, red by pace.
    const resetsAt = new Date(now + 2.5 * 60 * 60 * 1000).toISOString();
    const window = { label: "Current session", usedPercent: 80, resetsAt };
    expect(buildUsageWindowModel(window, now, coloring("usage")).tier).toBe("yellow");
    expect(buildUsageWindowModel(window, now, coloring("pace")).tier).toBe("red");
    expect(buildUsageWindowModel({ ...window, resetsAt: null }, now, coloring("pace")).tier).toBe("unknown");
  });
});

describe("selectProvider", () => {
  // The live host response, keyed by provider id (2026-09-12).
  const live = {
    "claude-code": { status: "ok" as const, windows: [{ label: "Current session", usedPercent: 32, resetsAt: null }] },
    codex: { status: "ok" as const, windows: [{ label: "Weekly limit", usedPercent: 1, resetsAt: null }] },
    "acp-cursor": { status: "not_installed" as const },
  };

  it("reads claude-code and codex by their hyphenated ids from one live response", () => {
    expect(selectProvider(live, "claude-code")).toBe(live["claude-code"]);
    expect(selectProvider(live, "codex")).toBe(live.codex);
  });

  it("falls back to the camelCase claudeCode key for claude-code only", () => {
    const legacy = { claudeCode: { status: "ok" as const, windows: [] } };
    expect(selectProvider(legacy, "claude-code")).toBe(legacy.claudeCode);
    expect(selectProvider(legacy, "codex")).toBeUndefined();
  });

  it("returns undefined for a provider the response does not carry", () => {
    expect(selectProvider({ "claude-code": live["claude-code"] }, "codex")).toBeUndefined();
    expect(selectProvider(undefined, "claude-code")).toBeUndefined();
  });
});
