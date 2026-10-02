// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rampColors, ReducedColorsProvider, type SeriesPainting } from "@bb-plugins/reduced-colors";

import { TASK_STATUSES, TASK_TYPES } from "../../db/types.js";
import { chartColors, ChartColorsScope, useChartColors, type ChartBoard } from "./chart-colors";
import { seriesColor } from "./closed-model";
import { STATUS_COLOR, TYPE_COLOR } from "./palette";

afterEach(cleanup);

const LOW = "#0000ff";
const HIGH = "#ffffff";
const RAMP: SeriesPainting = { kind: "ramp", steps: (count) => rampColors(LOW, HIGH, count) };
const MUTED = "var(--muted-foreground)";

/** A board of `count` projects, p0…, each in its own named colour c0…. */
const boardOf = (count: number, reducedProjects: ChartBoard["reducedProjects"] = "ramp"): ChartBoard => ({
  projects: Array.from({ length: count }, (_, index) => ({ id: `p${index}`, color: `c${index}` })),
  reducedProjects,
});

describe("chartColors — the projects' own colours while Reduced Colors is off", () => {
  const colors = chartColors({ kind: "palette" }, boardOf(3));

  it("paints each project with the colour set on it", () => {
    expect(["p0", "p1", "p2"].map(colors.project)).toEqual(["c0", "c1", "c2"]);
  });

  it("draws a project the board no longer lists muted", () => {
    expect(colors.project("gone")).toBe(MUTED);
  });

  it("paints any other field's series by its place in the palette", () => {
    expect([0, 1, 2, 3, 9].map(colors.byPlace)).toEqual([0, 1, 2, 3, 9].map(seriesColor));
  });

  it("keeps the status and type colours", () => {
    expect(TASK_STATUSES.map(colors.status)).toEqual(TASK_STATUSES.map((status) => STATUS_COLOR[status]));
    expect([...TASK_TYPES, "untyped" as const].map(colors.type)).toEqual([...TASK_TYPES, "untyped" as const].map((type) => TYPE_COLOR[type]));
  });
});

describe("chartColors — Reduced Colors on, repainting the projects", () => {
  const colors = chartColors(RAMP, boardOf(10));

  it("gives every project on the board its step in board order, no muted ones past the eighth", () => {
    expect(Array.from({ length: 10 }, (_, index) => colors.project(`p${index}`))).toEqual(rampColors(LOW, HIGH, 10));
  });

  it("draws a project that is no longer on the board muted", () => {
    expect(colors.project("gone")).toBe(MUTED);
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

describe("chartColors — Reduced Colors on, the projects keeping their own colours", () => {
  const colors = chartColors(RAMP, boardOf(3, "own"));

  it("paints each project with the colour set on it", () => {
    expect(["p0", "p1", "p2"].map(colors.project)).toEqual(["c0", "c1", "c2"]);
  });

  it("still puts statuses on the ramp", () => {
    expect(colors.status("backlog")).toBe(LOW);
    expect(colors.status("done")).toBe(HIGH);
  });
});

function Probe() {
  const colors = useChartColors();
  return <output>{[colors.project("p0"), colors.project("p1"), colors.status("canceled")].join(" ")}</output>;
}

describe("ChartColorsScope", () => {
  it("hands the stored Reduced Colors to the charts under it", async () => {
    document.documentElement.style.colorScheme = "light";
    render(
      <ReducedColorsProvider load={async () => ({ enabled: true, light: { low: LOW, high: HIGH }, dark: { low: LOW, high: HIGH } })}>
        <ChartColorsScope board={boardOf(2)}>
          <Probe />
        </ChartColorsScope>
      </ReducedColorsProvider>,
    );
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe(`${LOW} ${HIGH} ${STATUS_COLOR.canceled}`);
  });

  it("paints the board's own colours while Reduced Colors is off", () => {
    render(
      <ChartColorsScope board={boardOf(2)}>
        <Probe />
      </ChartColorsScope>,
    );
    expect(screen.getByRole("status").textContent).toBe(`c0 c1 ${STATUS_COLOR.canceled}`);
  });

  it("draws projects muted without a scope — no board, no colours", () => {
    render(<Probe />);
    expect(screen.getByRole("status").textContent).toBe(`${MUTED} ${MUTED} ${STATUS_COLOR.canceled}`);
  });
});

describe("chartColors — created against closed", () => {
  it("keeps muted created and green closed while Reduced Colors is off", () => {
    expect(chartColors({ kind: "palette" }, boardOf(0)).createdClosed).toEqual({ created: MUTED, closed: "var(--success)" });
  });

  it("paints created low and closed high while it is on", () => {
    expect(chartColors(RAMP, boardOf(0)).createdClosed).toEqual({ created: LOW, closed: HIGH });
  });
});
