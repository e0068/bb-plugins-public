// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRingStyle, publishRingStyle } from "./footer-items";
import { RingSettings } from "./ring-settings";
import { DEFAULT_RING_DIMS, DEFAULT_RING_STYLE, type RingDims } from "./ring-style";

afterEach(() => {
  cleanup();
  act(() => publishRingStyle(DEFAULT_RING_STYLE));
});

const show = (overrides: Partial<{ save: (patch: Partial<RingDims>) => Promise<RingDims>; reset: () => Promise<RingDims> }> = {}) => {
  const save = vi.fn(overrides.save ?? (async (patch: Partial<RingDims>) => ({ ...getRingStyle().dims, ...patch })));
  const reset = vi.fn(overrides.reset ?? (async () => DEFAULT_RING_DIMS));
  const view = render(<RingSettings save={save} reset={reset} />);
  return { view, save, reset };
};
const unfold = (view: ReturnType<typeof render>) => fireEvent.click(view.getByRole("button", { name: "Fine-tune ring" }));
const previewBox = (view: ReturnType<typeof render>) => view.container.querySelector("[data-ring-preview] svg")?.getAttribute("viewBox");

describe("ring settings", () => {
  it("shows the five footer rings in the current style", () => {
    const { view } = show();
    expect(view.container.querySelectorAll("[data-ring-preview] svg.usage-circles__ring")).toHaveLength(5);
  });

  it("keeps the sliders folded until asked, then shows the ring sliders and the center logo's", () => {
    const { view } = show();
    expect(view.queryAllByRole("slider")).toHaveLength(0);
    unfold(view);
    expect(view.getAllByRole("slider")).toHaveLength(7);
    expect(view.getByText("Logo in the center")).toBeTruthy();
  });

  it("shows the corner logo's sliders when the logo sits in the corner", () => {
    act(() => publishRingStyle({ logo: "corner", dims: DEFAULT_RING_DIMS }));
    const { view } = show();
    unfold(view);
    expect(view.getAllByRole("slider")).toHaveLength(10);
    expect(view.getByText("Logo in the corner")).toBeTruthy();
  });

  it("redraws the rings as a slider moves and stores only that value once it is let go", async () => {
    const { view, save } = show();
    unfold(view);
    fireEvent.keyDown(view.getAllByRole("slider")[0]!, { key: "ArrowRight" });
    expect(previewBox(view)).toBe("0 0 29 29");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ size: 29 }));
    expect(getRingStyle().dims.size).toBe(29);
  });

  it("puts the defaults back on reset", async () => {
    act(() => publishRingStyle({ logo: "center", dims: { ...DEFAULT_RING_DIMS, size: 20 } }));
    const { view, reset } = show();
    unfold(view);
    fireEvent.click(view.getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(getRingStyle().dims).toEqual(DEFAULT_RING_DIMS));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("says so when a value could not be stored", async () => {
    const { view } = show({
      save: async () => {
        throw new Error("offline");
      },
    });
    unfold(view);
    fireEvent.keyDown(view.getAllByRole("slider")[0]!, { key: "ArrowRight" });
    expect(await view.findByText("Couldn't save — the rings go back to the stored look on the next refresh.")).toBeTruthy();
  });
});
