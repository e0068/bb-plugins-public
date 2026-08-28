// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardFieldScope,
  CANONICAL_FIELD_ORDER,
  defaultConfig,
  listFieldScope,
  loadFieldDisplay,
  moveField,
  resetFieldDisplay,
  ROW_FIELD_PREFERENCE_STORAGE_KEY,
  ROW_FIELD_PREFERENCE_VERSION,
  setShowDescription,
  setShowEmpty,
  surfaceOfScope,
  toggleFieldVisible,
  type FieldScope,
  type RowField,
} from "./row-field-preference.js";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fields rendered, in order — the shape a surface actually draws. */
function visibleOrder(scope: FieldScope): RowField[] {
  return loadFieldDisplay(scope)
    .fields.filter((entry) => entry.visible)
    .map((entry) => entry.field);
}

describe("scope helpers", () => {
  it("maps list surfaces to independent scopes and board apart", () => {
    expect(listFieldScope(null, false)).toBe("all");
    expect(listFieldScope(null, true)).toBe("active");
    expect(listFieldScope("P1", false)).toBe("project:P1");
    // activeOnly wins over a project id (Active is cross-project).
    expect(listFieldScope("P1", true)).toBe("active");
    expect(boardFieldScope("P1")).toBe("board:P1");
  });

  it("classifies a scope's surface", () => {
    expect(surfaceOfScope("all")).toBe("list");
    expect(surfaceOfScope("project:P1")).toBe("list");
    expect(surfaceOfScope("board:P1")).toBe("board");
  });
});

describe("defaultConfig", () => {
  it("lists every canonical field once, in canonical order", () => {
    const fields = defaultConfig("list").fields.map((entry) => entry.field);
    expect(fields).toEqual([...CANONICAL_FIELD_ORDER]);
  });

  it("reproduces today's list rail (priority off the rail)", () => {
    expect(visibleOrder("all")).toEqual([
      "active",
      "type",
      "estimate",
      "labels",
      "tokens",
      "dueDate",
      "project",
    ]);
    expect(defaultConfig("list").showEmpty).toBe(false);
  });

  it("reproduces today's board card (priority + labels)", () => {
    expect(visibleOrder("board:P1")).toEqual(["priority", "labels"]);
    const config = defaultConfig("board");
    expect(config.showEmpty).toBe(false);
    expect(config.showDescription).toBe(false);
  });
});

describe("loadFieldDisplay defaults and sanitation", () => {
  it("defaults when storage is empty", () => {
    expect(loadFieldDisplay("all")).toEqual(defaultConfig("list"));
    expect(loadFieldDisplay("board:P1")).toEqual(defaultConfig("board"));
  });

  it("recovers from corrupt JSON and non-object documents", () => {
    window.localStorage.setItem(ROW_FIELD_PREFERENCE_STORAGE_KEY, "{not-json");
    expect(loadFieldDisplay("all")).toEqual(defaultConfig("list"));
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify([1, 2, 3]),
    );
    expect(loadFieldDisplay("all")).toEqual(defaultConfig("list"));
  });

  it("keeps a partial stored order, dropping junk and appending missing hidden", () => {
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: ROW_FIELD_PREFERENCE_VERSION,
        scopes: {
          all: {
            fields: [
              { field: "labels", visible: true },
              { field: "labels", visible: false }, // duplicate ignored
              { field: "not-a-field", visible: true }, // unknown dropped
              { field: "tokens", visible: false },
            ],
            showEmpty: true,
          },
        },
      }),
    );
    const config = loadFieldDisplay("all");
    // Stored fields keep their order first; the rest of the canon appends after,
    // hidden (a field the user never ordered must not appear on its own).
    expect(config.fields.slice(0, 2)).toEqual([
      { field: "labels", visible: true },
      { field: "tokens", visible: false },
    ]);
    const appended = config.fields.slice(2);
    expect(appended.every((entry) => entry.visible === false)).toBe(true);
    expect(config.fields).toHaveLength(CANONICAL_FIELD_ORDER.length);
    expect(visibleOrder("all")).toEqual(["labels"]);
    expect(config.showEmpty).toBe(true);
  });
});

describe("mutations persist per scope", () => {
  it("toggles visibility without reordering", () => {
    // priority is canon-first and hidden by default; enabling it keeps its
    // position (toggle never reorders) so it appears at the front of the rail.
    toggleFieldVisible("all", "priority");
    expect(visibleOrder("all")).toEqual([
      "priority",
      "active",
      "type",
      "estimate",
      "labels",
      "tokens",
      "dueDate",
      "project",
    ]);
    toggleFieldVisible("all", "labels"); // on → off
    expect(visibleOrder("all")).not.toContain("labels");
  });

  it("moves a field and the order survives a reload", () => {
    // priority is last in canon; move it to the front.
    const from = defaultConfig("list").fields.findIndex(
      (entry) => entry.field === "priority",
    );
    moveField("all", from, 0);
    expect(loadFieldDisplay("all").fields[0]!.field).toBe("priority");
  });

  it("ignores out-of-range or no-op moves", () => {
    const before = loadFieldDisplay("all");
    moveField("all", -1, 0);
    moveField("all", 0, 99);
    moveField("all", 2, 2);
    expect(loadFieldDisplay("all")).toEqual(before);
  });

  it("keeps list scopes, board, and showEmpty/showDescription independent", () => {
    toggleFieldVisible("all", "tokens"); // off tokens on All
    setShowEmpty("project:P1", true);
    setShowDescription("board:P1", true);
    toggleFieldVisible("board:P1", "createdAt"); // board gains createdAt

    expect(visibleOrder("all")).not.toContain("tokens");
    // Another list scope is untouched by All's change.
    expect(visibleOrder("project:P1")).toContain("tokens");
    expect(loadFieldDisplay("project:P1").showEmpty).toBe(true);
    expect(loadFieldDisplay("all").showEmpty).toBe(false);
    expect(loadFieldDisplay("board:P1").showDescription).toBe(true);
    expect(visibleOrder("board:P1")).toContain("createdAt");
    // The list default (createdAt hidden) is untouched by the board change.
    expect(visibleOrder("all")).not.toContain("createdAt");

    const stored = JSON.parse(
      window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY)!,
    );
    expect(stored.version).toBe(ROW_FIELD_PREFERENCE_VERSION);
    expect(Object.keys(stored.scopes).sort()).toEqual([
      "all",
      "board:P1",
      "project:P1",
    ]);
  });

  it("resets a scope back to its surface default", () => {
    toggleFieldVisible("all", "labels");
    setShowEmpty("all", true);
    resetFieldDisplay("all");
    expect(loadFieldDisplay("all")).toEqual(defaultConfig("list"));
  });
});

describe("v1 migration", () => {
  it("carries a global v1 hidden list into list scopes, leaving board default", () => {
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, hidden: ["tokens", "project", "bogus"] }),
    );
    // List scopes: today's defaults minus the v1-hidden fields.
    expect(visibleOrder("all")).toEqual([
      "active",
      "type",
      "estimate",
      "labels",
      "dueDate",
    ]);
    expect(visibleOrder("project:P1")).toEqual([
      "active",
      "type",
      "estimate",
      "labels",
      "dueDate",
    ]);
    // Board never existed in v1 → its own default.
    expect(loadFieldDisplay("board:P1")).toEqual(defaultConfig("board"));
  });

  it("stops honoring v1 hidden once a scope is written as v2", () => {
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, hidden: ["tokens"] }),
    );
    toggleFieldVisible("all", "priority"); // first v2 write
    const stored = JSON.parse(
      window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY)!,
    );
    expect(stored.version).toBe(ROW_FIELD_PREFERENCE_VERSION);
  });
});

describe("future version and storage failures", () => {
  it("reads a newer document best-effort and never down-converts it", () => {
    const future = JSON.stringify({
      version: 99,
      scopes: {
        all: { fields: [{ field: "labels", visible: true }], showEmpty: true },
      },
    });
    window.localStorage.setItem(ROW_FIELD_PREFERENCE_STORAGE_KEY, future);
    expect(visibleOrder("all")).toEqual(["labels"]);
    toggleFieldVisible("all", "tokens");
    // Older client must not rewrite a newer document.
    expect(window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY)).toBe(
      future,
    );
  });

  it("swallows write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    expect(() => toggleFieldVisible("all", "labels")).not.toThrow();
  });

  it("swallows read failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    expect(loadFieldDisplay("all")).toEqual(defaultConfig("list"));
  });
});
