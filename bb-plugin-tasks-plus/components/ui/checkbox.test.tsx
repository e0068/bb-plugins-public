// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { planned } from "../../test-support/planned.js";

const checkboxPath = "./checkbox.js";
const { Checkbox } = await planned<typeof import("./checkbox.js")>(() => import(/* @vite-ignore */ checkboxPath));

afterEach(cleanup);

function Controlled() {
  const [checked, setChecked] = useState(false);
  return (
    <label>
      <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} />
      Move tasks from a folder
    </label>
  );
}

describe("the Checkbox of the design system", () => {
  it("is a checkbox that follows its checked state on click", () => {
    render(<Controlled />);
    const box = screen.getByRole("checkbox", { name: "Move tasks from a folder" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles on its own when nobody controls it", () => {
    render(<Checkbox aria-label="Alone" />);
    const box = screen.getByRole("checkbox", { name: "Alone" });
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
  });
});
