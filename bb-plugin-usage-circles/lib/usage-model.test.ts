import { describe, expect, it } from "vitest";
import {
  buildUsageWindowModel,
  formatAbsoluteReset,
  formatRelativeReset,
  inferWindowDurationMs,
  normalizeUsage,
  selectClaudeCodeProvider,
  statusLabel,
  tierForUsedPercent,
} from "./usage-model";

describe("tierForUsedPercent", () => {
  it("is blue below 60%", () => {
    expect(tierForUsedPercent(0)).toBe("blue");
    expect(tierForUsedPercent(59.9)).toBe("blue");
  });
  it("is yellow from 60% up to 90%", () => {
    expect(tierForUsedPercent(60)).toBe("yellow");
    expect(tierForUsedPercent(89.9)).toBe("yellow");
  });
  it("is red from 90% up", () => {
    expect(tierForUsedPercent(90)).toBe("red");
    expect(tierForUsedPercent(100)).toBe("red");
  });
});

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

describe("selectClaudeCodeProvider", () => {
  it("reads the hyphenated provider id the host actually returns", () => {
    // The live host response keys providers by id: "claude-code", "codex", ...
    const live = {
      codex: { status: "unauthenticated" as const },
      "claude-code": { status: "ok" as const, windows: [{ label: "Current session", usedPercent: 5, resetsAt: null }] },
    };
    expect(selectClaudeCodeProvider(live)).toBe(live["claude-code"]);
  });

  it("falls back to the camelCase key for hosts that still use it", () => {
    const legacy = { claudeCode: { status: "ok" as const, windows: [] } };
    expect(selectClaudeCodeProvider(legacy)).toBe(legacy.claudeCode);
  });

  it("returns undefined when neither key is present or the map is missing", () => {
    expect(selectClaudeCodeProvider({ codex: { status: "expired" } })).toBeUndefined();
    expect(selectClaudeCodeProvider(undefined)).toBeUndefined();
  });
});
