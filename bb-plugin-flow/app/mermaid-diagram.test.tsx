// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => ({ svg: `<svg data-drawn="${source.split("\n")[0]}"></svg>` })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

import { RichText } from "./linked-text";
import { MermaidDiagram } from "./mermaid-diagram";

afterEach(() => {
  cleanup();
  mermaid.initialize.mockClear();
  document.documentElement.style.colorScheme = "";
});

const BLOCK = "До схемы.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nПосле схемы.";

describe("mermaid in Flow widgets", () => {
  it("a mermaid block in brief text is drawn as a diagram between its paragraphs", async () => {
    const { container } = render(<RichText text={BLOCK} />);
    await waitFor(() => expect(container.querySelector("[data-mermaid] svg")?.getAttribute("data-drawn")).toBe("flowchart LR"));
    expect(container.textContent).toContain("До схемы.");
    expect(container.textContent).toContain("После схемы.");
    expect(container.textContent).not.toContain("```");
  });

  it("a diagram that fails to draw stays its source in a monospace block", async () => {
    const { container } = render(<MermaidDiagram source={"flowchart LR\n  A -->"} render={() => Promise.reject(new Error("Parse error"))} />);
    await waitFor(() => expect(container.querySelector("[data-mermaid-source]")?.textContent).toBe("flowchart LR\n  A -->"));
    expect(container.querySelector("[data-mermaid]")).toBeNull();
  });

  it("the diagram follows the dark theme of bb", async () => {
    document.documentElement.style.colorScheme = "dark";
    const { container } = render(<RichText text={BLOCK} />);
    await waitFor(() => expect(container.querySelector("[data-mermaid] svg")).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("switching the bb theme redraws an open diagram in the new theme", async () => {
    const { container } = render(<RichText text={BLOCK} />);
    await waitFor(() => expect(container.querySelector("[data-mermaid] svg")).not.toBeNull());
    document.documentElement.style.colorScheme = "dark";
    await waitFor(() => expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" })));
  });

  it("the diagram follows the light theme of bb", async () => {
    const { container } = render(<RichText text={BLOCK} />);
    await waitFor(() => expect(container.querySelector("[data-mermaid] svg")).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "default" }));
  });

  it("text without a diagram renders as before", () => {
    const { container } = render(<RichText text="Просто строка" />);
    expect(container.innerHTML).toBe("Просто строка");
  });
});
