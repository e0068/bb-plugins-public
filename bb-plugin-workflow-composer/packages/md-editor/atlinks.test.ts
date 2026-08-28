// @vitest-environment jsdom
//
// Round-trip coverage for the opt-in `atLinks` option (see markdown.js,
// inlineDOM's atLinks branch and mkAtLink). Every test here either proves
// render→serialize is lossless for a specific shape, or proves the boundary
// rule keeps a look-alike (`user@host`) from becoming a link.
import { describe, expect, it, vi } from "vitest";

import { renderBody, serializeBody } from "./markdown.js";

function roundTrip(body: string, atLinks: boolean, linkResolver?: (href: string) => { onClick: () => void } | null) {
  const root = document.createElement("div");
  renderBody(root, body, linkResolver as any, atLinks);
  return serializeBody(root);
}

describe("atLinks: @path recognised as a link (opt-in)", () => {
  it("round-trips a bare @path line byte-for-byte", () => {
    const src = "@~/.claude/skills/git-hygiene/SKILL.md";
    const root = document.createElement("div");
    renderBody(root, src, undefined as any, true);

    const link = root.querySelector(".mde-atlink");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe(src);
    expect((link as HTMLElement).dataset.href).toBe("~/.claude/skills/git-hygiene/SKILL.md");

    expect(serializeBody(root)).toBe(src);
  });

  it("keeps a markdown link AND an @path link both live, and round-trips the mixed line", () => {
    const src = "см @a/b.md и [t](c.md)";
    const root = document.createElement("div");
    renderBody(root, src, undefined as any, true);

    expect(root.querySelectorAll(".mde-atlink").length).toBe(1);
    expect(root.querySelectorAll(".mde-link:not(.mde-atlink)").length).toBe(1);

    expect(serializeBody(root)).toBe(src);
  });

  it("does NOT turn user@example.com into a link — no whitespace/start boundary before @", () => {
    const src = "пиши на user@example.com";
    const root = document.createElement("div");
    renderBody(root, src, undefined as any, true);

    expect(root.querySelector(".mde-atlink")).toBeNull();
    expect(serializeBody(root)).toBe(src);
  });

  it("atLinks=false: @path stays plain text, output identical to input", () => {
    const src = "@~/.claude/skills/git-hygiene/SKILL.md";
    const root = document.createElement("div");
    renderBody(root, src, undefined as any, false);

    expect(root.querySelector(".mde-atlink")).toBeNull();
    expect(serializeBody(root)).toBe(src);
  });

  it("is idempotent across a multi-line body with headings and several @-imports", () => {
    const src = [
      "# Заголовок",
      "",
      "Смотри @~/.claude/skills/git-hygiene/SKILL.md и @~/.claude/skills/project-memory-v2/SKILL.md",
      "",
      "письмо на admin@example.com — не ссылка",
      "",
      "## Подраздел",
      "- пункт с @relative/path.md внутри",
    ].join("\n");

    expect(roundTrip(src, true)).toBe(src);
  });

  it("calls linkResolver with the href WITHOUT the leading @", () => {
    const resolver = vi.fn((_href: string) => null);
    const root = document.createElement("div");
    renderBody(root, "@~/.claude/x.md", resolver as any, true);

    expect(resolver).toHaveBeenCalledWith("~/.claude/x.md");
  });
});
