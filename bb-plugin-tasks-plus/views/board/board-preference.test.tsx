// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SavedView } from "../../shared/contract.js";
import { loadFieldDisplay } from "../common/row-field-preference.js";
import {
  applyBoardState,
  BOARD_PREFERENCE_STORAGE_KEY,
  boardKey,
  captureBoardState,
  DEFAULT_BOARD_LAYOUT,
  hasBoardDraft,
  loadBoardLayout,
  setBoardLayout,
  useBoardLayout,
} from "./board-preference.js";

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const VIEW_ID = "01HZZZZZZZZZZZZZZZZZZZZZV1";

const highOnly = {
  ...DEFAULT_BOARD_LAYOUT,
  filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["high" as const] },
  sort: "priority" as const,
  grouping: {
    groupBy: "type" as const,
    columns: { type: { order: ["bugfix"], hidden: ["design"], widths: { bugfix: 320 } } },
    hideEmpty: true,
  },
};

beforeEach(() => window.localStorage.clear());

describe("board layout storage", () => {
  it("names the project's board and each view's board apart", () => {
    expect(boardKey(PROJECT_ID, null)).toBe(`board:${PROJECT_ID}`);
    expect(boardKey(PROJECT_ID, VIEW_ID)).not.toBe(boardKey(PROJECT_ID, null));
  });

  it("gives a board nobody touched the status columns, manual order and no filters", () => {
    expect(loadBoardLayout(boardKey(PROJECT_ID, null))).toEqual(DEFAULT_BOARD_LAYOUT);
    expect(DEFAULT_BOARD_LAYOUT.grouping.groupBy).toBe("status");
    expect(DEFAULT_BOARD_LAYOUT.sort).toBe("manual");
  });

  it("keeps a written layout across a fresh read", () => {
    setBoardLayout(boardKey(PROJECT_ID, null), highOnly);
    expect(loadBoardLayout(boardKey(PROJECT_ID, null))).toEqual(highOnly);
  });

  it("keeps a view's draft apart from the project's board", () => {
    setBoardLayout(boardKey(PROJECT_ID, VIEW_ID), highOnly);
    expect(loadBoardLayout(boardKey(PROJECT_ID, null))).toEqual(DEFAULT_BOARD_LAYOUT);
    expect(hasBoardDraft(boardKey(PROJECT_ID, VIEW_ID))).toBe(true);
    expect(hasBoardDraft(boardKey(PROJECT_ID, null))).toBe(false);
  });

  it("falls back to the default on unreadable storage", () => {
    window.localStorage.setItem(BOARD_PREFERENCE_STORAGE_KEY, "{not json");
    expect(loadBoardLayout(boardKey(PROJECT_ID, null))).toEqual(DEFAULT_BOARD_LAYOUT);
  });

  it("drops values it does not know and keeps the rest", () => {
    window.localStorage.setItem(
      BOARD_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scopes: {
          [boardKey(PROJECT_ID, null)]: {
            filters: { priorities: ["high", "cosmic"] },
            sort: "sideways",
            grouping: {
              groupBy: "color",
              columns: { type: { order: ["bugfix", 3], hidden: "x", widths: { bugfix: 9000, ui: "wide" } } },
              hideEmpty: "yes",
            },
          },
        },
      }),
    );
    const read = loadBoardLayout(boardKey(PROJECT_ID, null));
    expect(read.filters.priorities).toEqual(["high"]);
    expect(read.sort).toBe("manual");
    expect(read.grouping.groupBy).toBe("status");
    expect(read.grouping.hideEmpty).toBe(false);
    expect(read.grouping.columns.type).toEqual({ order: ["bugfix"], hidden: [], widths: { bugfix: 480 } });
  });

  it("does not overwrite a document written by a newer client", () => {
    const future = JSON.stringify({ version: 99, scopes: {} });
    window.localStorage.setItem(BOARD_PREFERENCE_STORAGE_KEY, future);
    setBoardLayout(boardKey(PROJECT_ID, null), highOnly);
    expect(window.localStorage.getItem(BOARD_PREFERENCE_STORAGE_KEY)).toBe(future);
  });

  it("re-renders a subscriber when the layout changes", () => {
    const key = boardKey(PROJECT_ID, null);
    const { result } = renderHook(() => useBoardLayout(key));
    expect(result.current.grouping.groupBy).toBe("status");
    act(() => setBoardLayout(key, highOnly));
    expect(result.current.grouping.groupBy).toBe("type");
  });
});

describe("a board view's state", () => {
  const view: SavedView = {
    id: VIEW_ID,
    version: 2,
    name: "Bugs by type",
    projectId: PROJECT_ID,
    listScope: null,
    surface: "board",
    table: null,
    filters: highOnly.filters,
    sort: highOnly.sort,
    fields: { fields: [{ field: "priority", visible: false }], showEmpty: true, showDescription: false },
    board: highOnly.grouping,
    createdAt: "2026-07-01T00:00:00.000Z",
  };

  it("puts a view onto a board and takes the same state back off it", () => {
    const key = boardKey(PROJECT_ID, VIEW_ID);
    applyBoardState(key, view);
    const captured = captureBoardState(key);
    expect(captured.filters).toEqual(view.filters);
    expect(captured.sort).toBe(view.sort);
    expect(captured.board).toEqual(view.board);
    expect(loadFieldDisplay(key).showEmpty).toBe(true);
    expect(captured.fields.showEmpty).toBe(true);
  });
});
