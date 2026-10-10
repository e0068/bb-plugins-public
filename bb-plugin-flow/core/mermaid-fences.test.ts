import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { fencedParts } from "./mermaid-fences";

describe("fencedParts", () => {
  it("text without a mermaid block is one text part", () => {
    expect(fencedParts("Просто текст\n\nвторой абзац")).toEqual([{ kind: "text", text: "Просто текст\n\nвторой абзац" }]);
  });

  it("empty text has no parts", () => {
    expect(fencedParts("  \n ")).toEqual([]);
  });

  it("a mermaid block between paragraphs becomes a diagram with its source", () => {
    const text = "До схемы.\n\n```mermaid\nflowchart LR\n  A --> B\n\n  B --> C\n```\n\nПосле схемы.";
    expect(fencedParts(text)).toEqual([
      { kind: "text", text: "До схемы.\n\n" },
      { kind: "diagram", source: "flowchart LR\n  A --> B\n\n  B --> C" },
      { kind: "text", text: "\n\nПосле схемы." },
    ]);
  });

  it("two blocks in a row are two diagrams", () => {
    expect(fencedParts("```mermaid\ngraph TD\n```\n```mermaid\npie\n```").map((part) => part.kind)).toEqual(["diagram", "diagram"]);
  });

  it("a block without closing backticks stays text", () => {
    expect(fencedParts("```mermaid\nflowchart LR")).toEqual([{ kind: "text", text: "```mermaid\nflowchart LR" }]);
  });

  it("a fence of another language stays text", () => {
    expect(fencedParts("```ts\nconst a = 1;\n```")).toEqual([{ kind: "text", text: "```ts\nconst a = 1;\n```" }]);
  });

  it("text without fences comes back whole", () => {
    fc.assert(fc.property(fc.string().filter((s) => !s.includes("`") && s.trim() !== ""), (s) => {
      expect(fencedParts(s)).toEqual([{ kind: "text", text: s }]);
    }));
  });
});
