// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DivergingBars } from "./bars";

afterEach(cleanup);

const up = { id: "created", label: "Created", color: "red", values: [2, 0] };
const down = { id: "closed", label: "Closed", color: "blue", values: [1, 3] };

describe("DivergingBars", () => {
  it("lays the underlay before the columns and the overlay after them", () => {
    const { container } = render(<DivergingBars up={up} down={down} columnLabel={String} ticks={[]} underlay={<i data-under />} overlay={<i data-over />} />);
    const order = Array.from(container.querySelectorAll("[data-under], [data-column], [data-over]")).map((node) => (node.hasAttribute("data-column") ? "column" : node.hasAttribute("data-under") ? "under" : "over"));
    expect(order).toEqual(["under", "column", "column", "over"]);
  });

  it("reports the clicked half's column and series", () => {
    const onSelect = vi.fn();
    const { container } = render(<DivergingBars up={up} down={down} columnLabel={String} ticks={[]} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('[data-segment="1:closed"]')!);
    expect(onSelect).toHaveBeenCalledWith(1, "closed");
  });

  it("dims every half but the selected one", () => {
    const { container } = render(<DivergingBars up={up} down={down} columnLabel={String} ticks={[]} selected={{ column: 0, seriesId: "created" }} onSelect={() => {}} />);
    expect(container.querySelector('[data-segment="0:created"]')!.getAttribute("data-dimmed")).toBe("false");
    expect(container.querySelector('[data-segment="0:closed"]')!.getAttribute("data-dimmed")).toBe("true");
  });
});

describe("DivergingBars — the scale", () => {
  it("draws both halves on the scale it is given, so a grid laid on the same scale lines up", () => {
    const { container } = render(<DivergingBars up={up} down={down} columnLabel={String} ticks={[]} max={4} />);
    expect((container.querySelector('[data-segment="0:created"]') as HTMLElement).style.height).toBe("50%");
  });
});
