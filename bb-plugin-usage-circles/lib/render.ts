// Layer 2 — rendering. Turns one usage-window model into DOM, in two forms
// off the same data: buildRingIcon (the two-concentric-ring SVG for the
// sidebar strip) and buildWindowRow (the two stacked bars for the expanded
// panel). Pure DOM construction, no plugin/SDK imports — testable with jsdom
// alone.
//
// Colors are plain inline styles, not Tailwind utility classes: `bb plugin
// build` only extracts Tailwind classes referenced from .tsx source (the
// app's JSX entry and its imported components), never from plain .ts files —
// this plugin has no JSX at all, so classes like "stroke-blue-500" used here
// previously compiled to nothing and the widget rendered invisible.
import type { UsageWindowModel } from "./usage-model";

const SVG_NS = "http://www.w3.org/2000/svg";
const SIZE = 20;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 8.5;
const INNER_RADIUS = 5.5;
const OUTER_WIDTH = 2.4;
const INNER_WIDTH = 1.6;
const SEGMENT_GAP_RATIO = 0.16;

const TRACK_COLOR = "var(--border)";
const TIME_ELAPSED_COLOR = "var(--muted-foreground)";
// The theme's default blue/amber scale for the two lighter tiers, the
// semantic `destructive` token for red — matches how the rest of the app
// already marks danger states.
const TIER_COLOR: Record<UsageWindowModel["tier"], string> = {
  blue: "var(--color-blue-500)",
  yellow: "var(--color-amber-500)",
  red: "var(--destructive)",
};

function circle(radius: number, strokeWidth: number, className: string, color: string, rotateDeg = -90): SVGCircleElement {
  const el = document.createElementNS(SVG_NS, "circle");
  el.setAttribute("cx", String(CENTER));
  el.setAttribute("cy", String(CENTER));
  el.setAttribute("r", String(radius));
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-width", String(strokeWidth));
  el.setAttribute("stroke", color);
  el.setAttribute("class", className);
  el.setAttribute("transform", `rotate(${rotateDeg} ${CENTER} ${CENTER})`);
  return el;
}

/** stroke-dasharray/offset for a single continuous arc covering `fraction` of the circle. */
function applyArcFraction(el: SVGCircleElement, radius: number, fraction: number): void {
  const circumference = 2 * Math.PI * radius;
  const visible = Math.max(0, Math.min(1, fraction)) * circumference;
  el.setAttribute("stroke-dasharray", `${visible} ${circumference - visible}`);
}

/**
 * `count` `<circle>` elements slotted into the first `count` of `segmentCount`
 * total positions around the ring, each a short arc with a gap on both sides
 * — a true dashed ring, not a repeating stroke-dasharray pattern, so each
 * slice can be styled independently (elapsed vs. not-yet-elapsed). `count`
 * and `segmentCount` differ on purpose: the caller draws the full ring of
 * tracks (`count === segmentCount`) but only the elapsed slice of arcs
 * (`count === segmentsElapsed`), without building and discarding the rest.
 */
function buildSegmentSlots(radius: number, strokeWidth: number, segmentCount: number, count: number, className: string, color: string): SVGCircleElement[] {
  const circumference = 2 * Math.PI * radius;
  const segmentAngle = 360 / segmentCount;
  const segmentArc = circumference / segmentCount;
  const gap = segmentArc * SEGMENT_GAP_RATIO;
  const fillArc = segmentArc - gap;
  const slots: SVGCircleElement[] = [];
  for (let i = 0; i < count; i++) {
    const el = circle(radius, strokeWidth, className, color, -90 + i * segmentAngle);
    el.setAttribute("stroke-dasharray", `${fillArc} ${circumference - fillArc}`);
    slots.push(el);
  }
  return slots;
}

export function buildRingIcon(model: UsageWindowModel): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("width", String(SIZE));
  svg.setAttribute("height", String(SIZE));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "usage-circles__ring");
  svg.dataset.tier = model.tier;

  const outerTrack = circle(OUTER_RADIUS, OUTER_WIDTH, "usage-circles__ring-track", TRACK_COLOR);
  const outerArc = circle(OUTER_RADIUS, OUTER_WIDTH, "usage-circles__ring-usage", TIER_COLOR[model.tier]);
  applyArcFraction(outerArc, OUTER_RADIUS, model.usedPercent / 100);
  svg.append(outerTrack, outerArc);

  if (model.segmentCount === 1) {
    const innerTrack = circle(INNER_RADIUS, INNER_WIDTH, "usage-circles__ring-time-track", TRACK_COLOR);
    const innerArc = circle(INNER_RADIUS, INNER_WIDTH, "usage-circles__ring-time", TIME_ELAPSED_COLOR);
    applyArcFraction(innerArc, INNER_RADIUS, model.elapsedFraction ?? 0);
    svg.append(innerTrack, innerArc);
  } else {
    const trackSlots = buildSegmentSlots(INNER_RADIUS, INNER_WIDTH, model.segmentCount, model.segmentCount, "usage-circles__ring-time-track", TRACK_COLOR);
    svg.append(...trackSlots);
    const elapsedCount = model.segmentsElapsed ?? 0;
    if (elapsedCount > 0) {
      const elapsedSlots = buildSegmentSlots(INNER_RADIUS, INNER_WIDTH, model.segmentCount, elapsedCount, "usage-circles__ring-time", TIME_ELAPSED_COLOR);
      svg.append(...elapsedSlots);
    }
  }

  return svg;
}

// ---------------------------------------------------------------------------
// The expanded panel's per-window row: the same model as the ring, unrolled
// into two stacked bars — a colored usage bar, and beneath it a track that
// fills grey as the window's elapsed time approaches its reset (segmented by
// day for a weekly window, continuous for the 5-hour one).

const SEGMENT_GAP_PX = 2;

function div(style: Partial<CSSStyleDeclaration>, className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

function buildUsageBar(model: UsageWindowModel): HTMLDivElement {
  const track = div({ height: "6px", width: "100%", overflow: "hidden", borderRadius: "9999px", backgroundColor: "var(--muted)" }, "usage-circles__bar-track");
  const fill = div({ height: "100%", borderRadius: "9999px", backgroundColor: TIER_COLOR[model.tier], width: `${model.usedPercent}%` }, "usage-circles__bar-fill");
  fill.dataset.tier = model.tier;
  track.append(fill);
  return track;
}

function buildTimeBar(model: UsageWindowModel): HTMLDivElement {
  const track = div(
    { marginTop: "4px", height: "4px", width: "100%", overflow: "hidden", borderRadius: "9999px", backgroundColor: "transparent" },
    "usage-circles__bar-time-track",
  );

  if (model.segmentCount === 1) {
    const fill = div(
      { height: "100%", borderRadius: "9999px", backgroundColor: TIME_ELAPSED_COLOR, width: `${(model.elapsedFraction ?? 0) * 100}%` },
      "usage-circles__bar-time-fill",
    );
    track.append(fill);
    return track;
  }

  track.style.display = "flex";
  track.style.gap = `${SEGMENT_GAP_PX}px`;
  const elapsedCount = model.segmentsElapsed ?? 0;
  for (let i = 0; i < model.segmentCount; i++) {
    const elapsed = i < elapsedCount;
    const segment = div(
      { height: "100%", flex: "1", borderRadius: "9999px", backgroundColor: elapsed ? TIME_ELAPSED_COLOR : TRACK_COLOR },
      "usage-circles__bar-time-segment",
    );
    segment.dataset.elapsed = String(elapsed);
    track.append(segment);
  }
  return track;
}

export function buildWindowRow(model: UsageWindowModel): HTMLDivElement {
  const row = div({ display: "flex", flexDirection: "column", gap: "4px" }, "usage-circles__window-row");

  const heading = div(
    { display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: "12px", color: "var(--muted-foreground)" },
    "usage-circles__window-heading",
  );
  const label = document.createElement("span");
  label.textContent = model.label;
  const percent = document.createElement("strong");
  Object.assign(percent.style, { fontSize: "14px", fontWeight: "600", color: "var(--foreground)" });
  percent.textContent = `${Math.round(model.usedPercent)}%`;
  heading.append(label, percent);

  const reset = div({ fontSize: "12px", color: "var(--muted-foreground)", opacity: "0.7" }, "usage-circles__window-reset");
  reset.textContent =
    model.resetsAt === null ? "Нет данных о сбросе" : `Сброс через ${model.resetRelativeLabel} (${model.resetAbsoluteLabel})`;

  row.append(heading, buildUsageBar(model), buildTimeBar(model), reset);
  return row;
}
