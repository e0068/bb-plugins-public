import { describe, expect, it } from "vitest";

import { extractLinkHrefs } from "./opener-links";

describe("extractLinkHrefs", () => {
  it("takes local markdown links, drops external schemes and anchors", () => {
    const body = [
      "see [the task](tasks/x.md) and [the index](../INDEX.md)",
      "[a site](https://example.com) — external",
      "[an anchor](#section) — not a file",
      "[mail](mailto:a@b.c)",
    ].join("\n");
    expect(extractLinkHrefs(body)).toEqual(["tasks/x.md", "../INDEX.md"]);
  });

  it("does NOT pick up a Claude @import: kasimov doesn't render it as a link", () => {
    // The difference from the original variant: the engine only makes the
    // markdown form `[text](href)` clickable, so @import doesn't get picked
    // up here — otherwise the server would treat as live a link the front end
    // never opens.
    const body = "config pulls in @AGENTS.md and @~/.claude/skills/x.md";
    expect(extractLinkHrefs(body)).toEqual([]);
  });

  it("doesn't match a user@host email in prose", () => {
    const body = "write to user@example.com — that's not a link";
    expect(extractLinkHrefs(body)).toEqual([]);
  });

  it("preserves order and collapses duplicates of the same spelling", () => {
    const body = "[a](a.md) [b](b.md) again [a](a.md)";
    expect(extractLinkHrefs(body)).toEqual(["a.md", "b.md"]);
  });

  it("an absolute path link passes through as in-tab", () => {
    const body = "[abs](/Users/me/notes/n.md)";
    expect(extractLinkHrefs(body)).toEqual(["/Users/me/notes/n.md"]);
  });
});
