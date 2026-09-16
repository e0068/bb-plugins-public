// @vitest-environment jsdom
//
// Following a link by clicking it — in BOTH modes (BBPL-249). The read mode
// has always worked (`_wire` hangs `_followLink` there); edit mode did not:
// the click only landed the caret, so a document opened for editing had dead
// links and an `@import` that highlighted but went nowhere. Claude Config
// enters edit mode on a click in the text (and, with the "open in edit mode"
// setting, straight away), so "editable" is the mode a reader is actually in.
import { describe, expect, it, vi } from "vitest";

import { VanillaMarkdownEditor } from "./vanilla";

const SRC = "@~/.claude/skills/x/SKILL.md and [the skill](skills/x/SKILL.md)";

function mount(editable: boolean, live = true) {
  const onClick = vi.fn();
  const linkResolver = vi.fn((href: string) =>
    live &&
    (href === "~/.claude/skills/x/SKILL.md" || href === "skills/x/SKILL.md")
      ? { onClick }
      : null,
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new VanillaMarkdownEditor(host, {
    value: SRC,
    editable,
    atLinks: true,
    linkResolver,
  });
  return { host, editor, onClick };
}

// Returns the event, so a caller can tell a jump (preventDefault — the click
// was consumed as navigation) from a click the editor handled as an ordinary
// one (caret/selection).
const clickToken = (host: HTMLElement, selector: string) => {
  const token = host.querySelector(selector) as HTMLElement;
  expect(token).toBeTruthy();
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  token.dispatchEvent(event);
  return event;
};

describe.each([
  ["read mode", false],
  ["edit mode", true],
])("clicking a live link in %s follows it", (_name, editable) => {
  it("an @import token navigates", () => {
    const { host, onClick, editor } = mount(editable as boolean);
    clickToken(host, ".mdb-atlink");
    expect(onClick).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("a [..](..) link navigates", () => {
    const { host, onClick, editor } = mount(editable as boolean);
    clickToken(host, ".mdb-link:not(.mdb-atlink)");
    expect(onClick).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("plain text is not a link — nothing is followed", () => {
    const { host, onClick, editor } = mount(editable as boolean);
    const root = host.querySelector(".mdb-root") as HTMLElement;
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).not.toHaveBeenCalled();
    editor.destroy();
  });
});

// A token that LOOKS like a link but resolves to nothing (the consumer's
// resolver returned null — an external URL, a path out of bounds) must fall
// through to the editor's ordinary click handling. Without this the fix for
// edit mode would swallow the caret on every dead link.
describe.each([
  ["read mode", false],
  ["edit mode", true],
])("clicking a DEAD link in %s is not a jump", (_name, editable) => {
  it("nothing is followed and the click is left to the editor", () => {
    const { host, onClick, editor } = mount(editable as boolean, false);
    const event = clickToken(host, ".mdb-atlink");
    expect(onClick).not.toHaveBeenCalled();
    // Not consumed as navigation: a live link's jump calls preventDefault.
    expect(event.defaultPrevented).toBe(false);
    editor.destroy();
  });
});

// The positive half of the same seam: a live link IS consumed, so the editor's
// caret handling never sees the click.
describe.each([
  ["read mode", false],
  ["edit mode", true],
])("a followed link in %s consumes the click", (_name, editable) => {
  it("the jump calls preventDefault", () => {
    const { host, editor } = mount(editable as boolean);
    expect(clickToken(host, ".mdb-atlink").defaultPrevented).toBe(true);
    editor.destroy();
  });
});
