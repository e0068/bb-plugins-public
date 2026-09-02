import { describe, expect, it } from "vitest";
import { DEFAULT_VIZ_SETTINGS, parseVizSettings, vizSettingsSchema } from "../viz-settings";

describe("DEFAULT_VIZ_SETTINGS", () => {
  it("mirrors ThreadsTimelinePage.tsx's own remaining useState defaults (geometry/behaviour moved to gear-settings.ts)", () => {
    expect(DEFAULT_VIZ_SETTINGS.threads).toEqual({
      agentColors: {},
      sortMode: "recent",
      searchQuery: "",
      projectFilter: [],
      costMin: "",
      costMax: "",
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
    const result = parseVizSettings({ threads: { sortMode: "tokens" } });

    expect(result.threads).toEqual({
      ...DEFAULT_VIZ_SETTINGS.threads,
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
    expect(parseVizSettings({ threads: { sortMode: 123 } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when an unknown top-level key is present (strict rejects it)", () => {
    expect(parseVizSettings({ threads: {}, agentDetail: {}, bogus: true })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults when an unknown nested key is present (a migrated gear field, e.g. unit)", () => {
    expect(parseVizSettings({ threads: { unit: 60 } })).toEqual(DEFAULT_VIZ_SETTINGS);
  });

  it("falls back to full defaults for a non-hex agentColors value", () => {
    expect(parseVizSettings({ threads: { agentColors: { main: "blue" } } })).toEqual(DEFAULT_VIZ_SETTINGS);
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
        agentColors: { main: "#3b82f6" },
        sortMode: "duration",
        searchQuery: "prototype",
        projectFilter: ["Token Usage Header", null],
        costMin: "0.1",
        costMax: "5",
      },
      agentDetail: { showHooks: false, relativeTime: true, groupedByTurn: true },
    };

    const result = vizSettingsSchema.safeParse(full);

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(full);
  });
});
