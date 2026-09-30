// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ImageZoom } from "./ImageZoom";

afterEach(cleanup);

const shot = { src: "shot.png", alt: "the shot" };

const unfolded = () => screen.getByRole("img", { name: /.*/ });
const overlay = () => document.querySelector(".mdo-zoom-overlay") as HTMLElement;
const sheet = () => document.querySelector(".mdo-zoom") as HTMLElement;

describe("ImageZoom", () => {
  it("nothing is drawn while there is nothing to unfold", () => {
    render(<ImageZoom target={null} onClose={vi.fn()} />);
    expect(document.querySelector(".mdo-zoom")).toBeNull();
  });

  it("the unfolded picture is the one that was clicked", () => {
    render(<ImageZoom target={shot} onClose={vi.fn()} />);
    expect(unfolded()).toHaveAttribute("src", "shot.png");
    expect(unfolded()).toHaveAttribute("alt", "the shot");
  });

  it("a second click on the unfolded picture folds it back", () => {
    const onClose = vi.fn();
    render(<ImageZoom target={shot} onClose={onClose} />);
    fireEvent.click(unfolded());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click beside the picture folds it back", () => {
    const onClose = vi.fn();
    render(<ImageZoom target={shot} onClose={onClose} />);
    fireEvent.click(sheet());
    expect(onClose).toHaveBeenCalled();
  });

  it("a click on the dimmed backdrop folds it back", () => {
    const onClose = vi.fn();
    render(<ImageZoom target={shot} onClose={onClose} />);
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape folds it back", () => {
    const onClose = vi.fn();
    render(<ImageZoom target={shot} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("the caption under the picture is the alt text", () => {
    render(<ImageZoom target={shot} onClose={vi.fn()} />);
    expect(document.querySelector(".mdo-zoom-cap")).toHaveTextContent("the shot");
  });

  it("a picture without alt gets no caption", () => {
    render(<ImageZoom target={{ src: "shot.png", alt: "" }} onClose={vi.fn()} />);
    expect(document.querySelector(".mdo-zoom-cap")).toBeNull();
  });

  // Portaled nodes live outside the plugin's root; without these marks the host
  // does not count them as plugin chrome (portal-scope.ts).
  it("both portaled nodes carry the plugin's marks", () => {
    render(<ImageZoom target={shot} onClose={vi.fn()} />);
    expect(overlay()).toHaveAttribute("data-bb-plugin-root");
    expect(overlay()).toHaveAttribute("data-bb-portaled-overlay");
    expect(sheet()).toHaveAttribute("data-bb-plugin-root");
    expect(sheet()).toHaveAttribute("data-bb-portaled-overlay");
  });
});
