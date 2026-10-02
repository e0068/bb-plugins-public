// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ColorSwatchPicker } from "./shared";

afterEach(cleanup);

describe("ColorSwatchPicker — White and Black stay visible on either theme", () => {
  it("edges the White and Black swatches in the theme's border colour and leaves the hues bare", () => {
    render(<ColorSwatchPicker value="slateblue" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "White" }).className).toContain("border-border");
    expect(screen.getByRole("radio", { name: "Black" }).className).toContain("border-border");
    expect(screen.getByRole("radio", { name: "Red" }).className).not.toContain("border-border");
  });
});
