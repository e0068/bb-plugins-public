import { describe, expect, it } from "vitest";
import { firstParagraph } from "./first-paragraph";

describe("firstParagraph", () => {
  it("skips the headings above the text and stops at the first blank line", () => {
    expect(firstParagraph("## Проблема\n\nКлюч стоит сверху.\nЕго не спрятать.\n\n## Метод\n\nДругое.")).toBe(
      "Ключ стоит сверху. Его не спрятать.",
    );
  });

  it("drops a heading glued to its text without a blank line", () => {
    expect(firstParagraph("# Title\nThe text")).toBe("The text");
  });

  it("strips inline markup: emphasis, code, links and images", () => {
    expect(firstParagraph("A **bold** _move_ with `code`, a [link](https://x.y) and ![pic](a.png).")).toBe(
      "A bold move with code, a link and pic.",
    );
  });

  it("reads a list or a quote as plain lines", () => {
    expect(firstParagraph("- one\n- two")).toBe("one two");
    expect(firstParagraph("> quoted\n> text")).toBe("quoted text");
  });

  it("passes over code fences, comments and rules before the text", () => {
    expect(firstParagraph("```ts\nconst x = 1;\n```\n\n<!-- note -->\n\n---\n\nReal text")).toBe("Real text");
  });

  it("gives an empty string when there is no text at all", () => {
    expect(firstParagraph("")).toBe("");
    expect(firstParagraph("## Only a heading\n\n## Another")).toBe("");
  });
});

describe("firstParagraph across lines and wiki links", () => {
  it("strips emphasis that wraps over a line break inside the paragraph", () => {
    expect(firstParagraph("_Ретроспективная реконструкция\nпо сверке доски._\n\nДальше.")).toBe(
      "Ретроспективная реконструкция по сверке доски.",
    );
  });

  it("reads a wiki link as its name", () => {
    expect(firstParagraph("See [[bb-auto-commits]] first.")).toBe("See bb-auto-commits first.");
  });
});
