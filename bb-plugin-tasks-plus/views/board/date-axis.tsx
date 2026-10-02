// The dates written under a card's charts, as a row of labels on their
// moments — under a chart, or once along the card's bottom. A label slides
// from left-aligned at the start to right-aligned at the end, so none spills
// past the card's edge.
import { formatDay } from "../analytics/closed-model.js";
import type { DateTick } from "./date-ticks.js";

/** A date as the axis writes it: the time of day, or the day. */
export function dateLabel(tick: DateTick): string {
  return tick.withTime ? new Date(tick.ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : formatDay(tick.ms);
}

export function DateAxis({ ticks }: { ticks: readonly DateTick[] }) {
  if (ticks.length === 0) return null;
  return (
    <div aria-hidden data-date-axis className="relative h-3 text-[10px] leading-3 text-subtle-foreground tabular-nums">
      {ticks.map((tick) => (
        <span
          key={tick.ms}
          data-date-label
          className="absolute whitespace-nowrap"
          style={{ left: `${tick.at * 100}%`, transform: `translateX(-${tick.at * 100}%)` }}
        >
          {dateLabel(tick)}
        </span>
      ))}
    </div>
  );
}
