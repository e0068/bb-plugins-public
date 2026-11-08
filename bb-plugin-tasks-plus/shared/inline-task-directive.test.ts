import { describe, expect, it } from "vitest";

import { findInlineTaskDirectives } from "./inline-task-directive.js";

const keysOf = (text: string) => findInlineTaskDirectives(text).map((found) => found.key);

describe("findInlineTaskDirectives", () => {
  it("finds the directive in the middle of a sentence and points at its exact span", () => {
    const directive = '::task{key="SSS-28"}';
    const text = `Понял: ${directive} теперь про неё`;
    const [found] = findInlineTaskDirectives(text);
    expect(found?.key).toBe("SSS-28");
    expect(text.slice(found?.start, found?.end)).toBe(directive);
  });

  it("finds every directive of a line in order", () => {
    expect(keysOf('вынес ::task{key="SSS-41"} и ::task{key="SSS-40"}.')).toEqual(["SSS-41", "SSS-40"]);
  });

  it("reads the key quoted either way, bare, or beside a title", () => {
    expect(keysOf("::task{key='A-1'} ::task{key=B-2} ::task{title=\"Кнопка\" key=\"C-3\"}")).toEqual([
      "A-1",
      "B-2",
      "C-3",
    ]);
  });

  it("accepts a slug as the task address", () => {
    expect(keysOf('см. ::task{key="scene-as-data-not-code"}')).toEqual(["scene-as-data-not-code"]);
  });

  it("skips a directive that addresses no task", () => {
    expect(keysOf('::task{} ::task{title="x"} ::task{key=""} ::task{key="A 1"} ::taskx{key="A-1"}')).toEqual([]);
  });

  it("finds nothing in plain text", () => {
    expect(findInlineTaskDirectives("задача SSS-28 и task{key} без директивы")).toEqual([]);
  });
});
