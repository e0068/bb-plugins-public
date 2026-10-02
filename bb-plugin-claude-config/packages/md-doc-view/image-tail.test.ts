// @vitest-environment jsdom
// The picture's settings live in the markdown itself, in the tail after `|`
// inside the alt text — the engine parses it and writes it back. Nothing here
// is mocked: this is the one suite that reads the tail the way a file on disk
// carries it, and it is what says the menu's four actions land in the document.
//
// The engine is vanilla DOM and jsdom carries it fine; only the document it
// mounts into is made up.
import { afterEach, describe, expect, it } from "vitest";

import {
  alignCenter,
  alignRight,
  createEditor,
  type KasimovEditorInstance,
  type KasimovImage,
  type KasimovImageActions,
} from "../kasimov/kasimov.js";

let editor: KasimovEditorInstance | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

interface Opened {
  image: KasimovImage;
  actions: KasimovImageActions;
  value: () => string;
}

/**
 * Mounts a document with one block picture, presses the "⋯" button the engine
 * draws over it and hands back what the engine offered the menu.
 */
function openPictureMenu(markdown: string): Opened {
  host = document.createElement("div");
  document.body.appendChild(host);
  let asked: { image: KasimovImage; actions: KasimovImageActions } | null = null;
  const ed = createEditor(host, {
    value: markdown,
    editable: true,
    imageMenu: (_anchor, image, actions) => {
      asked = { image, actions };
    },
  });
  editor = ed;
  const button = host.querySelector(".mde-imgmenubtn");
  if (button === null) throw new Error("the engine drew no button over the picture");
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  if (asked === null) throw new Error("pressing the button asked for no menu");
  const { image, actions } = asked;
  return { image, actions, value: () => ed.getValue() };
}

const DOC = (picture: string) => `text\n\n${picture}\n\ntail\n`;

describe("the tail the engine reads", () => {
  it("a bare picture comes with no settings and its alt as the caption", () => {
    const { image } = openPictureMenu(DOC("![the shot](shot.png)"));
    expect(image).toMatchObject({
      alt: "the shot",
      src: "shot.png",
      max: { tag: "none" },
      align: { tag: "left" },
      hideCaption: false,
    });
  });

  // No separators inside the tail: size, then `c`/`r`, then `h`, glued.
  it("width, alignment and the hidden caption are read out of `|600ch`", () => {
    const { image } = openPictureMenu(DOC("![the shot|600ch](shot.png)"));
    expect(image).toMatchObject({
      alt: "the shot",
      max: { tag: "w", w: 600 },
      align: { tag: "center" },
      hideCaption: true,
    });
  });

  it("`|600x400r` is width by height, aligned right", () => {
    const { image } = openPictureMenu(DOC("![the shot|600x400r](shot.png)"));
    expect(image).toMatchObject({ max: { tag: "wh", w: 600, h: 400 }, align: { tag: "right" } });
  });

  it("`|x400` is a height alone", () => {
    const { image } = openPictureMenu(DOC("![the shot|x400](shot.png)"));
    expect(image).toMatchObject({ max: { tag: "h", h: 400 }, align: { tag: "left" } });
  });

  // The one the documentation used to teach. A space breaks the tail, and the
  // whole of it stays in the caption — the picture gets no settings at all.
  it("a space inside the tail is not a tail: it stays in the caption", () => {
    const { image } = openPictureMenu(DOC("![the shot|600c h](shot.png)"));
    expect(image.alt).toBe("the shot|600c h");
    expect(image.max).toEqual({ tag: "none" });
    expect(image.hideCaption).toBe(false);
  });
});

describe("what the menu's actions do to the file", () => {
  it("a width is written into the tail", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot](shot.png)"));
    actions.setWidth(600);
    expect(value()).toBe(DOC("![the shot|600](shot.png)"));
  });

  // Each action reads the picture afresh, so the second builds on the first.
  it("width, then alignment, then hidden caption pile up in one tail", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot](shot.png)"));
    actions.setWidth(600);
    actions.setAlign(alignCenter);
    actions.setHideCaption(true);
    expect(value()).toBe(DOC("![the shot|600ch](shot.png)"));
  });

  it("a height joins the width instead of replacing it", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot](shot.png)"));
    actions.setWidth(600);
    actions.setHeight(400);
    actions.setAlign(alignRight);
    expect(value()).toBe(DOC("![the shot|600x400r](shot.png)"));
  });

  it("clearing the width leaves the rest of the tail alone", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot|600ch](shot.png)"));
    actions.setWidth(0);
    expect(value()).toBe(DOC("![the shot|ch](shot.png)"));
  });

  it("showing the caption again drops the `h`", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot|600ch](shot.png)"));
    actions.setHideCaption(false);
    expect(value()).toBe(DOC("![the shot|600c](shot.png)"));
  });

  it("the caption's words are not the menu's to change", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot|600c](shot.png)"));
    actions.setWidth(320);
    expect(value()).toContain("![the shot|320c](shot.png)");
  });

  it("Delete takes the picture out of the document", () => {
    const { actions, value } = openPictureMenu(DOC("![the shot](shot.png)"));
    actions.remove();
    expect(value()).not.toContain("shot.png");
    expect(value()).toContain("text");
    expect(value()).toContain("tail");
  });
});

describe("when the engine draws the button at all", () => {
  it("no button while the document is being read, only while it is edited", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = createEditor(host, {
      value: DOC("![the shot](shot.png)"),
      editable: false,
      imageMenu: () => {},
    });
    expect(host.querySelector(".mde-imgmenubtn")).toBeNull();
  });

  // This is the whole of what was missing before: the engine draws no menu of
  // its own, so with nothing offered it draws no button either.
  it("no button when the host offers nothing to draw the menu with", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = createEditor(host, { value: DOC("![the shot](shot.png)"), editable: true });
    expect(host.querySelector(".mde-imgmenubtn")).toBeNull();
  });
});
