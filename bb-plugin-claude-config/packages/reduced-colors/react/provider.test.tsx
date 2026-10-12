// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { rampColors } from "../core/ramp";
import type { ReducedColors } from "../core/settings";
import { ReducedColorsProvider, useSeriesColors, useSeriesPainting } from "./provider";

afterEach(() => {
  cleanup();
  document.documentElement.style.colorScheme = "";
});

const PALETTE = ["#3b82f6", "#22c55e", "#f59e0b"];
const ON: ReducedColors = {
  enabled: true,
  light: { low: "#000000", high: "#222222" },
  dark: { low: "#dddddd", high: "#ffffff" },
};

function Probe() {
  return <output>{useSeriesColors(PALETTE).join(" ")}</output>;
}

const shown = () => screen.getByRole("status").textContent;

async function mount(load: () => Promise<unknown>) {
  render(
    <ReducedColorsProvider load={load}>
      <Probe />
    </ReducedColorsProvider>,
  );
  await act(async () => {});
}

describe("useSeriesColors", () => {
  it("returns the palette as it is without a provider", () => {
    render(<Probe />);
    expect(shown()).toBe(PALETTE.join(" "));
  });

  it("returns the palette as it is while the stored mode is off", async () => {
    await mount(async () => ({ ...ON, enabled: false }));
    expect(shown()).toBe(PALETTE.join(" "));
  });

  it("keeps the palette when loading fails", async () => {
    await mount(() => Promise.reject(new Error("offline")));
    expect(shown()).toBe(PALETTE.join(" "));
  });

  it("paints the light pair's steps in the light theme", async () => {
    document.documentElement.style.colorScheme = "light";
    await mount(async () => ON);
    expect(shown()).toBe(rampColors("#000000", "#222222", 3).join(" "));
  });

  it("paints the dark pair's steps in the dark theme", async () => {
    document.documentElement.style.colorScheme = "dark";
    await mount(async () => ON);
    expect(shown()).toBe(rampColors("#dddddd", "#ffffff", 3).join(" "));
  });

  it("follows a theme switch of the host", async () => {
    document.documentElement.style.colorScheme = "light";
    await mount(async () => ON);
    await act(async () => {
      document.documentElement.style.colorScheme = "dark";
    });
    expect(shown()).toBe(rampColors("#dddddd", "#ffffff", 3).join(" "));
  });
});

function PaintingProbe() {
  const painting = useSeriesPainting();
  return <output>{painting.kind === "ramp" ? painting.steps(2).join(" ") : "palette"}</output>;
}

describe("useSeriesPainting", () => {
  it("says palette without a provider", () => {
    render(<PaintingProbe />);
    expect(shown()).toBe("palette");
  });

  it("hands out the host theme's ramp while the mode is on", async () => {
    document.documentElement.style.colorScheme = "dark";
    render(
      <ReducedColorsProvider load={async () => ON}>
        <PaintingProbe />
      </ReducedColorsProvider>,
    );
    await act(async () => {});
    expect(shown()).toBe("#dddddd #ffffff");
  });
});
