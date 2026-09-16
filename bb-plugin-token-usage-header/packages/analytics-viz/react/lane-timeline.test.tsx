// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LaneTimeline } from "./lane-timeline";

afterEach(cleanup);

// Recharts' ResponsiveContainer observes its box; jsdom has no ResizeObserver,
// so the width-omitted branch needs this stub to render at all.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;


describe("LaneTimeline", () => {
  const items = [
    { key: "todo", weight: 2, color: "var(--chart-1)", label: "To do" },
    { key: "doing", weight: 1, color: "var(--chart-2)", label: "Doing" },
    { key: "done", weight: 5, color: "var(--chart-3)", label: "Done" },
  ];

  it("draws one rect per non-empty segment, in order, none past the lane width", () => {
    const { container } = render(<LaneTimeline items={items} width={200} height={12} ariaLabel="Status split" />);
    const rects = Array.from(container.querySelectorAll("rect"));
    expect(rects.length).toBe(items.length);
    let prevRight = -1;
    for (const rect of rects) {
      const x = Number(rect.getAttribute("x"));
      const w = Number(rect.getAttribute("width"));
      expect(x).toBeGreaterThanOrEqual(prevRight - 1e-6);
      expect(x + w).toBeLessThanOrEqual(200 + 1e-6);
      prevRight = x + w;
    }
  });

  it("names the lane and each segment for assistive tech", () => {
    const { container, getByLabelText } = render(
      <LaneTimeline items={items} width={200} height={12} ariaLabel="Status split" />,
    );
    expect(getByLabelText("Status split")).toBeDefined();
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("Done");
  });

  it("omits a zero-weight segment rather than drawing a zero-width rect", () => {
    const withZero = [
      { key: "a", weight: 0 },
      { key: "b", weight: 1 },
    ];
    const { container } = render(<LaneTimeline items={withZero} width={100} height={10} />);
    // 'a' has zero weight → zero width → skipped; only 'b' remains.
    expect(container.querySelectorAll("rect").length).toBe(1);
  });
});
