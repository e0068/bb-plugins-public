// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newTile } from "./default-dashboard";
import { TileCard } from "./tile-card";

window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

describe("TileCard's three dots", () => {
  it("stand in the header right after the title, not in the card's corner", () => {
    render(
      <TileCard
        tile={newTile("t", { title: "Burndown", switch: null })}
        answer={undefined}
        error={null}
        edges={[0, 1]}
        unit="day"
        nowMs={1}
        picked={null}
        editing={false}
        onPick={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );
    const title = screen.getByRole("heading", { name: "Burndown" });
    const dots = screen.getByRole("button", { name: "Chart actions" });
    expect(dots.closest("header")).not.toBeNull();
    expect(title.compareDocumentPosition(dots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.parentElement?.contains(dots)).toBe(true);
    expect(dots.className).not.toMatch(/\babsolute\b/);
  });
});
