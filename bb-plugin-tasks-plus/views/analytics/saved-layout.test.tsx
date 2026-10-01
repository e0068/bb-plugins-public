// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resizeRow, type RowLayout } from "./row-layout";
import { useSavedLayout } from "./saved-layout";

const DEFAULTS: RowLayout = { rows: [{ id: "r", height: 200, minHeight: 100, cells: [{ id: "a", weight: 1 }] }] };
const KEY = "test:analytics:rows";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useSavedLayout — sizes survive a reload", () => {
  it("gives back after a remount the sizes set before it", () => {
    const first = renderHook(() => useSavedLayout(KEY, DEFAULTS));
    act(() => first.result.current[1](resizeRow(DEFAULTS, "r", 320)));
    first.unmount();
    const second = renderHook(() => useSavedLayout(KEY, DEFAULTS));
    expect(second.result.current[0].rows[0]!.height).toBe(320);
  });

  it("starts from the defaults when storage cannot be read, and keeps working when it cannot be written", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage off");
    });
    const { result } = renderHook(() => useSavedLayout(KEY, DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    act(() => result.current[1](resizeRow(DEFAULTS, "r", 320)));
    expect(result.current[0].rows[0]!.height).toBe(320);
  });
});
