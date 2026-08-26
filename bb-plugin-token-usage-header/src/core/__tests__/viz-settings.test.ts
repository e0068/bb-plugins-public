import { describe, expect, it } from "vitest";
import { DEFAULT_VIZ_SETTINGS, parseVizSettings, vizSettingsSchema } from "../viz-settings";

describe("DEFAULT_VIZ_SETTINGS", () => {
  it("mirrors ThreadsTimelinePage.tsx's own useState defaults", () => {
    expect(DEFAULT_VIZ_SETTINGS.threads).toEqual({
      unit: 60,
      fillWidth: true,
      collapseEmpty: false,
      colWidthPx: 6,
      heightScale: 1,
      colGap: 1,
      segGap: 0,
      colRadius: 0,
      segRadius: 0,
      frameLiftColor: "#e3e3dd",
      agentColors: {},
      sortMode: "recent",
    });
  });

  it("mirrors AgentTimelinePage.tsx's own useState defaults", () => {
    expect(DEFAULT_VIZ_SETTINGS.agentDetail).toEqual({
      showHooks: true,
      relativeTime: false,
      groupedByTurn: false,
    });
  });
});

describe("parseVizSettings", () => {
  it("returns full defaults for an empty object", () => {
    expect(parseVizSettings({})).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("returns full defaults for undefined (never saved yet)", () => {
    expect(parseVizSettings(undefined)).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("merges a partial threads blob into the full shape, filling missing fields with defaults", () => {
    const result = parseVizSettings({ threads: { unit: 300, sortMode: "tokens" } });

    expect(result.threads).toEqual({
      ...DEFAULT_VIZ_SETTINGS.threads,
      unit: 300,
      sortMode: "tokens",
    });
    expect(result.agentDetail).toEqual(DEFAULT_VIZ_SETTINGS.agentDetail);
  });

  it("merges a partial agentDetail blob into the full shape", () => {
    const result = parseVizSettings({ agentDetail: { showHooks: false } });

    expect(result.agentDetail).toEqual({
      ...DEFAULT_VIZ_SETTINGS.agentDetail,
      showHooks: false,
    });
    expect(result.threads).toEqual(DEFAULT_VIZ_SETTINGS.threads);
  });

  it("defaults collapseEmpty to false and preserves a saved true value", () => {
    expect(parseVizSettings({}).threads.collapseEmpty).toBe(false);
    expect(parseVizSettings({ threads: { collapseEmpty: true } }).threads.collapseEmpty).toBe(true);
  });

  it("preserves a saved agentColors map", () => {
    const result = parseVizSettings({ threads: { agentColors: { main: "#3b82f6", "agent-1": "#22c55e" } } });

    expect(result.threads.agentColors).toEqual({ main: "#3b82f6", "agent-1": "#22c55e" });
  });

  it("falls back to full defaults for a completely unrelated shape (string)", () => {
    expect(parseVizSettings("not an object")).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults for null", () => {
    expect(parseVizSettings(null)).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults for an array", () => {
    expect(parseVizSettings([1, 2, 3])).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when a known field has the wrong type", () => {
    expect(parseVizSettings({ threads: { unit: "sixty" } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when a field is out of its allowed range", () => {
    expect(parseVizSettings({ threads: { heightScale: 100 } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when an unknown top-level key is present (strict rejects it)", () => {
    expect(parseVizSettings({ threads: {}, agentDetail: {}, bogus: true })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when an unknown nested key is present", () => {
    expect(parseVizSettings({ threads: { unit: 60, bogus: "x" } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults for a non-hex agentColors value", () => {
    expect(parseVizSettings({ threads: { agentColors: { main: "blue" } } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("accepts colWidthPx at its lower bound (1) and upper bound (40)", () => {
    expect(parseVizSettings({ threads: { colWidthPx: 1 } }).threads.colWidthPx).toBe(1);
    expect(parseVizSettings({ threads: { colWidthPx: 40 } }).threads.colWidthPx).toBe(40);
  });

  it("falls back to full defaults when colWidthPx is out of range (0, below the 1px minimum)", () => {
    expect(parseVizSettings({ threads: { colWidthPx: 0 } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when colWidthPx is out of range (41, above the 40px maximum)", () => {
    expect(parseVizSettings({ threads: { colWidthPx: 41 } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when colWidthPx is not an integer", () => {
    expect(parseVizSettings({ threads: { colWidthPx: 6.5 } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("returns a fresh object each call, not the shared DEFAULT_VIZ_SETTINGS reference", () => {
    const a = parseVizSettings(undefined);
    const b = parseVizSettings(undefined);

    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_VIZ_SETTINGS);
  });
});

describe("vizSettingsSchema strictness", () => {
  it("rejects an unknown top-level key directly on the schema", () => {
    expect(vizSettingsSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("rejects an unknown key inside the threads section", () => {
    expect(vizSettingsSchema.safeParse({ threads: { bogus: 1 } }).success).toBe(false);
  });

  it("rejects an unknown key inside the agentDetail section", () => {
    expect(vizSettingsSchema.safeParse({ agentDetail: { bogus: 1 } }).success).toBe(false);
  });

  it("accepts a fully specified, in-range object as-is", () => {
    const full = {
      threads: {
        unit: 900,
        fillWidth: false,
        collapseEmpty: true,
        colWidthPx: 20,
        heightScale: 2,
        colGap: 4,
        segGap: 2,
        colRadius: 3,
        segRadius: 3,
        frameLiftColor: "#abc",
        agentColors: { main: "#3b82f6" },
        sortMode: "duration",
      },
      agentDetail: { showHooks: false, relativeTime: true, groupedByTurn: true },
    };

    const result = vizSettingsSchema.safeParse(full);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(full);
  });
});
