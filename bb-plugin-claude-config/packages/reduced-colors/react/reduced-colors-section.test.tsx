// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReducedColors } from "../core/settings";
import { ReducedColorsSection } from "./reduced-colors-section";

afterEach(cleanup);

const STORED: ReducedColors = {
  enabled: false,
  light: { low: "#1d4ed8", high: "#bfdbfe" },
  dark: { low: "#2563eb", high: "#dbeafe" },
};

async function mount(stored: unknown = STORED) {
  const save = vi.fn(async (_value: ReducedColors) => undefined);
  render(<ReducedColorsSection load={async () => stored} save={save} />);
  await act(async () => {});
  return save;
}

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("ReducedColorsSection", () => {
  it("shows the stored colours of both themes", async () => {
    await mount();
    expect(field("Light theme low colour").value).toBe("#1d4ed8");
    expect(field("Light theme high colour").value).toBe("#bfdbfe");
    expect(field("Dark theme low colour").value).toBe("#2563eb");
    expect(field("Dark theme high colour").value).toBe("#dbeafe");
    expect(screen.getByRole("switch", { name: "Use Reduced Colors" }).getAttribute("aria-checked")).toBe("false");
  });

  it("shows the defaults when nothing is stored yet", async () => {
    await mount(undefined);
    expect(field("Light theme low colour").value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("saves the mode switched on", async () => {
    const save = await mount();
    fireEvent.click(screen.getByRole("switch", { name: "Use Reduced Colors" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...STORED, enabled: true }));
  });

  it("saves a typed colour", async () => {
    const save = await mount();
    fireEvent.change(field("Dark theme high colour"), { target: { value: "#ffffff" } });
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...STORED, dark: { low: "#2563eb", high: "#ffffff" } }));
  });

  it("does not save a colour that is not a hex colour", async () => {
    const save = await mount();
    fireEvent.change(field("Dark theme high colour"), { target: { value: "#ffff" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(save).not.toHaveBeenCalled();
    expect(field("Dark theme high colour").getAttribute("aria-invalid")).toBe("true");
  });

  it("swaps a theme's low and high colours", async () => {
    const save = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Swap light theme colours" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...STORED, light: { low: "#bfdbfe", high: "#1d4ed8" } }));
  });

  it("saves only the last of quick successive edits", async () => {
    const save = await mount();
    fireEvent.change(field("Light theme low colour"), { target: { value: "#000001" } });
    fireEvent.change(field("Light theme low colour"), { target: { value: "#000002" } });
    fireEvent.change(field("Light theme low colour"), { target: { value: "#000003" } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenLastCalledWith({ ...STORED, light: { low: "#000003", high: "#bfdbfe" } });
  });
});

describe("ReducedColorsSection — nothing is lost or faked", () => {
  it("saves an edit made just before the section goes away", async () => {
    const save = vi.fn(async (_value: ReducedColors) => undefined);
    const { unmount } = render(<ReducedColorsSection load={async () => STORED} save={save} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch", { name: "Use Reduced Colors" }));
    unmount();
    expect(save).toHaveBeenCalledWith({ ...STORED, enabled: true });
  });

  it("saves nothing when it goes away untouched", async () => {
    const save = vi.fn(async (_value: ReducedColors) => undefined);
    const { unmount } = render(<ReducedColorsSection load={async () => STORED} save={save} />);
    await act(async () => {});
    unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it("says so and offers nothing to edit when the stored value cannot be read", async () => {
    render(<ReducedColorsSection load={() => Promise.reject(new Error("offline"))} save={async () => undefined} />);
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("says so when saving fails", async () => {
    render(<ReducedColorsSection load={async () => STORED} save={() => Promise.reject(new Error("disk full"))} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch", { name: "Use Reduced Colors" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not save/i);
  });
});
