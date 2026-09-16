// @vitest-environment jsdom
//
// A consumer that reacts to clicks around the editor (Claude Config enters
// edit mode on a click in the text) must leave clicks on links to the editor.
// The selector for "this is a link token" belongs to the engine that draws the
// tokens: Kasimov's selector (packages/md-doc-view) names other classes, and
// borrowing it made every link here look like plain text to the click guard.
import { describe, expect, it } from "vitest";

import { LINK_TOKEN_SELECTOR } from "./link-tokens";
import { VanillaMarkdownEditor } from "./vanilla";

describe("LINK_TOKEN_SELECTOR", () => {
  it.each([true, false])("matches both link tokens the engine draws (editable=%s)", (editable) => {
    const host = document.createElement("div");
    new VanillaMarkdownEditor(host, {
      value: "@~/.claude/skills/x/SKILL.md and [the skill](skills/x/SKILL.md) and plain text",
      editable,
      atLinks: true,
      linkResolver: () => ({ onClick: () => {} }),
    });
    const tokens = [...host.querySelectorAll(LINK_TOKEN_SELECTOR)].map((el) => el.textContent);
    expect(tokens.some((text) => text?.includes("SKILL.md") && text.startsWith("@"))).toBe(true);
    expect(tokens.some((text) => text === "the skill")).toBe(true);
    expect(host.querySelector(".mdb-root")?.textContent).toContain("plain text");
  });
});
