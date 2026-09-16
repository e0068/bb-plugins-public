// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFieldDisplay,
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
  type FieldDisplayConfig,
  type FieldEntry,
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
    expect(listFieldScope(null, null)).toBe("all");
    expect(listFieldScope(null, "active")).toBe("active");
    expect(listFieldScope(null, "waiting")).toBe("waiting");
    expect(listFieldScope("P1", null)).toBe("project:P1");
    // A list scope wins over a project id (Active/Waiting are cross-project).
    expect(listFieldScope("P1", "active")).toBe("active");
    expect(listFieldScope("P1", "waiting")).toBe("waiting");
    expect(boardFieldScope("P1")).toBe("board:P1");
  });

  it("classifies a scope's surface", () => {
    expect(surfaceOfScope("all")).toBe("list");
    expect(surfaceOfScope("active")).toBe("list");
    expect(surfaceOfScope("waiting")).toBe("list");
    expect(surfaceOfScope("project:P1")).toBe("list");
    expect(surfaceOfScope("board:P1")).toBe("board");
  });
});

describe("defaultConfig", () => {
  it("lists every canonical field once, in canonical order", () => {
    const fields = defaultConfig("list").fields.map((entry) => entry.field);
    expect(fields).toEqual([...CANONICAL_FIELD_ORDER]);
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
              { field: "cost", visible: false },
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
      { field: "cost", visible: false },
    ]);
    const appended = config.fields.slice(2);
    expect(appended.every((entry) => entry.visible === false)).toBe(true);
    expect(config.fields).toHaveLength(CANONICAL_FIELD_ORDER.length);
    expect(visibleOrder("all")).toEqual(["labels"]);
    expect(config.showEmpty).toBe(true);
  });
});

describe("mutations persist per scope", () => {
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
    toggleFieldVisible("all", "cost"); // off cost on All
    setShowEmpty("project:P1", true);
    setShowDescription("board:P1", true);
    toggleFieldVisible("board:P1", "createdAt"); // board gains createdAt

    expect(visibleOrder("all")).not.toContain("cost");
    // Another list scope is untouched by All's change.
    expect(visibleOrder("project:P1")).toContain("cost");
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

describe("applyFieldDisplay", () => {
  it("survives a reload from localStorage, not just the in-memory session", () => {
    applyFieldDisplay("all", {
      fields: CANONICAL_FIELD_ORDER.map((field) => ({
        field,
        visible: field === "cost",
      })),
      showEmpty: false,
      showDescription: false,
    });
    const stored = JSON.parse(
      window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY)!,
    );
    expect(stored.scopes.all.fields.find((e: FieldEntry) => e.field === "cost").visible).toBe(
      true,
    );
    expect(visibleOrder("all")).toEqual(["cost"]);
  });

  it("appends canonical fields a partial config omits, hidden, keeping the given order first", () => {
    applyFieldDisplay("all", {
      fields: [
        { field: "cost", visible: true },
        { field: "priority", visible: false },
      ],
      showEmpty: false,
      showDescription: false,
    });
    const fields = loadFieldDisplay("all").fields;
    expect(fields.slice(0, 2)).toEqual([
      { field: "cost", visible: true },
      { field: "priority", visible: false },
    ]);
    expect(fields.slice(2).every((entry) => entry.visible === false)).toBe(
      true,
    );
    expect(fields).toHaveLength(CANONICAL_FIELD_ORDER.length);
  });

  it("drops an unrecognized field name without erroring", () => {
    applyFieldDisplay("all", {
      fields: [
        { field: "labels", visible: true },
        { field: "bogus" as unknown as RowField, visible: true },
        { field: "cost", visible: false },
      ],
      showEmpty: false,
      showDescription: false,
    });
    const fields = loadFieldDisplay("all").fields;
    expect(fields.some((entry) => (entry.field as string) === "bogus")).toBe(
      false,
    );
    expect(fields).toHaveLength(CANONICAL_FIELD_ORDER.length);
    expect(visibleOrder("all")).toEqual(["labels"]);
  });

  it("drops a repeated field, keeping the first occurrence", () => {
    applyFieldDisplay("all", {
      fields: [
        { field: "labels", visible: true },
        { field: "labels", visible: false },
        ...CANONICAL_FIELD_ORDER.filter((field) => field !== "labels").map(
          (field) => ({ field, visible: false }),
        ),
      ],
      showEmpty: false,
      showDescription: false,
    });
    const fields = loadFieldDisplay("all").fields;
    expect(fields.filter((entry) => entry.field === "labels")).toEqual([
      { field: "labels", visible: true },
    ]);
    expect(fields).toHaveLength(CANONICAL_FIELD_ORDER.length);
  });

  it("touches only the applied scope, leaving other scopes untouched", () => {
    // Give board:P1 a known, non-default state first so this test does not
    // depend on whatever default happens to be on disk.
    applyFieldDisplay("board:P1", {
      fields: CANONICAL_FIELD_ORDER.map((field) => ({
        field,
        visible: field === "labels",
      })),
      showEmpty: false,
      showDescription: true,
    });
    const boardBefore = loadFieldDisplay("board:P1");
    applyFieldDisplay("all", {
      fields: CANONICAL_FIELD_ORDER.map((field) => ({
        field,
        visible: field === "priority",
      })),
      showEmpty: true,
      showDescription: false,
    });
    expect(loadFieldDisplay("board:P1")).toEqual(boardBefore);
  });

  it("applies to a board scope, including showDescription", () => {
    applyFieldDisplay("board:P1", {
      fields: CANONICAL_FIELD_ORDER.map((field) => ({
        field,
        visible: field === "priority",
      })),
      showEmpty: false,
      showDescription: true,
    });
    expect(loadFieldDisplay("board:P1").showDescription).toBe(true);
    expect(visibleOrder("board:P1")).toEqual(["priority"]);
  });

  it("never down-converts a document written by a newer client", () => {
    const future = JSON.stringify({
      version: 99,
      scopes: {
        all: { fields: [{ field: "labels", visible: true }], showEmpty: true },
      },
    });
    window.localStorage.setItem(ROW_FIELD_PREFERENCE_STORAGE_KEY, future);
    applyFieldDisplay("all", defaultConfig("list"));
    expect(window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY)).toBe(
      future,
    );
  });
});

describe("v1 migration", () => {
  it("stops honoring v1 hidden once a scope is written as v2", () => {
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, hidden: ["cost"] }),
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
    toggleFieldVisible("all", "cost");
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

// The field dictionary grows; these promises are stated against it rather
// than against a spelled-out copy of it.
const DEFAULT_LIST_RAIL = CANONICAL_FIELD_ORDER.filter(
  (field) => !["priority", "createdAt", "updatedAt"].includes(field),
);

describe("field display against the dictionary", () => {
  it("the list rail shows every field but priority and the timestamps, assignee and epic right after active", () => {
    expect(visibleOrder("all")).toEqual(DEFAULT_LIST_RAIL);
    expect(DEFAULT_LIST_RAIL.slice(0, 3)).toEqual(["active", "assignee", "epic"]);
    expect(defaultConfig("list").showEmpty).toBe(false);
  });

  it("toggling priority on puts it at its canonical place, the front, without reordering the rest", () => {
    toggleFieldVisible("all", "priority");
    expect(visibleOrder("all")).toEqual(["priority", ...DEFAULT_LIST_RAIL]);
    toggleFieldVisible("all", "labels");
    expect(visibleOrder("all")).not.toContain("labels");
  });

  it("applies a full config verbatim: order, visibility, and the flags", () => {
    const order = [...CANONICAL_FIELD_ORDER].reverse();
    applyFieldDisplay("all", {
      fields: order.map((field) => ({ field, visible: field === "labels" || field === "dueDate" })),
      showEmpty: true,
      showDescription: false,
    });
    expect(loadFieldDisplay("all").fields.map((entry) => entry.field)).toEqual(order);
    expect(visibleOrder("all")).toEqual(["dueDate", "labels"]);
    expect(loadFieldDisplay("all").showEmpty).toBe(true);
  });

  it("carries a global v1 hidden list into list scopes, leaving board default", () => {
    const hidden = ["plannedMinutes", "actualMinutes", "budget", "budgetLimit", "cost", "project"];
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, hidden: [...hidden, "bogus"] }),
    );
    const expected = DEFAULT_LIST_RAIL.filter((field) => !hidden.includes(field));
    expect(visibleOrder("all")).toEqual(expected);
    expect(visibleOrder("project:P1")).toEqual(expected);
    expect(loadFieldDisplay("board:P1")).toEqual(defaultConfig("board"));
  });
});
