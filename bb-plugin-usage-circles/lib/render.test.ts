// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildUsageWindowModel, formatAbsoluteReset } from "./usage-model";
import { buildRingIcon, buildWindowRow } from "./render";

const now = Date.parse("2026-08-21T12:00:00Z");

describe("buildRingIcon", () => {
  it("draws a single continuous inner arc for an hour-cycle window", () => {
    const resetsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 31, resetsAt }, now);
    const svg = buildRingIcon(model);

    expect(svg.querySelectorAll(".usage-circles__ring-time-track").length).toBe(1);
    expect(svg.querySelectorAll(".usage-circles__ring-time").length).toBe(1);
    expect(svg.dataset.tier).toBe("blue");
  });

  it("draws seven day slots for a weekly window, only the elapsed ones colored", () => {
    const resetsAt = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(); // 4/7 elapsed
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 80, resetsAt }, now);
    const svg = buildRingIcon(model);

    expect(svg.querySelectorAll(".usage-circles__ring-time-track").length).toBe(7);
    expect(svg.querySelectorAll(".usage-circles__ring-time").length).toBe(4);
    expect(svg.dataset.tier).toBe("yellow");
  });

  it("draws zero elapsed slots when resetsAt is unknown", () => {
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 0, resetsAt: null }, now);
    const svg = buildRingIcon(model);

    expect(svg.querySelectorAll(".usage-circles__ring-time-track").length).toBe(7);
    expect(svg.querySelectorAll(".usage-circles__ring-time").length).toBe(0);
  });

  it("sets the outer usage arc's dasharray from usedPercent", () => {
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 0, resetsAt: null }, now);
    const svg = buildRingIcon(model);
    const outerArc = svg.querySelector(".usage-circles__ring-usage");
    expect(outerArc?.getAttribute("stroke-dasharray")).toMatch(/^0 /);
  });
});

describe("buildWindowRow", () => {
  it("shows the rounded percent and the usage fill width", () => {
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 31.4, resetsAt: null }, now);
    const row = buildWindowRow(model);

    expect(row.querySelector("strong")?.textContent).toBe("31%");
    const fill = row.querySelector<HTMLElement>(".usage-circles__bar-fill");
    expect(fill?.style.width).toBe("31.4%");
    expect(fill?.dataset.tier).toBe("blue");
  });

  it("renders a continuous time-fill for an hour-cycle window", () => {
    const resetsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 0, resetsAt }, now);
    const row = buildWindowRow(model);

    expect(row.querySelectorAll(".usage-circles__bar-time-segment").length).toBe(0);
    const fill = row.querySelector<HTMLElement>(".usage-circles__bar-time-fill");
    expect(fill?.style.width).toBe("60%");
  });

  it("renders seven day segments for a weekly window, elapsed ones flagged", () => {
    const resetsAt = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 80, resetsAt }, now);
    const row = buildWindowRow(model);

    const segments = row.querySelectorAll<HTMLElement>(".usage-circles__bar-time-segment");
    expect(segments.length).toBe(7);
    expect(Array.from(segments).map((s) => s.dataset.elapsed)).toEqual(["true", "true", "true", "true", "false", "false", "false"]);
  });

  it("says there is no reset data when resetsAt is null", () => {
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 0, resetsAt: null }, now);
    const row = buildWindowRow(model);
    expect(row.querySelector(".usage-circles__window-reset")?.textContent).toBe("Нет данных о сбросе");
  });

  it("shows the relative and absolute reset time when known", () => {
    const resetsAt = new Date(now + 61 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 0, resetsAt }, now);
    const row = buildWindowRow(model);
    expect(row.querySelector(".usage-circles__window-reset")?.textContent).toBe(`Сброс через 1ч 1мин (${formatAbsoluteReset(resetsAt)})`);
  });
});
