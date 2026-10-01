// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rampColors, ReducedColorsProvider, type SeriesPainting } from "@bb-plugins/reduced-colors";

import { TASK_STATUSES, TASK_TYPES } from "../../db/types.js";
import { chartColors, ChartColorsScope, useChartColors } from "./chart-colors";
import { seriesColor } from "./closed-model";
import { STATUS_COLOR, TYPE_COLOR } from "./palette";

afterEach(cleanup);

const LOW = "#0000ff";
const HIGH = "#ffffff";
const RAMP: SeriesPainting = { kind: "ramp", steps: (count) => rampColors(LOW, HIGH, count) };

describe("chartColors — the palette while Reduced Colors is off", () => {
  const colors = chartColors({ kind: "palette" }, 3);

  it("keeps each project's palette slot, past the board too", () => {
    expect([0, 1, 2, 3, 9].map(colors.project)).toEqual([0, 1, 2, 3, 9].map(seriesColor));
  });

  it("keeps the status and type colours", () => {
    expect(TASK_STATUSES.map(colors.status)).toEqual(TASK_STATUSES.map((status) => STATUS_COLOR[status]));
    expect([...TASK_TYPES, "untyped" as const].map(colors.type)).toEqual([...TASK_TYPES, "untyped" as const].map((type) => TYPE_COLOR[type]));
  });
});

describe("chartColors — ramp steps while Reduced Colors is on", () => {
  const colors = chartColors(RAMP, 10);

  it("gives every project on the board its step in board order, no muted ones past the eighth", () => {
    expect(Array.from({ length: 10 }, (_, index) => colors.project(index))).toEqual(rampColors(LOW, HIGH, 10));
  });

  it("draws a project that is no longer on the board muted", () => {
    expect(colors.project(10)).toBe("var(--muted-foreground)");
  });

  it("puts statuses on the ramp in work order, backlog low and done high", () => {
    expect(["backlog", "todo", "in_progress", "in_review", "done"].map((status) => colors.status(status as never))).toEqual(rampColors(LOW, HIGH, 5));
  });

  it("keeps canceled in its alarm red", () => {
    expect(colors.status("canceled")).toBe(STATUS_COLOR.canceled);
  });

  it("puts every task type on the ramp and keeps untyped neutral", () => {
    expect(TASK_TYPES.map(colors.type)).toEqual(rampColors(LOW, HIGH, TASK_TYPES.length));
    expect(colors.type("untyped")).toBe(TYPE_COLOR.untyped);
  });
});

function Probe() {
  const colors = useChartColors();
  return <output>{[colors.project(0), colors.project(1), colors.status("canceled")].join(" ")}</output>;
}

describe("ChartColorsScope", () => {
  it("hands the stored Reduced Colors to the charts under it", async () => {
    document.documentElement.style.colorScheme = "light";
    render(
      <ReducedColorsProvider load={async () => ({ enabled: true, light: { low: LOW, high: HIGH }, dark: { low: LOW, high: HIGH } })}>
        <ChartColorsScope boardProjects={2}>
          <Probe />
        </ChartColorsScope>
      </ReducedColorsProvider>,
    );
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe(`${LOW} ${HIGH} ${STATUS_COLOR.canceled}`);
  });

  it("keeps the palette without a scope", () => {
    render(<Probe />);
    expect(screen.getByRole("status").textContent).toBe(`${seriesColor(0)} ${seriesColor(1)} ${STATUS_COLOR.canceled}`);
  });
});

describe("chartColors — created against closed", () => {
  it("keeps muted created and green closed while Reduced Colors is off", () => {
    expect(chartColors({ kind: "palette" }, 0).createdClosed).toEqual({ created: "var(--muted-foreground)", closed: "var(--success)" });
  });

  it("paints created low and closed high while it is on", () => {
    expect(chartColors(RAMP, 0).createdClosed).toEqual({ created: LOW, closed: HIGH });
  });
});
