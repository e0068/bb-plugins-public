// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  LIST_PREFERENCE_STORAGE_KEY,
  storeListPreference,
  loadListPreference,
} from "./list-preference.js";
import {
  ROW_FIELD_PREFERENCE_STORAGE_KEY,
  loadFieldDisplay,
  toggleFieldVisible,
} from "./row-field-preference.js";
import { applyListState, captureListState, isListScope } from "./view-state.js";

const PROJECT = "01J0000000000000000000000B";

beforeEach(() => {
  window.localStorage.removeItem(LIST_PREFERENCE_STORAGE_KEY);
  window.localStorage.removeItem(ROW_FIELD_PREFERENCE_STORAGE_KEY);
});

describe("captureListState", () => {
  it("captures the surface a cross-project list opens", () => {
    expect(captureListState("active")).toMatchObject({
      projectId: null,
      listScope: "active",
    });
  });

  it("captures the project a project list opens", () => {
    expect(captureListState(`project:${PROJECT}`)).toMatchObject({
      projectId: PROJECT,
      listScope: null,
    });
  });

  it("captures All tasks as neither a project nor a surface", () => {
    expect(captureListState("all")).toMatchObject({
      projectId: null,
      listScope: null,
    });
  });

  it("captures the filters and the sort of the area", () => {
    storeListPreference("all", {
      filters: {
        statuses: ["todo"],
        priorities: [],
        types: [],
        estimates: [],
        labelNames: [],
        assignees: ["Anna"],
        parents: [],
      },
      sort: "start",
    });
    const captured = captureListState("all");
    expect(captured.filters.statuses).toEqual(["todo"]);
    expect(captured.filters.assignees).toEqual(["Anna"]);
    expect(captured.sort).toBe("start");
  });

  it("captures the columns of the area", () => {
    toggleFieldVisible("all", "priority");
    expect(captureListState("all").fields).toEqual(loadFieldDisplay("all"));
  });
});

describe("applyListState", () => {
  it("carries a captured state through a round trip unchanged", () => {
    storeListPreference(`project:${PROJECT}`, {
      filters: {
        statuses: ["in_progress"],
        priorities: ["high"],
        types: [],
        estimates: [],
        labelNames: ["Bug"],
        assignees: [],
        parents: [],
      },
      sort: "priority",
    });
    toggleFieldVisible(`project:${PROJECT}`, "cost");
    const captured = captureListState(`project:${PROJECT}`);

    window.localStorage.removeItem(LIST_PREFERENCE_STORAGE_KEY);
    window.localStorage.removeItem(ROW_FIELD_PREFERENCE_STORAGE_KEY);

    applyListState(captured);
    expect(loadListPreference(`project:${PROJECT}`)).toEqual({
      filters: captured.filters,
      sort: captured.sort,
    });
    expect(loadFieldDisplay(`project:${PROJECT}`)).toEqual(captured.fields);
  });
});

describe("isListScope", () => {
  it("lets every list surface save a view", () => {
    expect(isListScope("all")).toBe(true);
    expect(isListScope("active")).toBe(true);
    expect(isListScope(`project:${PROJECT}`)).toBe(true);
  });

  it("refuses a board: a board has no filters and no sort to save", () => {
    expect(isListScope(`board:${PROJECT}`)).toBe(false);
  });
});

describe("applyListState and the parent filter", () => {
  it("writes the view's filters and sort into the area it opens, the picked parents included", () => {
    const view = {
      ...captureListState("all"),
      filters: {
        statuses: ["done" as const],
        priorities: [],
        types: [],
        estimates: [],
        labelNames: [],
        assignees: [],
        parents: ["B1:flow-epic"],
      },
      sort: "due" as const,
    };
    applyListState(view);
    const restored = loadListPreference("all");
    expect(restored.filters.statuses).toEqual(["done"]);
    expect(restored.filters.parents).toEqual(["B1:flow-epic"]);
    expect(restored.sort).toBe("due");
  });
});
