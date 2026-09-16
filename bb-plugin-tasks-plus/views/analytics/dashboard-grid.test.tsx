// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addSection, type DashboardConfig, emptyDashboard, removeSection } from "./dashboard-layout";
import { DashboardGrid } from "./dashboard-grid";

afterEach(cleanup);

function section(id: string, kind: string) {
  return { id, kind, x: 0, y: 0, w: 3, h: 2, settings: {} };
}

const twoSections: DashboardConfig = addSection(
  addSection(emptyDashboard(), section("velocity", "bar")),
  section("throughput", "bar"),
);

describe("DashboardGrid", () => {
  it("renders one container per section, mapped through renderSection by kind", () => {
    const { container } = render(
      <DashboardGrid
        config={twoSections}
        width={600}
        renderSection={(s) => <span data-testid={`body-${s.id}`}>{s.kind}</span>}
      />,
    );
    const cells = container.querySelectorAll("[data-section-id]");
    expect(cells.length).toBe(2);
    expect(container.querySelector('[data-section-id="velocity"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="body-"]').length).toBe(2);
  });

  it("reflects a removed section on the next render — the shell is a projection of the config", () => {
    const { container, rerender } = render(
      <DashboardGrid config={twoSections} width={600} renderSection={(s) => <span>{s.kind}</span>} />,
    );
    expect(container.querySelectorAll("[data-section-id]").length).toBe(2);

    rerender(
      <DashboardGrid
        config={removeSection(twoSections, "velocity")}
        width={600}
        renderSection={(s) => <span>{s.kind}</span>}
      />,
    );
    const remaining = container.querySelectorAll("[data-section-id]");
    expect(remaining.length).toBe(1);
    expect(container.querySelector('[data-section-id="throughput"]')).not.toBeNull();
  });

  it("folds a layout change back through the model to onChange", () => {
    const onChange = vi.fn();
    render(
      <DashboardGrid
        config={twoSections}
        width={600}
        onChange={onChange}
        renderSection={(s) => <span>{s.kind}</span>}
      />,
    );
    // react-grid-layout emits an onLayoutChange as it mounts; whatever it emits,
    // the shell must hand onChange a well-formed config with the same sections.
    expect(onChange).toHaveBeenCalled();
    const next: DashboardConfig = onChange.mock.calls[0][0];
    expect(next.version).toBe(1);
    expect(next.sections.map((s) => s.id).sort()).toEqual(["throughput", "velocity"]);
  });
});
