// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishUsage } from "./footer-items";
import { LimitsSettings } from "./limits-settings";
import { DEFAULT_RING_STYLE } from "./ring-style";
import { DEFAULT_COLORING, DEFAULT_LIMITS, FOOTER_RINGS, type LimitsChoice, type StateWire } from "./usage-model";

const STATE: StateWire = { openOnHover: true, coloring: DEFAULT_COLORING, providers: [], ring: DEFAULT_RING_STYLE, layout: "all", limits: DEFAULT_LIMITS };

afterEach(() => {
  cleanup();
  act(() => publishUsage(null));
});

const show = () => {
  const save = vi.fn(async (limits: LimitsChoice) => limits);
  const view = render(<LimitsSettings save={save} />);
  act(() => publishUsage(STATE));
  const names = () => Array.from(view.container.querySelectorAll("[data-limit-row]")).map((row) => row.getAttribute("data-limit-row"));
  return { view, save, names };
};

describe("the Limits section", () => {
  it("lists every limit in the chosen order, each with a switch that says whether it shows", () => {
    const { view, names } = show();
    expect(names()).toEqual(FOOTER_RINGS.map(({ id }) => id));
    expect(view.getAllByRole("switch").map((toggle) => toggle.getAttribute("aria-checked"))).toEqual(FOOTER_RINGS.map(() => "true"));
  });

  it("hides a limit with its switch and keeps the choice", () => {
    const { view, save } = show();
    fireEvent.click(view.getByRole("switch", { name: "Show Claude Code — Fable weekly limit" }));
    expect(save).toHaveBeenLastCalledWith(DEFAULT_LIMITS.map((limit) => (limit.id === "claude-fable" ? { ...limit, shown: false } : limit)));
    expect(view.getByRole("switch", { name: "Show Claude Code — Fable weekly limit" }).getAttribute("aria-checked")).toBe("false");
  });

  it("moves a limit up and down, and has no way past the ends", () => {
    const { view, save, names } = show();
    fireEvent.click(view.getByRole("button", { name: "Move Codex — 5-hour limit up" }));
    expect(names().slice(2, 4)).toEqual(["codex-session", "claude-fable"]);
    expect(save.mock.lastCall![0].map(({ id }) => id).slice(2, 4)).toEqual(["codex-session", "claude-fable"]);
    fireEvent.click(view.getByRole("button", { name: "Move Codex — 5-hour limit down" }));
    expect(names()).toEqual(FOOTER_RINGS.map(({ id }) => id));
    expect((view.getByRole("button", { name: "Move Claude Code — 5-hour limit up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "Move Codex — weekly limit down" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when the choice could not be kept", async () => {
    const save = vi.fn(async () => Promise.reject(new Error("offline")));
    const view = render(<LimitsSettings save={save} />);
    act(() => publishUsage(STATE));
    await act(async () => void fireEvent.click(view.getAllByRole("switch")[0]!));
    expect(view.container.textContent).toContain("Couldn't save");
  });
});
