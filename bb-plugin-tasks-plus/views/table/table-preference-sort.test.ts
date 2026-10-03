// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

/** A fresh copy of a module: what a reload of the page sees. */
async function reload<T>(load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  return load();
}

describe("a sort by open sub-tasks", () => {
  it("survives a reload of a table's settings", async () => {
    const sort = { column: "openSubtasks", direction: "desc" } as const;
    (await reload(() => import("./table-preference.js"))).setTableSettings("all", { sort });
    expect((await reload(() => import("./table-preference.js"))).loadTableSettings("all").sort).toEqual(sort);
  });

  it("survives a reload of a screen's list preference", async () => {
    const sort = { column: "openSubtasks", direction: "asc" } as const;
    const first = await reload(() => import("../common/list-preference.js"));
    first.storeListPreference("all", { ...first.DEFAULT_LIST_PREFERENCE, sort });
    expect((await reload(() => import("../common/list-preference.js"))).loadListPreference("all").sort).toEqual(sort);
  });
});
