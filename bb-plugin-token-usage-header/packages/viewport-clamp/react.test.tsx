// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VIEWPORT_MARGIN_PX, type Point } from "./core";
import { useViewportClamp } from "./react";

const TIP = { width: 200, height: 120 };

function Tip({ at }: { at: Point | null }) {
  const { ref, position } = useViewportClamp<HTMLDivElement>(at);
  return position === null ? null : (
    <div ref={ref} role="tooltip" style={{ position: "fixed", left: position.x, top: position.y }} />
  );
}

function withViewport(width: number, height: number) {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...TIP,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: TIP.width,
    bottom: TIP.height,
    toJSON: () => ({}),
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useViewportClamp", () => {
  it("moves a tooltip at the bottom-right corner inside the window, a margin from the edges", () => {
    withViewport(1000, 800);
    const { getByRole } = render(<Tip at={{ x: 990, y: 790 }} />);
    const tip = getByRole("tooltip");
    expect(tip.style.left).toBe(`${1000 - TIP.width - VIEWPORT_MARGIN_PX}px`);
    expect(tip.style.top).toBe(`${800 - TIP.height - VIEWPORT_MARGIN_PX}px`);
  });

  it("leaves a tooltip in the middle of the window where the pointer put it", () => {
    withViewport(1000, 800);
    const { getByRole } = render(<Tip at={{ x: 300, y: 200 }} />);
    const tip = getByRole("tooltip");
    expect(tip.style.left).toBe("300px");
    expect(tip.style.top).toBe("200px");
  });

  it("follows the pointer to a new spot", () => {
    withViewport(1000, 800);
    const { getByRole, rerender } = render(<Tip at={{ x: 300, y: 200 }} />);
    rerender(<Tip at={{ x: 995, y: 200 }} />);
    expect(getByRole("tooltip").style.left).toBe(`${1000 - TIP.width - VIEWPORT_MARGIN_PX}px`);
  });

  it("re-measures the tooltip when its content grows", () => {
    withViewport(1000, 800);
    const { getByRole, rerender } = render(<Tip at={{ x: 700, y: 200 }} />);
    expect(getByRole("tooltip").style.left).toBe("700px");
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      width: 400, height: TIP.height, x: 0, y: 0, top: 0, left: 0, right: 400, bottom: TIP.height, toJSON: () => ({}),
    });
    rerender(<Tip at={{ x: 700, y: 200 }} />);
    expect(getByRole("tooltip").style.left).toBe(`${1000 - 400 - VIEWPORT_MARGIN_PX}px`);
  });

  it("renders nothing while there is no pointer", () => {
    withViewport(1000, 800);
    const { queryByRole } = render(<Tip at={null} />);
    expect(queryByRole("tooltip")).toBeNull();
  });
});
