// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListSort } from "../../shared/enums.js";

type Module = typeof import("./table-preference.js");

/** A fresh copy of the module: what a reload of the page sees. */
async function reload(): Promise<Module> {
  vi.resetModules();
  return import("./table-preference.js");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

const SETTINGS = {
  sort: { column: "dueDate", direction: "desc" },
  groupBy: "priority",
  widths: { title: 420, key: 90 },
  pinned: ["title", "project"],
  collapsedGroups: ["done"],
} as const;

describe("table settings of a screen", () => {
  it("a screen without settings groups by status and pins the title", async () => {
    const { loadTableSettings, DEFAULT_TABLE_SETTINGS } = await reload();
    expect(DEFAULT_TABLE_SETTINGS).toEqual({ sort: null, groupBy: "status", widths: {}, pinned: ["title"], collapsedGroups: [] });
    expect(loadTableSettings("all")).toEqual(DEFAULT_TABLE_SETTINGS);
  });

  it("settings written are read back after a reload", async () => {
    const first = await reload();
    first.setTableSettings("project:P1", SETTINGS as never);
    const second = await reload();
    expect(second.loadTableSettings("project:P1")).toEqual(SETTINGS);
    second.setTableSettings("project:P1", { groupBy: "none" });
    const third = await reload();
    expect(third.loadTableSettings("project:P1")).toEqual({ ...SETTINGS, groupBy: "none" });
  });

  it("a column's format and icon are read back after a reload, a broken choice dropped", async () => {
    const first = await reload();
    first.setTableSettings("project:P1", {
      columns: { createdAt: { format: "relative", icon: true }, dueDate: { format: "weekday", icon: "yes" } } as never,
    });
    const second = await reload();
    expect(second.loadTableSettings("project:P1").columns).toEqual({ createdAt: { format: "relative", icon: true }, dueDate: {} });
  });

  it("screens do not share table settings", async () => {
    const { setTableSettings, loadTableSettings, DEFAULT_TABLE_SETTINGS } = await reload();
    setTableSettings("all", { groupBy: "none" });
    expect(loadTableSettings("active")).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(loadTableSettings("project:P1")).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(loadTableSettings("all").groupBy).toBe("none");
  });

  it("a corrupt record reads as the defaults", async () => {
    const { TABLE_PREFERENCE_STORAGE_KEY } = await reload();
    for (const raw of [
      "{not json",
      JSON.stringify({ version: 1, scopes: { all: { sort: { column: "nope", direction: "asc" }, groupBy: 7 } } }),
      JSON.stringify({ version: 1, scopes: { all: "x" } }),
    ]) {
      window.localStorage.setItem(TABLE_PREFERENCE_STORAGE_KEY, raw);
      const { loadTableSettings, DEFAULT_TABLE_SETTINGS } = await reload();
      const loaded = loadTableSettings("all");
      expect(loaded.groupBy).toBe(DEFAULT_TABLE_SETTINGS.groupBy);
      expect(loaded.sort).toBeNull();
    }
    window.localStorage.setItem(TABLE_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 1, scopes: { all: { ...SETTINGS, widths: { title: 5000 } } } }));
    const { loadTableSettings } = await reload();
    expect(loadTableSettings("all").widths.title).toBe(640);
  });

  it("the list's sort carries over to the table", async () => {
    const { sortFromListSort, loadTableSettings } = await reload();
    const expected: Record<ListSort, unknown> = {
      manual: null,
      priority: { column: "priority", direction: "asc" },
      due: { column: "dueDate", direction: "asc" },
      start: { column: "startDate", direction: "asc" },
      estimate: { column: "estimate", direction: "desc" },
      planned_minutes: { column: "plannedMinutes", direction: "desc" },
      actual_minutes: { column: "actualMinutes", direction: "desc" },
      budget: { column: "budget", direction: "desc" },
      budget_limit: { column: "budgetLimit", direction: "desc" },
      cost: { column: "cost", direction: "desc" },
      created: { column: "createdAt", direction: "desc" },
      updated: { column: "updatedAt", direction: "desc" },
    };
    for (const [sort, column] of Object.entries(expected)) expect(sortFromListSort(sort as ListSort), sort).toEqual(column);

    const { storeListPreference, DEFAULT_LIST_PREFERENCE } = await import("../common/list-preference.js");
    storeListPreference("project:P1", { ...DEFAULT_LIST_PREFERENCE, sort: "due" });
    expect(loadTableSettings("project:P1").sort).toEqual({ column: "dueDate", direction: "asc" });
  });

  it("apply after capture changes nothing", async () => {
    const { setTableSettings, captureTableSettings, applyTableSettings, loadTableSettings } = await reload();
    setTableSettings("waiting", SETTINGS as never);
    const captured = captureTableSettings("waiting");
    applyTableSettings("project:P2", captured);
    expect(loadTableSettings("project:P2")).toEqual(SETTINGS);
    applyTableSettings("waiting", captureTableSettings("waiting"));
    expect(loadTableSettings("waiting")).toEqual(SETTINGS);
  });

  it("a hook sees a write at once", async () => {
    const { useTableSettings, setTableSettings } = await reload();
    const { result } = renderHook(() => useTableSettings("all"));
    expect(result.current.groupBy).toBe("status");
    act(() => setTableSettings("all", { groupBy: "type" }));
    expect(result.current.groupBy).toBe("type");
  });

  it("keeps sorting usable when storage refuses writes", async () => {
    const { setTableSettings, loadTableSettings } = await reload();
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(() => setTableSettings("all", { sort: { column: "dueDate", direction: "asc" } })).not.toThrow();
      expect(loadTableSettings("all").sort).toEqual({ column: "dueDate", direction: "asc" });
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
