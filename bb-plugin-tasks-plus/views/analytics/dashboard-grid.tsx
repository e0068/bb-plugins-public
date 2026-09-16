// The dashboard shell: react-grid-layout places the sections, this maps the
// pure model (layout/dashboard-layout.ts) onto it and folds every drag/resize
// back through applyGridLayout. The shell is domain-neutral — it never knows
// what a section shows; the consumer's `renderSection` turns a section's `kind`
// into a widget. Add/remove happen by the consumer handing back a new config
// (addSection/removeSection), so this component stays a pure projection of it.
import type { ReactNode } from "react";
import GridLayout from "react-grid-layout";

import {
  applyGridLayout,
  type DashboardConfig,
  type DashboardSection,
  type GridLayoutItem,
} from "./dashboard-layout";

export interface DashboardGridProps {
  config: DashboardConfig;
  /** px; react-grid-layout needs an explicit width (it lays out against it). */
  width: number;
  /** Grid column count. */
  cols?: number;
  /** px height of one grid row. */
  rowHeight?: number;
  /** Turns a section into its widget body — the consumer maps `kind`/`settings`. */
  renderSection: (section: DashboardSection) => ReactNode;
  /** The next config after any drag/resize; omit for a read-only dashboard. */
  onChange?: (next: DashboardConfig) => void;
  isDraggable?: boolean;
  isResizable?: boolean;
  className?: string;
}

export function DashboardGrid({
  config,
  width,
  cols = 12,
  rowHeight = 40,
  renderSection,
  onChange,
  isDraggable = true,
  isResizable = true,
  className,
}: DashboardGridProps) {
  const layout = config.sections.map((s) => ({ i: s.id, x: s.x, y: s.y, w: s.w, h: s.h }));

  return (
    <GridLayout
      className={className}
      layout={layout}
      cols={cols}
      rowHeight={rowHeight}
      width={width}
      isDraggable={isDraggable}
      isResizable={isResizable}
      onLayoutChange={(items) => onChange?.(applyGridLayout(config, items as GridLayoutItem[]))}
    >
      {config.sections.map((section) => (
        <div key={section.id} data-section-id={section.id}>
          {renderSection(section)}
        </div>
      ))}
    </GridLayout>
  );
}
