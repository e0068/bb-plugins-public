// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BOARD_KEYS, isPropertyName, patchProperties, propertiesOf } from "./properties.js";

describe("propertiesOf", () => {
  it("takes the scalar keys the board does not model, as text", () => {
    expect(
      propertiesOf({ title: "T", key: "BBPL-1", phone: "+7 900", seats: 4, paid: true, tags: ["a"], owner: { name: "x" }, empty: null }),
    ).toEqual({ phone: "+7 900", seats: "4", paid: "true" });
  });

  it("is empty for a file with only board keys", () => {
    expect(propertiesOf({ title: "T", slug: "t", estimate: "m", minutes: 30 })).toEqual({});
  });
});

describe("patchProperties", () => {
  const file = { title: "T", phone: "1", city: "Riga", seats: 3, labels: ["x"], flow: { id: "f", name: "F" } };

  it("renames in place, edits, adds last and removes, keeping board keys, lists and blocks", () => {
    const patched = patchProperties(file, { rename: { phone: "tel" }, set: { city: "Oslo", zip: "1" }, remove: ["seats"] });
    expect(Object.entries(patched)).toEqual([
      ["title", "T"],
      ["tel", "1"],
      ["city", "Oslo"],
      ["labels", ["x"]],
      ["flow", { id: "f", name: "F" }],
      ["zip", "1"],
    ]);
  });

  it("leaves a property it does not name as it was — a number stays a number", () => {
    expect(patchProperties(file, { set: { city: "Oslo" } }).seats).toBe(3);
  });

  it("two patches made one after the other both land", () => {
    const first = patchProperties(file, { remove: ["phone"] });
    expect(propertiesOf(patchProperties(first, { remove: ["city"] }))).toEqual({ seats: "3" });
    const added = patchProperties(patchProperties(file, { set: { x: "1" } }), { set: { y: "2" } });
    expect(propertiesOf(added)).toMatchObject({ x: "1", y: "2" });
  });

  it("never sets, renames onto or removes a board key, and refuses a rename onto a taken name", () => {
    expect(patchProperties({ title: "T", a: "1", b: "2" }, { set: { title: "X", "": "y", " a": "z" }, rename: { a: "b" }, remove: ["title"] })).toEqual({ title: "T", a: "1", b: "2" });
    expect(patchProperties({ title: "T", a: "1" }, { rename: { a: "due" } })).toEqual({ title: "T", a: "1" });
  });

  it("leaves every board key as it was, whatever the patch", () => {
    const board = Object.fromEntries([...BOARD_KEYS].map((key) => [key, `v-${key}`]));
    const names = [...BOARD_KEYS];
    const patch = { set: Object.fromEntries(names.map((key) => [key, "changed"])), remove: names, rename: Object.fromEntries(names.map((key) => [key, `${key}2`])) };
    expect(patchProperties(board, patch)).toEqual(board);
  });
});

describe("isPropertyName", () => {
  it("refuses blank names, padded names and board keys", () => {
    expect(["phone", "Phone number"].map(isPropertyName)).toEqual([true, true]);
    expect(["", " phone", "phone ", "title", "due"].map(isPropertyName)).toEqual([false, false, false, false, false]);
  });
});
