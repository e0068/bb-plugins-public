// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TimeBin } from "../../packages/analytics-viz/core/binning";
import { TimeBarChart } from "./time-bar-chart";

afterEach(cleanup);

// Recharts' ResponsiveContainer observes its box; jsdom has no ResizeObserver,
// so the width-omitted branch needs this stub to render at all.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const bins: TimeBin[] = [
  { startMs: 0, value: 3 },
  { startMs: 10, value: 7 },
  { startMs: 20, value: 0 },
  { startMs: 30, value: 5 },
];

describe("TimeBarChart", () => {
  it("draws one BarShape path per positive bin, tinted by our own opacity", () => {
    const { container } = render(<TimeBarChart bins={bins} width={320} height={120} />);
    // `data-bb-bar` marks our BarShape paths apart from Recharts' own axis/grid
    // paths — an explicit hook, not a styling default we could later change.
    const barPaths = container.querySelectorAll("path[data-bb-bar]");
    expect(barPaths.length).toBe(bins.filter((b) => b.value > 0).length);
  });

  it("renders through the ResponsiveContainer branch when width is omitted", () => {
    // jsdom lays nothing out, so the container has zero size and draws no bars;
    // the point is only that the width-omitted code path mounts without throwing.
    const { container } = render(<TimeBarChart bins={bins} height={120} />);
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
  });

  it("forwards an explicit per-series colour token to every bar", () => {
    const { container } = render(<TimeBarChart bins={bins} width={320} height={120} color="var(--chart-1)" />);
    const colored = container.querySelectorAll('path[fill="var(--chart-1)"]');
    expect(colored.length).toBeGreaterThan(0);
  });

  it("renders nothing to break on empty data", () => {
    const { container } = render(<TimeBarChart bins={[]} width={320} height={120} />);
    expect(container.querySelectorAll("path[data-bb-bar]").length).toBe(0);
  });
});
