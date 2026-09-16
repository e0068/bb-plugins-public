// The custom <Bar shape> of the hybrid. Recharts positions the bar (it passes
// x/y/width/height computed from its own scales) and this draws it — a single
// rounded-top <path> whose colour defaults to `currentColor`, so a consumer
// tints it with a bb token class (e.g. `text-primary/70`) on any ancestor and
// the package stays free of specific token names. A per-series colour can still
// be passed explicitly (the DEFAULT_PALETTE case).
import type { ReactElement } from "react";

import { roundedTopBarPath } from "./bar-geometry";

/**
 * Props Recharts hands a bar's `shape`, plus this package's styling knobs.
 * x/y/width/height are optional because Recharts types them so; a bar with no
 * height (a zero datum) renders nothing.
 */
export interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Top-corner radius in px; clamped to what fits (see roundedTopBarPath). */
  radius?: number;
  /** Fill colour; defaults to `currentColor` so an ancestor's text token colours it. */
  color?: string;
  /** Recharts passes the Bar's own `fill` here; used only when `color` is absent. */
  fill?: string;
  fillOpacity?: number;
  className?: string;
}

export function BarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  radius = 2,
  color,
  fill,
  fillOpacity = 0.7,
  className,
}: BarShapeProps): ReactElement | null {
  const d = roundedTopBarPath(x, y, width, height, radius);
  if (!d) return null;
  // A stable marker so a test can count our bars apart from Recharts' own axis
  // paths without pinning to a styling default like fillOpacity.
  return (
    <path data-bb-bar="" d={d} fill={color ?? fill ?? "currentColor"} fillOpacity={fillOpacity} className={className} />
  );
}
