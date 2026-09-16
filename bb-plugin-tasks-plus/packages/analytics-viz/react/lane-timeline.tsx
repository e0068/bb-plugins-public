// The custom-SVG half of the hybrid: one horizontal lane of contiguous,
// weight-proportional segments — the shape Recharts can't express with the
// per-segment pixel gaps and rounding thread-chart.tsx wanted. Positions come
// from the pure laneSegments geometry; this only maps them to <rect>s.
import type { CSSProperties } from "react";

import { laneSegments } from "./lane-geometry";

/** One segment of the lane: its weight and how to colour/label it. */
export interface LaneItem {
  key: string;
  weight: number;
  /** Segment fill; defaults to `currentColor` (tint via a text token on an ancestor). */
  color?: string;
  /** Accessible label for the segment (title tooltip). */
  label?: string;
}

export interface LaneTimelineProps {
  items: readonly LaneItem[];
  width: number;
  height: number;
  /** px between adjacent segments. */
  gapPx?: number;
  /** Corner radius of each segment. */
  radiusPx?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the whole lane. */
  ariaLabel?: string;
}

export function LaneTimeline({
  items,
  width,
  height,
  gapPx = 1,
  radiusPx = 1,
  className,
  style,
  ariaLabel,
}: LaneTimelineProps) {
  const segments = laneSegments(
    items.map((item) => item.weight),
    width,
    gapPx,
  );

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={style}
    >
      {segments.map((segment, index) => {
        if (segment.width <= 0) return null;
        const item = items[index];
        return (
          <rect
            key={item.key}
            x={segment.x}
            y={0}
            width={segment.width}
            height={height}
            rx={radiusPx}
            fill={item.color ?? "currentColor"}
          >
            {item.label ? <title>{item.label}</title> : null}
          </rect>
        );
      })}
    </svg>
  );
}
