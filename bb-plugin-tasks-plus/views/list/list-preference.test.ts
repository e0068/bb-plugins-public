// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIST_PREFERENCE,
  LIST_PREFERENCE_STORAGE_KEY,
  LIST_PREFERENCE_VERSION,
  listPreferenceScope,
  loadListPreference,
  sanitizeListPreference,
  storeListPreference,
} from "./list-preference.js";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listPreferenceScope", () => {
  it("maps list surfaces to independent scopes", () => {
    expect(listPreferenceScope(null, null)).toBe("all");
    expect(listPreferenceScope(null, "active")).toBe("active");
    expect(listPreferenceScope(null, "waiting")).toBe("waiting");
    expect(listPreferenceScope("01HZZZZZZZZZZZZZZZZZZZZZP1", null)).toBe(
      "project:01HZZZZZZZZZZZZZZZZZZZZZP1",
    );
    // A list scope wins over a project id (Active/Waiting routes are cross-project).
    expect(listPreferenceScope("01HZZZZZZZZZZZZZZZZZZZZZP1", "active")).toBe(
      "active",
    );
    expect(listPreferenceScope("01HZZZZZZZZZZZZZZZZZZZZZP1", "waiting")).toBe(
      "waiting",
    );
  });
});

describe("sanitizeListPreference", () => {
  it("returns defaults for missing or garbage input", () => {
    expect(sanitizeListPreference(undefined)).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
    expect(sanitizeListPreference(null)).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
    expect(sanitizeListPreference("nope")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
  });

  it("drops invalid statuses, priorities, and sort; keeps label names", () => {
    expect(
      sanitizeListPreference({
        filters: {
          statuses: ["todo", "not-a-status", "todo", "done"],
          priorities: ["high", 3, "high", "telepathic"],
          labelNames: [" Bug ", "", "Bug", "Feature", 12],
        },
        sort: "priority-please",
      }),
    ).toEqual({
      filters: {
        statuses: ["todo", "done"],
        priorities: ["high"],
        labelNames: ["Bug", "Feature"],
        types: [],
        estimates: [],
      },
      sort: "manual",
    });
  });

  it("accepts a valid preference and known sort modes", () => {
    expect(
      sanitizeListPreference({
        filters: {
          statuses: ["in_progress"],
          priorities: ["urgent", "none"],
          labelNames: ["infra"],
        },
        sort: "due",
      }),
    ).toEqual({
      filters: {
        statuses: ["in_progress"],
        priorities: ["urgent", "none"],
        labelNames: ["infra"],
        types: [],
        estimates: [],
      },
      sort: "due",
    });
  });
});

describe("loadListPreference / storeListPreference", () => {
  it("defaults when storage is empty", () => {
    expect(loadListPreference("all")).toEqual({
      filters: { ...DEFAULT_LIST_PREFERENCE.filters },
      sort: "manual",
    });
  });

  it("round-trips a preference for one scope without touching another", () => {
    storeListPreference("all", {
      filters: {
        statuses: ["todo"],
        priorities: ["high"],
        labelNames: ["Bug"],
        types: [],
        estimates: [],
      },
      sort: "priority",
    });
    storeListPreference("project:p1", {
      filters: {
        statuses: ["done"],
        priorities: [],
        labelNames: [],
        types: [],
        estimates: [],
      },
      sort: "due",
    });

    expect(loadListPreference("all")).toEqual({
      filters: {
        statuses: ["todo"],
        priorities: ["high"],
        labelNames: ["Bug"],
        types: [],
        estimates: [],
      },
      sort: "priority",
    });
    expect(loadListPreference("project:p1")).toEqual({
      filters: {
        statuses: ["done"],
        priorities: [],
        labelNames: [],
        types: [],
        estimates: [],
      },
      sort: "due",
    });
    expect(loadListPreference("active")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });

    const stored = JSON.parse(
      window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY)!,
    );
    expect(stored.version).toBe(LIST_PREFERENCE_VERSION);
    expect(Object.keys(stored.scopes).sort()).toEqual(["all", "project:p1"]);
  });

  it("persists an explicit clear (empty filters + manual sort)", () => {
    storeListPreference("all", {
      filters: { statuses: ["todo"], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "priority",
    });
    storeListPreference("all", {
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
  });

  it("recovers from corrupt JSON and invalid document shapes", () => {
    window.localStorage.setItem(LIST_PREFERENCE_STORAGE_KEY, "{not-json");
    expect(loadListPreference("all").sort).toBe("manual");

    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, scopes: "nope" }),
    );
    expect(loadListPreference("all").filters.statuses).toEqual([]);

    window.localStorage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scopes: {
          all: {
            filters: { statuses: ["bogus"], priorities: ["high"] },
            sort: "priority",
          },
        },
      }),
    );
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: [], priorities: ["high"], labelNames: [], types: [], estimates: [] },
      sort: "priority",
    });
  });

  it("best-effort reads scopes from an unknown future version without rewriting it", () => {
    const future = JSON.stringify({
      version: 99,
      scopes: {
        all: {
          filters: { statuses: ["todo"], priorities: [], labelNames: [], types: [], estimates: [] },
          sort: "due",
          extraFutureField: true,
        },
      },
    });
    window.localStorage.setItem(LIST_PREFERENCE_STORAGE_KEY, future);
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: ["todo"], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "due",
    });
    storeListPreference("all", {
      filters: { statuses: ["done"], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
    // Older client must not down-convert a newer document.
    expect(window.localStorage.getItem(LIST_PREFERENCE_STORAGE_KEY)).toBe(
      future,
    );
  });

  it("swallows storage write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    expect(() =>
      storeListPreference("all", {
        filters: { statuses: ["todo"], priorities: [], labelNames: [], types: [], estimates: [] },
        sort: "manual",
      }),
    ).not.toThrow();
  });

  it("swallows storage read failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [], types: [], estimates: [] },
      sort: "manual",
    });
  });
});
