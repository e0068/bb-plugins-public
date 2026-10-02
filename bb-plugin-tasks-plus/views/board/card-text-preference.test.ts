// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import {
  CARD_TEXT_STORAGE_KEY,
  DEFAULT_CARD_TEXT,
  DESCRIPTION_SIZES,
  loadCardText,
  parseCardText,
  setCardText,
  TITLE_SIZES,
} from "./card-text-preference.js";

afterEach(() => window.localStorage.clear());

describe("parseCardText", () => {
  it("reads any stored value as a whole preference, each size falling back on its own", () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const text = parseCardText(raw);
        expect(TITLE_SIZES).toContain(text.title);
        expect(DESCRIPTION_SIZES).toContain(text.description);
        expect(DESCRIPTION_SIZES).toContain(text.subtasks);
      }),
    );
    expect(parseCardText({ title: "l", description: "huge", subtasks: "m" })).toEqual({ title: "l", description: DEFAULT_CARD_TEXT.description, subtasks: "m" });
  });

  it("opens on what a card drew before: a medium title over an extra-small description and extra-small sub-task rows", () => {
    expect(DEFAULT_CARD_TEXT).toEqual({ title: "m", description: "xs", subtasks: "xs" });
  });

  it("reads text stored before the sub-task size with the sub-tasks as they were drawn", () => {
    expect(parseCardText({ title: "s", description: "m" })).toEqual({ title: "s", description: "m", subtasks: "xs" });
  });
});

describe("a board's card text", () => {
  it("survives a reload, board by board", () => {
    setCardText("board:A", { title: "l", description: "m", subtasks: "s" });
    setCardText("board:B", { title: "s", description: "s", subtasks: "m" });
    expect(loadCardText("board:A")).toEqual({ title: "l", description: "m", subtasks: "s" });
    expect(loadCardText("board:B")).toEqual({ title: "s", description: "s", subtasks: "m" });
    expect(loadCardText("board:C")).toEqual(DEFAULT_CARD_TEXT);
  });

  it("reads broken storage as the defaults", () => {
    window.localStorage.setItem(CARD_TEXT_STORAGE_KEY, "[1, 2]");
    expect(loadCardText("board:A")).toEqual(DEFAULT_CARD_TEXT);
  });
});
