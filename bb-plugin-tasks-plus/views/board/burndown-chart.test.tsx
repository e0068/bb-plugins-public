// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BurndownChart } from "./subtask-stats.js";

afterEach(cleanup);

const DAY = 86_400_000;
/** Day ends at noon from Thursday 2026-09-17 through Thursday 2026-10-15. */
const noonEnds = (count: number) => Array.from({ length: count }, (_, i) => new Date(2026, 8, 17 + i, 12).getTime());
const marks = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-week-break]"));

describe("a card's burndown over a period in days", () => {
  it("marks every Monday of a week of days with a line and the week's date", () => {
    const { container } = render(<BurndownChart open={[3, 3, 2, 2, 2, 1, 1, 1]} ends={noonEnds(8)} period={7} forecastDays={null} />);
    expect(marks(container)).toHaveLength(1);
    expect(container.querySelector("[data-week-label]")?.textContent).toBe(
      new Date(2026, 8, 21).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });

  it("marks the four Mondays of 28 days", () => {
    const { container } = render(<BurndownChart open={Array.from({ length: 29 }, () => 1)} ends={noonEnds(29)} period={28} forecastDays={null} />);
    expect(marks(container)).toHaveLength(4);
  });

  it("marks nothing over all time, where every column is a week", () => {
    const ends = Array.from({ length: 6 }, (_, i) => new Date(2026, 8, 17).getTime() + i * 7 * DAY);
    const { container } = render(<BurndownChart open={[5, 4, 3, 3, 2, 1]} ends={ends} period={0} forecastDays={3} />);
    expect(marks(container)).toHaveLength(0);
  });

  it("names how far back it looks: days for a short period, the first date for all time", () => {
    const week = render(<BurndownChart open={[1, 1, 1, 1, 1, 1, 1, 1]} ends={noonEnds(8)} period={7} forecastDays={null} />);
    expect(week.getByText("7 d ago")).toBeTruthy();
    cleanup();
    const ends = Array.from({ length: 6 }, (_, i) => new Date(2026, 8, 17).getTime() + i * 7 * DAY);
    const all = render(<BurndownChart open={[5, 4, 3, 3, 2, 1]} ends={ends} period={0} forecastDays={3} />);
    expect(all.getByText(`since ${new Date(2026, 8, 17).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`)).toBeTruthy();
  });
});
