// The hybrid wrapper: Recharts holds the boring, bulky obligations — scales,
// axes, ticks, tooltip, the responsive box — while each bar is drawn by our own
// BarShape (rounded top, bb tint). Consumes the numbers the core already
// computed (TimeBin[] from binning.ts): this component never bins or sums.
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { TimeBin } from "../../packages/analytics-viz/core/binning";
import { BarShape } from "../../packages/analytics-viz/react/bar-shape";

export interface TimeBarChartProps {
  /** The core's output — one bar per bin, in time order. */
  bins: readonly TimeBin[];
  /** px; the bars fill this height. */
  height?: number;
  /**
   * px; when given, the chart is exactly this wide (fixed layout). When
   * omitted, it fills its parent via ResponsiveContainer — the normal on-page
   * case; pass an explicit width in tests, where jsdom lays nothing out.
   */
  width?: number;
  /** Per-bar fill; defaults to `currentColor` (tint via a text token on an ancestor). */
  color?: string;
  barRadiusPx?: number;
  /** Renders a bin's start (epoch ms) as an axis tick / tooltip label. */
  formatTime?: (startMs: number) => string;
  /** Renders a value as a Y tick / tooltip figure. */
  formatValue?: (value: number) => string;
}

const identityTime = (startMs: number) => String(startMs);
const identityValue = (value: number) => String(value);

export function TimeBarChart({
  bins,
  height = 96,
  width,
  color,
  barRadiusPx = 2,
  formatTime = identityTime,
  formatValue = identityValue,
}: TimeBarChartProps) {
  const data = bins.map((bin) => ({ startMs: bin.startMs, value: bin.value }));

  const chart = (
    <BarChart data={data} width={width} height={height} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
      <XAxis
        dataKey="startMs"
        type="number"
        domain={["dataMin", "dataMax"]}
        tickFormatter={formatTime}
        tick={{ fontSize: 10 }}
        interval="preserveStartEnd"
      />
      <YAxis tickFormatter={formatValue} tick={{ fontSize: 10 }} width={40} />
      <Tooltip
        labelFormatter={(startMs: number) => formatTime(startMs)}
        formatter={(value: number) => formatValue(value)}
      />
      {/* An element, not a render fn: Recharts clones it with each bar's
          computed x/y/width/height, which BarShape reads. */}
      <Bar dataKey="value" isAnimationActive={false} shape={<BarShape color={color} radius={barRadiusPx} />} />
    </BarChart>
  );

  if (width !== undefined) return chart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chart}
    </ResponsiveContainer>
  );
}
