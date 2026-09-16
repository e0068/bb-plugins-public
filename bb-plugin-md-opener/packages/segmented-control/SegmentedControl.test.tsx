import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedControl } from "./test-support/tabs-kit";

const OPTIONS = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "raw", label: "Raw" },
] as const;

describe("SegmentedControl", () => {
  it("marks exactly the option in `value` as selected", () => {
    render(<SegmentedControl value="write" onChange={vi.fn()} options={OPTIONS} />);

    expect(screen.getByRole("tab", { name: "Read" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Write" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Raw" }).getAttribute("aria-selected")).toBe("false");
  });

  it("reports the value of the segment that was pressed", () => {
    const onChange = vi.fn();
    render(<SegmentedControl value="read" onChange={onChange} options={OPTIONS} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Raw" }));
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));

    expect(onChange).toHaveBeenCalledWith("raw");
  });

  // The icon is a ReactNode rather than a name from a plugin's registry — the
  // registry lives above this package. So the promise is that whatever the
  // consumer hands over is rendered inside its own segment, not that some
  // particular icon set works.
  it("renders the icon it was handed inside that segment", () => {
    render(
      <SegmentedControl
        value="read"
        onChange={vi.fn()}
        options={[
          { value: "read", label: "Read", icon: <svg data-testid="read-icon" /> },
          { value: "raw", label: "Raw" },
        ]}
      />,
    );

    const segment = screen.getByRole("tab", { name: "Read" });
    expect(segment).toContainElement(screen.getByTestId("read-icon"));
    expect(screen.getByRole("tab", { name: "Raw" }).querySelector("svg")).toBeNull();
  });

  it("puts the aria-label on the list of segments", () => {
    render(
      <SegmentedControl value="read" onChange={vi.fn()} options={OPTIONS} aria-label="Режим файла" />,
    );

    expect(screen.getByRole("tablist", { name: "Режим файла" })).toBeInTheDocument();
  });
});
