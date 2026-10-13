// @vitest-environment jsdom
// The real engine, not a stub: what is promised here is the markup Kasimov
// draws for a piece of text, and jsdom builds it the same as a browser.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";

import { MdText } from "./MdText";
import { MD_TEXT_CLASS, mdTextVars } from "./md-text";

afterEach(cleanup);

const none = () => null;

describe("MdText", () => {
  it("a markdown table is drawn as a table, not as lines with bars", () => {
    const { container } = render(<MdText text={"| A | B |\n| --- | --- |\n| 1 | 2 |"} linkResolver={none} />);
    const cells = [...container.querySelectorAll("table td")].map((td) => td.textContent);
    expect(cells).toEqual(["A", "B", "1", "2"]);
    expect(container.textContent).not.toContain("|");
  });

  it("headings, code, quotes, bold and lists get the engine's own markup", () => {
    const { container } = render(<MdText text={"# H\n> q\n**b** `c`\n- x\n```ts\nx\n```"} linkResolver={none} />);
    for (const selector of [".mde-h", ".mde-quote", "b", "code", ".mde-li", "pre.mde-code"]) expect(container.querySelector(selector)).not.toBeNull();
  });

  it("a click on a link the resolver answered calls its onClick with the raw href", () => {
    const onClick = vi.fn();
    const resolver = vi.fn((href: string) => (href === "a/b.ts:12" ? { onClick } : null));
    const { container } = render(<MdText text="see [file](a/b.ts:12)" linkResolver={resolver} />);
    fireEvent.click(container.querySelector(".mde-link-live")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a live link is a link for the keyboard and a screen reader: role, focus, Enter follows it", () => {
    const onClick = vi.fn();
    const { getByRole } = render(<MdText text="see [file](a.ts)" linkResolver={() => ({ onClick })} />);
    const link = getByRole("link", { name: "file" });
    expect(link.tabIndex).toBe(0);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("new text keeps its live links links", () => {
    const resolver = () => ({ onClick: () => {} });
    const { getByRole, rerender } = render(<MdText text="see [one](a.ts)" linkResolver={resolver} />);
    rerender(<MdText text="see [two](b.ts)" linkResolver={resolver} />);
    expect(getByRole("link", { name: "two" })).not.toBeNull();
  });

  it("a link the resolver can't open stays a plain token", () => {
    const { container } = render(<MdText text="see [file](nowhere.ts)" linkResolver={none} />);
    expect(container.querySelector(".mde-link-live")).toBeNull();
    expect(container.textContent).toBe("see file");
  });

  it("a new resolver redraws the links: one that couldn't open a link before now can", () => {
    const { container, rerender } = render(<MdText text="see [file](a.ts)" linkResolver={none} />);
    rerender(<MdText text="see [file](a.ts)" linkResolver={() => ({ onClick: () => {} })} />);
    expect(container.querySelector(".mde-link-live")).not.toBeNull();
  });

  it("the text is in the DOM in the same commit, before the frame is painted", () => {
    const seen: (string | null)[] = [];
    function Probe({ text }: { text: string }) {
      const ref = useRef<HTMLDivElement | null>(null);
      // A parent's layout effect runs after its children's layout effects and before any passive one.
      useLayoutEffect(() => {
        seen.push(ref.current!.textContent);
      });
      return (
        <div ref={ref}>
          <MdText text={text} linkResolver={none} />
        </div>
      );
    }
    const { rerender } = render(<Probe text="one" />);
    rerender(<Probe text="two" />);
    expect(seen).toEqual(["one", "two"]);
  });

  it("new text replaces the old one in place", () => {
    const { container, rerender } = render(<MdText text="one" linkResolver={none} />);
    rerender(<MdText text="two" linkResolver={none} />);
    expect(container.textContent).toBe("two");
  });

  it("is read-only: nothing in it can be edited", () => {
    const { container } = render(<MdText text="x" linkResolver={none} />);
    expect(container.querySelector("[contenteditable='true']")).toBeNull();
  });

  it("the host carries the class the look hangs on, and one style rule serves every text", () => {
    const { container } = render(
      <>
        <MdText text="a" linkResolver={none} />
        <MdText text="b" linkResolver={none} />
      </>,
    );
    expect(container.querySelectorAll(`.${MD_TEXT_CLASS}`)).toHaveLength(2);
    const rules = [...document.head.querySelectorAll("style")].filter((s) => s.textContent?.includes(`.${MD_TEXT_CLASS} .mde-root`));
    expect(rules).toHaveLength(1);
  });
});

describe("mdTextVars", () => {
  it("drops a document's format margins and column cap", () => {
    expect(mdTextVars).toMatchObject({ "--kasi-pad-x": "0", "--kasi-max-width": "none" });
  });

  it("keeps MD Opener's stock preset, every value a real one the engine can read back", () => {
    expect(mdTextVars).toMatchObject({ "--kasi-fg": "var(--foreground)", "--kasi-accent": "var(--timeline-accent)", "--kasi-mono": "var(--font-mono)" });
    expect(Object.values(mdTextVars)).not.toContain("inherit");
  });

  it("a diagram's panel follows the host's background, not the engine's dark default", () => {
    expect(mdTextVars).toMatchObject({ "--kasi-mermaid-bg": "var(--background)", "--kasi-surface": "var(--background)" });
  });
});
