// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOSPHOR_FILL, PHOSPHOR_LINE } from "@bb-plugins/icon-catalog";
import { EntityIcon } from "./entity-icon";
import { IconPicker } from "./icon-picker";

afterEach(cleanup);

const search = (text: string) => fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: text } });
const drawnPaths = (svg: Element) => Array.from(svg.querySelectorAll("path")).map((path) => path.getAttribute("d"));
const drawn = (icon: string, color?: string) => render(<EntityIcon icon={icon} color={color} />).container.querySelector("svg")!;

describe("the icon picker offers Phosphor's signs and the icon's own colours", () => {
  it("offers Phosphor's line signs on the Line tab and its filled signs on the Filled tab", () => {
    const onPick = vi.fn();
    render(<IconPicker onPick={onPick} />);

    search("folder-simple-star");
    fireEvent.click(screen.getByRole("button", { name: "folder-simple-star" }));
    fireEvent.click(screen.getByRole("button", { name: "Filled" }));
    search("rocket-launch");
    fireEvent.click(screen.getByRole("button", { name: "rocket-launch" }));

    expect(onPick.mock.calls).toEqual([["ph:folder-simple-star"], ["filled:ph:rocket-launch"]]);
  });

  it("picks an icon in the line and tile colours chosen above the grid", () => {
    const onPick = vi.fn();
    render(<IconPicker color="steelblue" onPick={onPick} />);

    fireEvent.click(screen.getByRole("radio", { name: "Red line" }));
    search("Rocket");
    fireEvent.click(screen.getByRole("button", { name: "Rocket" }));
    fireEvent.click(screen.getByRole("button", { name: "Filled" }));
    fireEvent.click(screen.getByRole("radio", { name: "Black background" }));
    search("rocket-launch");
    fireEvent.click(screen.getByRole("button", { name: "rocket-launch" }));

    expect(onPick.mock.calls).toEqual([["Rocket;c=indianred"], ["filled:ph:rocket-launch;c=indianred;bg=black"]]);
  });

  it("recolours the chosen icon at once, and takes its tile off with No background", () => {
    const onPick = vi.fn();
    const onRecolor = vi.fn();
    render(<IconPicker value="filled:ph:star;bg=steelblue" onPick={onPick} onRecolor={onRecolor} />);

    fireEvent.click(screen.getByRole("radio", { name: "Yellow line" }));
    fireEvent.click(screen.getByRole("radio", { name: "No background" }));

    expect(onRecolor.mock.calls).toEqual([["filled:ph:star;c=goldenrod;bg=steelblue"], ["filled:ph:star;c=goldenrod"]]);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("gives the line back to the bearer's colour with Default line", () => {
    const onRecolor = vi.fn();
    render(<IconPicker value="ph:star;c=indianred" color="steelblue" onPick={() => {}} onRecolor={onRecolor} />);

    expect(screen.getByRole("radio", { name: "Blue line" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: "Default line" }));

    expect(onRecolor).toHaveBeenCalledWith("ph:star");
  });

  it("offers no colours for an emoji", () => {
    render(<IconPicker value="🚀" onPick={() => {}} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("an icon drawn in its own colours", () => {
  it("draws a Phosphor sign scaled from its 256 box into the icon's 24", () => {
    const svg = drawn("ph:rocket", "steelblue");
    expect(drawnPaths(svg)).toEqual(PHOSPHOR_LINE.get("rocket"));
    expect(svg.querySelector("g")?.getAttribute("transform")).toBe("scale(0.09375)");
    expect(svg.getAttribute("style")).toContain("steelblue");
  });

  it("draws a filled sign bare in its line colour, over the bearer's", () => {
    const svg = drawn("filled:ph:rocket;c=indianred", "steelblue");
    expect(drawnPaths(svg)).toEqual(PHOSPHOR_FILL.get("rocket"));
    expect(svg.querySelector("rect")).toBeNull();
    expect(svg.getAttribute("style")).toContain("indianred");
  });

  it("draws a filled sign on a tile of its background, white unless it chose a line colour", () => {
    const white = drawn("filled:ph:rocket;bg=goldenrod", "steelblue");
    expect(white.querySelector("rect")?.getAttribute("fill")).toBe("goldenrod");
    expect(white.querySelector("g")?.getAttribute("color")).toBe("white");
    cleanup();
    const black = drawn("filled:ph:rocket;c=black;bg=goldenrod");
    expect(black.querySelector("g")?.getAttribute("color")).toBe("black");
  });

  it("draws an emoji in a fill Chrome shows a colour emoji with", () => {
    expect(drawn("🚀").querySelector("text")?.getAttribute("fill")).toBe("currentColor");
  });
});
