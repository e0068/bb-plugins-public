// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_CATALOG } from "@bb-plugins/icon-catalog";
import { EntityIcon } from "./entity-icon";

afterEach(cleanup);

/** The `d` of every path a catalog icon draws, to tell which icon is shown. */
const pathsOf = (name: string) => ICON_CATALOG.get(name)!.flatMap(([, attrs]) => (typeof attrs.d === "string" ? [attrs.d] : []));
const drawnPaths = (svg: Element) => Array.from(svg.querySelectorAll("path")).map((path) => path.getAttribute("d"));

function drawn(element: ReactElement): SVGSVGElement | null {
  return render(element).container.querySelector("svg");
}

describe("an icon of a project, task, label, option or column", () => {
  it("draws a line icon in the given colour", () => {
    const svg = drawn(<EntityIcon icon="Rocket" color="steelblue" />)!;
    expect(drawnPaths(svg)).toEqual(pathsOf("Rocket"));
    expect(svg.querySelector("rect")).toBeNull();
    expect(svg.getAttribute("style")).toContain("steelblue");
  });

  it("draws a filled icon white on a tile of the colour", () => {
    const svg = drawn(<EntityIcon icon="filled:Rocket" color="steelblue" />)!;
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("steelblue");
    expect(drawnPaths(svg)).toEqual(pathsOf("Rocket"));
    expect(svg.querySelector("g")?.getAttribute("color")).toBe("white");
  });

  it("draws an emoji as itself", () => {
    const svg = drawn(<EntityIcon icon="🚀" />)!;
    expect(svg.querySelector("text")?.textContent).toBe("🚀");
  });

  it("draws the fallback when there is no icon or it is not one, and nothing without a fallback", () => {
    expect(drawnPaths(drawn(<EntityIcon color="steelblue" fallback="Folder01" />)!)).toEqual(pathsOf("Folder01"));
    cleanup();
    expect(drawnPaths(drawn(<EntityIcon icon="NoSuchIcon" color="steelblue" fallback="Folder01" />)!)).toEqual(pathsOf("Folder01"));
    cleanup();
    expect(drawn(<EntityIcon icon="NoSuchIcon" />)).toBeNull();
  });

  it("draws a black or white icon in the theme's text colour, so it shows on either theme", () => {
    for (const color of ["black", "white"]) {
      const svg = drawn(<EntityIcon icon="Rocket" color={color} />)!;
      expect(svg.getAttribute("class"), color).toContain("text-foreground");
      expect(svg.getAttribute("style") ?? "", color).not.toContain(color);
      cleanup();
    }
  });
});
