// Promises of lib/kimi-quota.ts: the Kimi coding API quota payload becomes the
// same windows the host reports for Claude Code and Codex, and its HTTP
// failures become the same provider statuses.
import { describe, expect, it } from "vitest";
import { mapKimiHttpError, parseKimiUsages } from "./kimi-quota";

describe("parseKimiUsages", () => {
  it("turns every known window of the payload into a window, session first, monthly code last", () => {
    expect(
      parseKimiUsages({
        usages: {
          limit_5h: { used_ratio: 0.3942, reset_time: "2026-10-22T15:37:38Z" },
          limit_7d: { used_ratio: 0.19, reset_time: "2026-10-29T00:00:00Z" },
          limit_month_total: { used_ratio: 0.1056, reset_time: "2026-11-07T00:00:00Z" },
          limit_month_code: { used_ratio: 0.1056, reset_time: "2026-11-07T00:00:00Z" },
        },
      }),
    ).toEqual([
      { label: "Current session", usedPercent: 39, resetsAt: "2026-10-22T15:37:38Z" },
      { label: "Weekly limit", usedPercent: 19, resetsAt: "2026-10-29T00:00:00Z" },
      { label: "Monthly limit", usedPercent: 11, resetsAt: "2026-11-07T00:00:00Z" },
      { label: "Monthly limit (Kimi Code)", usedPercent: 11, resetsAt: "2026-11-07T00:00:00Z" },
    ]);
  });

  it("skips windows the plan does not have — a new-plan account has no weekly window", () => {
    expect(
      parseKimiUsages({
        usages: {
          limit_5h: { used_ratio: 0, reset_time: "2026-10-22T15:37:38Z" },
          limit_month_total: { used_ratio: 0.1, reset_time: "2026-11-07T00:00:00Z" },
          limit_month_code: { used_ratio: 0.1, reset_time: "2026-11-07T00:00:00Z" },
        },
      }).map((window) => window.label),
    ).toEqual(["Current session", "Monthly limit", "Monthly limit (Kimi Code)"]);
  });

  it("reads a ratio sent as a string", () => {
    expect(parseKimiUsages({ usages: { limit_5h: { used_ratio: "0.5" } } })).toEqual([
      { label: "Current session", usedPercent: 50, resetsAt: null },
    ]);
  });

  it("skips a window whose ratio is unreadable and keeps the rest", () => {
    expect(
      parseKimiUsages({
        usages: {
          limit_5h: { used_ratio: "soon" },
          limit_7d: { used_ratio: 0.19, reset_time: "2026-10-29T00:00:00Z" },
        },
      }),
    ).toEqual([{ label: "Weekly limit", usedPercent: 19, resetsAt: "2026-10-29T00:00:00Z" }]);
  });

  it("ignores windows the plugin does not know", () => {
    expect(parseKimiUsages({ usages: { limit_5h: { used_ratio: 0.1 }, limit_future: { used_ratio: 1 } } })).toHaveLength(1);
  });

  it("finds no windows in a payload without a usages record, in null and in a string", () => {
    expect(parseKimiUsages({})).toEqual([]);
    expect(parseKimiUsages(null)).toEqual([]);
    expect(parseKimiUsages("quota")).toEqual([]);
  });
});

describe("mapKimiHttpError", () => {
  it("reads 401 and 403 as a signed-out account", () => {
    expect(mapKimiHttpError(401)).toEqual({ status: "unauthenticated" });
    expect(mapKimiHttpError(403)).toEqual({ status: "unauthenticated" });
  });

  it("reads 404 as an account without the coding plan, with the reason in the message", () => {
    expect(mapKimiHttpError(404)).toEqual({ status: "error", message: "No Kimi For Coding plan on this account" });
  });

  it("reads any other status as an error carrying the status", () => {
    expect(mapKimiHttpError(500)).toEqual({ status: "error", message: "Failed to fetch usage: HTTP 500" });
  });
});
