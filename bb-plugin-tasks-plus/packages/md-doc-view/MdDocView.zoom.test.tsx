// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { LoadedDoc } from "./MdDocView";

// The engine is vanilla DOM; the mock stands in for the markup this suite is
// about — a block picture the way decorateImages builds it, plus ordinary text
// beside it (kasimov.js). Everything else about the view is other suites'.
vi.mock("./KasimovEditor", () => ({
  KasimovEditor: ({ editable }: { editable?: boolean }) => (
    <div data-testid="mde" data-editable={String(editable)}>
      <span className="mde-imgblock">
        <span className="mde-ctl mde-imgwrap">
          <img className="mde-ctl mde-imgpic" src="shot.png" alt="the shot" />
        </span>
        <span className="mde-ctl mde-imgcaprow">
          <span className="mde-imgcap">the shot</span>
        </span>
      </span>
      <p data-testid="prose">plain text</p>
    </div>
  ),
}));

import { MdDocView } from "./test-support/libraries";

afterEach(cleanup);

const DOC: LoadedDoc = { path: "/a.md", content: "![the shot](shot.png)", sha256: "sha-a" };

const renderView = () =>
  render(
    <MdDocView
      initialPath="/a.md"
      load={vi.fn(async () => DOC)}
      save={vi.fn(async () => ({ outcome: "written" as const, sha256: "sha-new" }))}
      resolveLinkTarget={() => null}
    />,
  );

const unfolded = () => document.querySelector(".mdo-zoom img");
const picture = () => screen.getByAltText("the shot");

// Radix's Tabs trigger switches on mousedown, not on click.
const switchTo = (name: "Read" | "Write" | "Raw") => {
  const segment = screen.getByRole("tab", { name });
  fireEvent.mouseDown(segment);
  fireEvent.click(segment);
};

describe("MdDocView — unfolding a picture", () => {
  it("nothing is unfolded until a picture is clicked", async () => {
    renderView();
    await screen.findByTestId("mde");
    expect(unfolded()).toBeNull();
  });

  it("a click on the picture unfolds it over bb", async () => {
    renderView();
    await screen.findByTestId("mde");
    fireEvent.click(picture());
    expect(unfolded()).toHaveAttribute("src", "shot.png");
  });

  it("a second click on the unfolded picture folds it back", async () => {
    renderView();
    await screen.findByTestId("mde");
    fireEvent.click(picture());
    fireEvent.click(unfolded() as Element);
    expect(unfolded()).toBeNull();
  });

  it("a click on the document's text unfolds nothing", async () => {
    renderView();
    await screen.findByTestId("mde");
    fireEvent.click(screen.getByTestId("prose"));
    expect(unfolded()).toBeNull();
  });

  it("the caption row is not a picture to unfold", async () => {
    renderView();
    await screen.findByTestId("mde");
    fireEvent.click(document.querySelector(".mdo-doc .mde-imgcap") as Element);
    expect(unfolded()).toBeNull();
  });

  // Write is where the "⋯" menu lives, but a picture is still there to be read.
  it("a picture unfolds in Write as well", async () => {
    renderView();
    await screen.findByTestId("mde");
    switchTo("Write");
    expect(screen.getByTestId("mde")).toHaveAttribute("data-editable", "true");
    fireEvent.click(picture());
    expect(unfolded()).toHaveAttribute("src", "shot.png");
  });
});

// The document under the unfolded picture must not scroll away beneath it. The
// lever is the dialog being modal: Radix then puts the app behind it under
// react-remove-scroll, which is what marks the body. A non-modal dialog would
// leave the mark off — and the document scrolling.
describe("MdDocView — the document under the unfolded picture", () => {
  const locked = () => document.body.hasAttribute("data-scroll-locked");

  it("nothing is locked while nothing is unfolded", async () => {
    renderView();
    await screen.findByTestId("mde");
    expect(locked()).toBe(false);
  });

  it("the app behind the unfolded picture is locked, and let go when it folds", async () => {
    renderView();
    await screen.findByTestId("mde");
    fireEvent.click(picture());
    expect(locked()).toBe(true);
    fireEvent.click(unfolded() as Element);
    expect(locked()).toBe(false);
  });
});
