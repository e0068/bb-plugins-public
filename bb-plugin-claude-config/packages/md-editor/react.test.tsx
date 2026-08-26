// @vitest-environment jsdom
//
// Structural unit test for the MarkdownEditor wrapper. jsdom cannot
// reproduce real contenteditable *editing* behavior, so this test only
// checks plain DOM construction the vanilla editor performs on mount
// (appendChild, classList) — the same scope as
// bb-plugin-shelf/components/MarkdownEditor.test.tsx, which this test
// mirrors and extends with the editable/linkResolver cases specific to
// this package's wider prop surface.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { MarkdownEditor } from "./react";

afterEach(cleanup);

describe("MarkdownEditor wrapper", () => {
  it("renders its host element with the bb-mde-host class the theme CSS targets", () => {
    const { container } = render(<MarkdownEditor value="# hi" />);

    const host = container.querySelector(".bb-mde-host");
    expect(host).not.toBeNull();
  });

  it("mounts the vanilla editor's .mde-root as a CHILD of the host (not styled on the host itself)", () => {
    const { container } = render(<MarkdownEditor value="# hi" />);

    const host = container.querySelector(".bb-mde-host");
    // .mde-root must be a descendant, never the host element itself — this
    // is exactly the structural fact that makes `.bb-mde-host .mde-root`
    // (as opposed to `.bb-mde-host { --mde-*: … }` alone) the correct fix.
    expect(host?.classList.contains("mde-root")).toBe(false);
    expect(host?.querySelector(".mde-root")).not.toBeNull();
  });

  it("sets contenteditable=false on .mde-root when editable=false", () => {
    const { container } = render(
      <MarkdownEditor value="# hi" editable={false} />,
    );

    const root = container.querySelector(".mde-root");
    expect(root?.getAttribute("contenteditable")).toBe("false");
  });

  it("defaults to editable (contenteditable=true) when editable is not passed", () => {
    const { container } = render(<MarkdownEditor value="# hi" />);

    const root = container.querySelector(".mde-root");
    expect(root?.getAttribute("contenteditable")).toBe("true");
  });

  it("gives a link the mde-link-live class when linkResolver resolves it", () => {
    const { container } = render(
      <MarkdownEditor
        value="[t](x)"
        linkResolver={(href) =>
          href === "x" ? { label: "t", onClick: () => {} } : null
        }
      />,
    );

    const link = container.querySelector(".mde-link");
    expect(link?.classList.contains("mde-link-live")).toBe(true);
    expect(link?.classList.contains("mde-link-plain")).toBe(false);
  });

  it("gives a link the mde-link-plain class when no linkResolver is provided", () => {
    const { container } = render(<MarkdownEditor value="[t](x)" />);

    const link = container.querySelector(".mde-link");
    expect(link?.classList.contains("mde-link-plain")).toBe(true);
    expect(link?.classList.contains("mde-link-live")).toBe(false);
  });
});
