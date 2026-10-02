// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Swatch } from "./bars";
import { fillStyle } from "./palette";

afterEach(cleanup);

const HAIRLINE = "inset 0 0 0 1px var(--border)";

describe("fillStyle — a series mark that stays visible on either theme", () => {
  it("rings white and black, which vanish into the light and the dark background", () => {
    expect(fillStyle("white")).toEqual({ backgroundColor: "white", boxShadow: HAIRLINE });
    expect(fillStyle("black")).toEqual({ backgroundColor: "black", boxShadow: HAIRLINE });
  });

  it("leaves every other colour bare", () => {
    for (const color of ["indianred", "#3b82f6", "var(--muted-foreground)"]) expect(fillStyle(color)).toEqual({ backgroundColor: color });
  });
});

describe("Swatch", () => {
  it("draws a black project's swatch with the hairline", () => {
    const { container } = render(<Swatch color="black" />);
    expect((container.firstChild as HTMLElement).style.boxShadow).toBe(HAIRLINE);
  });
});

describe("fillStyle — other spellings of white and black", () => {
  it("rings hex and capitalised white and black too", () => {
    for (const color of ["#fff", "#000000", "White"]) expect(fillStyle(color).boxShadow).toBe(HAIRLINE);
  });
});
