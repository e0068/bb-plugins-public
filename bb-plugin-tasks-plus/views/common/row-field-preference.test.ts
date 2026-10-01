// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_ONLY_FIELDS } from "../../shared/enums.js";
import {
  applyFieldDisplay,
  boardFieldScope,
  CANONICAL_FIELD_ORDER,
  surfaceFieldOrder,
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
  it("offers the list every field but the board-only ones, the board all of them, once each in canonical order", () => {
    expect(defaultConfig("list").fields.map((entry) => entry.field)).toEqual([...LIST_FIELDS]);
    expect(defaultConfig("board").fields.map((entry) => entry.field)).toEqual([...CANONICAL_FIELD_ORDER]);
    expect(LIST_FIELDS).toEqual(CANONICAL_FIELD_ORDER.filter((field) => !(BOARD_ONLY_FIELDS as readonly string[]).includes(field)));
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

  it("applies a board view saved before Description was a field with the description at the head, on as it was", () => {
    applyFieldDisplay("board:P1", {
      fields: CANONICAL_FIELD_ORDER.filter((field) => field !== "description").map((field) => ({
        field,
        visible: field === "priority",
      })),
      showEmpty: false,
      showDescription: true,
    });
    expect(loadFieldDisplay("board:P1").showDescription).toBe(true);
    expect(visibleOrder("board:P1")).toEqual(["description", "title", "priority"]);
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
const LIST_FIELDS = surfaceFieldOrder("list");
/** The tree fields, the description and Taken by came after the rail had its defaults: they are opt-in. */
const OPT_IN = ["status", "slug", "subtasks", "description", "takenBy"];
const DEFAULT_LIST_RAIL = LIST_FIELDS.filter(
  (field) => !["priority", "createdAt", "updatedAt", ...OPT_IN].includes(field),
);

describe("field display against the dictionary", () => {

  it("applies a full list config verbatim: order, visibility, and the flags", () => {
    const order = [...LIST_FIELDS].reverse();
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

/** Both surfaces drew the key before it was a field: it stays shown wherever a stored order omits it. */
const ALWAYS_SHOWN = "key";

describe("defaults and sanitation with the key", () => {
  it("draws the board card by default with the parent, the title, the key, priority, working agents, labels, the sub-task counter, attachments and the worktree mark", () => {
    expect(visibleOrder("board:P1")).toEqual([
      "parent",
      "title",
      "key",
      "priority",
      "active",
      "labels",
      "subtasks",
      "attachments",
      "worktree",
    ]);
    const config = defaultConfig("board");
    expect(config.showEmpty).toBe(false);
    expect(config.showDescription).toBe(false);
  });

  it("keeps a partial stored order, dropping junk and appending the rest of the list's fields hidden but the key", () => {
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: ROW_FIELD_PREFERENCE_VERSION,
        scopes: {
          all: {
            fields: [
              { field: "labels", visible: true },
              { field: "labels", visible: false },
              { field: "not-a-field", visible: true },
              { field: "cost", visible: false },
            ],
            showEmpty: true,
          },
        },
      }),
    );
    const config = loadFieldDisplay("all");
    expect(config.fields.slice(0, 2)).toEqual([
      { field: "labels", visible: true },
      { field: "cost", visible: false },
    ]);
    expect(config.fields.slice(2).filter((entry) => entry.visible).map((entry) => entry.field)).toEqual([ALWAYS_SHOWN]);
    expect(config.fields).toHaveLength(LIST_FIELDS.length);
    expect(config.showEmpty).toBe(true);
  });

  it("appends the list's fields an applied partial config omits, hidden but the key, keeping the given order first", () => {
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
    expect(fields.slice(2).filter((entry) => entry.visible).map((entry) => entry.field)).toEqual([ALWAYS_SHOWN]);
    expect(fields).toHaveLength(LIST_FIELDS.length);
  });

  it("drops an unrecognized field name and a repeated one past its first occurrence", () => {
    applyFieldDisplay("all", {
      fields: [
        { field: "labels", visible: true },
        { field: "bogus" as unknown as RowField, visible: true },
        { field: "labels", visible: false },
        { field: "cost", visible: false },
      ],
      showEmpty: false,
      showDescription: false,
    });
    const fields = loadFieldDisplay("all").fields;
    expect(fields.some((entry) => (entry.field as string) === "bogus")).toBe(false);
    expect(fields.filter((entry) => entry.field === "labels")).toEqual([{ field: "labels", visible: true }]);
    expect(fields).toHaveLength(LIST_FIELDS.length);
    expect(visibleOrder("all")).toEqual(["labels", ALWAYS_SHOWN]);
  });

  it("reads a document of a newer client best-effort and never down-converts it", () => {
    const future = JSON.stringify({
      version: 99,
      scopes: {
        all: { fields: [{ field: "labels", visible: true }], showEmpty: true },
      },
    });
    window.localStorage.setItem(ROW_FIELD_PREFERENCE_STORAGE_KEY, future);
    expect(visibleOrder("all")).toEqual(["labels", ALWAYS_SHOWN]);
    toggleFieldVisible("all", "cost");
    expect(window.localStorage.getItem(ROW_FIELD_PREFERENCE_STORAGE_KEY)).toBe(future);
  });

  it("the list shows the key, then every rail field but priority, the timestamps and the opt-in tree fields, active, assignee and epic leading the rail", () => {
    expect(visibleOrder("all")).toEqual(DEFAULT_LIST_RAIL);
    expect(DEFAULT_LIST_RAIL.slice(0, 4)).toEqual(["key", "active", "assignee", "epic"]);
    expect(defaultConfig("list").showEmpty).toBe(false);
  });

  it("toggling priority on puts it at its canonical place, right after the key, without reordering the rest", () => {
    toggleFieldVisible("all", "priority");
    const [key, ...rail] = DEFAULT_LIST_RAIL;
    expect(visibleOrder("all")).toEqual([key, "priority", ...rail]);
    toggleFieldVisible("all", "labels");
    expect(visibleOrder("all")).not.toContain("labels");
  });
});

describe("the board card as fields", () => {
  /** A board config as a client wrote it before the title was a field. */
  const saveBefore = (visible: readonly RowField[]) =>
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: ROW_FIELD_PREFERENCE_VERSION,
        scopes: {
          "board:P1": {
            fields: ["description", "key", "priority", "slug", "labels", "subtasks", "dueDate"].map((field) => ({
              field,
              visible: visible.includes(field as RowField),
            })),
            showEmpty: false,
          },
        },
      }),
    );

  it("puts the old top line back above the title and the paperclip last, for a board saved before the title was a field", () => {
    saveBefore(["key", "priority", "labels"]);
    expect(visibleOrder("board:P1")).toEqual(["active", "parent", "worktree", "title", "key", "priority", "labels", "attachments"]);
  });

  it("keeps the slug in the old top line shown when it was shown there", () => {
    saveBefore(["slug", "key"]);
    expect(visibleOrder("board:P1")).toEqual(["slug", "active", "parent", "worktree", "title", "key", "attachments"]);
  });

  it("keeps a stored order that lists the title as it is, with the title shown", () => {
    applyFieldDisplay("board:P1", {
      fields: [
        { field: "key", visible: true },
        { field: "title", visible: false },
        { field: "slug", visible: true },
      ],
      showEmpty: false,
      showDescription: false,
    });
    // The sub-task counter joins shown, as for any board order that omits it.
    expect(visibleOrder("board:P1")).toEqual(["key", "title", "slug", "subtasks"]);
  });

  it("never hides the title", () => {
    const before = loadFieldDisplay("board:P1");
    toggleFieldVisible("board:P1", "title");
    expect(loadFieldDisplay("board:P1")).toEqual(before);
  });

  it("leaves the title, the parent, the attachments and the worktree mark out of the list", () => {
    const listed = loadFieldDisplay("all").fields.map((entry) => entry.field);
    for (const field of ["title", "parent", "attachments", "worktree"] as const) expect(listed).not.toContain(field);
  });
});

describe("the table's description column", () => {
  it("the list offers Description, off by default", () => {
    const entry = defaultConfig("list").fields.find((candidate) => candidate.field === "description");
    expect(entry).toEqual({ field: "description", visible: false });
    expect(visibleOrder("all")).not.toContain("description");
  });

  it("a list order saved before the table offered Description gains it hidden at the end, whatever its old flag said", () => {
    window.localStorage.setItem(
      ROW_FIELD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: ROW_FIELD_PREFERENCE_VERSION,
        scopes: {
          all: {
            fields: ["key", "labels"].map((field) => ({ field, visible: true })),
            showEmpty: false,
            showDescription: true,
          },
        },
      }),
    );
    const fields = loadFieldDisplay("all").fields;
    expect(visibleOrder("all")).toEqual(["key", "labels"]);
    expect(fields.slice(0, 2).map((entry) => entry.field)).toEqual(["key", "labels"]);
    expect(fields.find((entry) => entry.field === "description")).toEqual({ field: "description", visible: false });
  });

  it("turning Description on shows it in the list", () => {
    toggleFieldVisible("all", "description");
    expect(visibleOrder("all")).toContain("description");
  });
});
