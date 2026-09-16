// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildUsageWindowModel, formatAbsoluteReset, type UsageWindowModel } from "./usage-model";
import { buildProviderLogo, buildRingIcon, buildWindowRow } from "./render";

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
    expect(row.querySelector(".usage-circles__window-reset")?.textContent).toBe("No reset data available");
  });

  it("shows the relative and absolute reset time when known", () => {
    const resetsAt = new Date(now + 61 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "5-hour limit", usedPercent: 0, resetsAt }, now);
    const row = buildWindowRow(model);
    expect(row.querySelector(".usage-circles__window-reset")?.textContent).toBe(`Resets in 1h 1m (${formatAbsoluteReset(resetsAt)})`);
  });
});

describe("bar geometry in the expanded panel", () => {
  it("gives the usage bar the same height and track color as the time bar", () => {
    const resetsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "Current session", usedPercent: 13, resetsAt }, now);
    const row = buildWindowRow(model);

    const usageTrack = row.querySelector<HTMLElement>(".usage-circles__bar-track");
    const timeTrack = row.querySelector<HTMLElement>(".usage-circles__bar-time-track");
    expect(usageTrack?.style.height).toBe(timeTrack?.style.height);
    expect(usageTrack?.style.backgroundColor).toBe(timeTrack?.style.backgroundColor);
  });

  it("gives the weekly usage bar the same track color as its day segments", () => {
    const resetsAt = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 3, resetsAt }, now);
    const row = buildWindowRow(model);

    const usageTrack = row.querySelector<HTMLElement>(".usage-circles__bar-track");
    const segment = row.querySelector<HTMLElement>(".usage-circles__bar-time-segment");
    expect(usageTrack?.style.backgroundColor).toBe(segment?.style.backgroundColor);
  });

  it("fills the running day segment partially instead of jumping a whole day", () => {
    const resetsAt = new Date(now + 3.5 * 24 * 60 * 60 * 1000).toISOString(); // 3.5/7 elapsed
    const model = buildUsageWindowModel({ label: "Weekly limit", usedPercent: 3, resetsAt }, now);
    const row = buildWindowRow(model);

    const fills = Array.from(row.querySelectorAll<HTMLElement>(".usage-circles__bar-time-segment-fill"));
    expect(fills.map((fill) => fill.style.width)).toEqual(["100%", "100%", "100%", "50%", "0%", "0%", "0%"]);
  });
});

// ---------------------------------------------------------------------------
// Provider logos and the pace mode's "unknown" state.

const CLAUDE = { title: "Claude Code", logoUrl: "/api/v1/system/providers/claude-code/logo?h=1", tint: { light: "#D97757", dark: "#D97757" } };
const CODEX = { title: "Codex", logoUrl: "/api/v1/system/providers/codex/logo?h=2", tint: null };

/** A window model whose tier is set directly, independent of the coloring rule. */
function modelWithTier(tier: UsageWindowModel["tier"], label = "Current session"): UsageWindowModel {
  const resetsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
  return { ...buildUsageWindowModel({ label, usedPercent: 40, resetsAt }, now), tier };
}

describe("buildProviderLogo", () => {
  it("labels the logo with the provider title as an image", () => {
    const logo = buildProviderLogo(CODEX, 14);
    expect(logo.getAttribute("role")).toBe("img");
    expect(logo.getAttribute("aria-label")).toBe("Codex");
  });

  it("sizes the logo square to the requested pixels", () => {
    const logo = buildProviderLogo(CODEX, 16);
    expect(logo.style.width).toBe("16px");
    expect(logo.style.height).toBe("16px");
  });

  it("masks the host logo url and records it on the element", () => {
    const logo = buildProviderLogo(CLAUDE, 14);
    expect(logo.dataset.logoUrl).toBe(CLAUDE.logoUrl);
  });

  it("paints a tinted provider with light-dark of its tint", () => {
    expect(buildProviderLogo(CLAUDE, 14).dataset.tint).toBe("light-dark(#D97757, #D97757)");
  });

  it("leaves an untinted provider in the current text color", () => {
    expect(buildProviderLogo(CODEX, 14).dataset.tint).toBeUndefined();
  });
});

describe("buildRingIcon, unknown pace", () => {
  it("draws a question mark instead of the time ring when the pace is unknown", () => {
    for (const label of ["Current session", "Weekly limit"]) {
      const svg = buildRingIcon(modelWithTier("unknown", label));
      expect(svg.querySelector("text")?.textContent).toBe("?");
      expect(svg.querySelectorAll(".usage-circles__ring-time, .usage-circles__ring-time-track")).toHaveLength(0);
    }
  });

  it("paints an unknown usage arc in the foreground color at its usual length", () => {
    const known = buildRingIcon(modelWithTier("blue")).querySelector(".usage-circles__ring-usage")!;
    const unknown = buildRingIcon(modelWithTier("unknown")).querySelector(".usage-circles__ring-usage")!;
    expect(unknown.getAttribute("stroke")).toBe("var(--foreground)");
    expect(unknown.getAttribute("stroke-dasharray")).toBe(known.getAttribute("stroke-dasharray"));
  });

  it("draws no question mark for a known tier", () => {
    for (const tier of ["blue", "yellow", "red"] as const) {
      expect(buildRingIcon(modelWithTier(tier)).querySelector("text")).toBeNull();
    }
  });
});

describe("buildWindowRow, unknown pace", () => {
  it("fills the usage bar in the foreground color when the pace is unknown", () => {
    const fill = buildWindowRow(modelWithTier("unknown")).querySelector<HTMLElement>(".usage-circles__bar-fill")!;
    expect(fill.dataset.tier).toBe("unknown");
    expect(fill.style.backgroundColor).toBe("var(--foreground)");
  });
});
