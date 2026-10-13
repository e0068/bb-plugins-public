// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { propertyKeys, shownProperties, toggledHidden, useHiddenProperties } from "./property-columns.js";

describe("property columns", () => {
  it("takes every name once, alphabetically, from the records that have any", () => {
    expect(propertyKeys([{ properties: { phone: "1", city: "R" } }, {}, { properties: { city: "O", zip: "2" } }])).toEqual(["city", "phone", "zip"]);
    expect(propertyKeys([{}, { properties: {} }])).toEqual([]);
  });

  it("draws all names but the hidden, and toggles one", () => {
    expect(shownProperties(["city", "phone"], ["phone", "gone"])).toEqual(["city"]);
    expect(toggledHidden(["phone"], "phone")).toEqual([]);
    expect(toggledHidden([], "phone")).toEqual(["phone"]);
  });

  it("keeps the hidden names per board in the browser profile", () => {
    const a = renderHook(() => useHiddenProperties("board-a"));
    const b = renderHook(() => useHiddenProperties("board-b"));
    act(() => a.result.current.toggle("phone"));
    expect(a.result.current.hidden).toEqual(["phone"]);
    expect(b.result.current.hidden).toEqual([]);
    act(() => a.result.current.toggle("phone"));
    expect(a.result.current.hidden).toEqual([]);
  });
});
