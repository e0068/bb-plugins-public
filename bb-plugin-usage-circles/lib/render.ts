// Layer 2 — rendering. Turns one usage-window model into DOM, in two forms
// off the same data: buildRingIcon (the two-concentric-ring SVG of a footer
// item) and buildWindowRow (the two stacked bars of the item's window), plus
// buildProviderDetails, the window's whole content for one provider. Pure DOM
// construction, no plugin/SDK imports — testable with jsdom alone.
//
// Colors are plain inline styles, not Tailwind utility classes: BB renders the
// footer icon and the window frame outside the plugin root, where the plugin's
// own stylesheet does not apply.
import {
  buildUsageWindowModel,
  segmentFillFractions,
  statusLabel,
  type Coloring,
  type ProviderStateWire,
  type ProviderTint,
  type UsageWindowModel,
  type UsageWindowInput,
} from "./usage-model";
import { ringRadii, type RingStyle } from "./ring-style";

const SVG_NS = "http://www.w3.org/2000/svg";

const TRACK_COLOR = "var(--border)";
const TIME_ELAPSED_COLOR = "var(--muted-foreground)";
// The theme's default blue/amber scale for the two lighter tiers, the
// semantic `destructive` token for red — matches how the rest of the app
// already marks danger states. "unknown" (pace mode with too little of the
// window gone to judge) is the text color: white on bb's dark theme, and
// still visible on the light one, where literal white would vanish.
const TIER_COLOR: Record<UsageWindowModel["tier"], string> = {
  blue: "var(--color-blue-500)",
  yellow: "var(--color-amber-500)",
  red: "var(--destructive)",
  unknown: "var(--foreground)",
};

// ---------------------------------------------------------------------------
// Provider logo. The host serves each provider's mark as a currentColor SVG;
// inside an <img> currentColor collapses to black and the mark disappears on a
// dark theme, so the SVG is used as a mask over a painted box instead. The box
// takes the provider's declared brand tint through light-dark(), which follows
// the document's color-scheme, or the surrounding text color when there is none.

/** `"fill"` — as big as the box the caller puts the logo in. */
export function buildProviderLogo(provider: { title: string; logoUrl: string; tint: ProviderTint | null }, size: number | "fill"): HTMLSpanElement {
  const logo = document.createElement("span");
  logo.className = "usage-circles__logo";
  logo.setAttribute("role", "img");
  logo.setAttribute("aria-label", provider.title);
  logo.dataset.logoUrl = provider.logoUrl;
  const mask = `url("${provider.logoUrl}") center / contain no-repeat`;
  const color = provider.tint === null ? "currentColor" : `light-dark(${provider.tint.light}, ${provider.tint.dark})`;
  if (provider.tint !== null) logo.dataset.tint = color;
  const side = size === "fill" ? "100%" : `${size}px`;
  Object.assign(logo.style, { display: "inline-block", flexShrink: "0", width: side, height: side });
  // Set as raw properties: mask shorthands and light-dark() are newer than
  // CSSStyleDeclaration's typed fields.
  logo.style.setProperty("mask", mask);
  logo.style.setProperty("-webkit-mask", mask);
  logo.style.setProperty("background-color", color);
  return logo;
}

interface Stroke {
  readonly center: number;
  readonly radius: number;
  readonly width: number;
}

function circle({ center, radius, width }: Stroke, className: string, color: string, rotateDeg = -90): SVGCircleElement {
  const el = document.createElementNS(SVG_NS, "circle");
  el.setAttribute("cx", String(center));
  el.setAttribute("cy", String(center));
  el.setAttribute("r", String(radius));
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-width", String(width));
  el.setAttribute("stroke", color);
  el.setAttribute("class", className);
  el.setAttribute("transform", `rotate(${rotateDeg} ${center} ${center})`);
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
function buildSegmentSlots(stroke: Stroke, gapRatio: number, segmentCount: number, count: number, className: string, color: string): SVGCircleElement[] {
  const circumference = 2 * Math.PI * stroke.radius;
  const segmentAngle = 360 / segmentCount;
  const fillArc = (circumference / segmentCount) * (1 - gapRatio);
  return Array.from({ length: count }, (_, i) => {
    const el = circle(stroke, className, color, -90 + i * segmentAngle);
    el.setAttribute("stroke-dasharray", `${fillArc} ${circumference - fillArc}`);
    return el;
  });
}

/**
 * The footer ring of one window, drawn in a `style.dims.size` box. With the
 * provider's logo in the center there is no room for the unknown-pace
 * question mark: the time ring stays empty instead.
 */
export function buildRingIcon(model: UsageWindowModel, { logo, dims }: RingStyle): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${dims.size} ${dims.size}`);
  svg.setAttribute("width", String(dims.size));
  svg.setAttribute("height", String(dims.size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "usage-circles__ring");
  svg.dataset.tier = model.tier;

  const radii = ringRadii(dims);
  const track = `color-mix(in oklab, var(--border) ${dims.track}%, transparent)`;
  const outer: Stroke = { center: radii.center, radius: radii.outer, width: dims.outer };
  const outerArc = circle(outer, "usage-circles__ring-usage", TIER_COLOR[model.tier]);
  applyArcFraction(outerArc, outer.radius, model.usedPercent / 100);
  svg.append(circle(outer, "usage-circles__ring-track", track), outerArc);

  if (model.tier === "unknown" && logo === "corner") {
    // No pace to show yet: the time ring gives way to a question mark.
    const mark = document.createElementNS(SVG_NS, "text");
    mark.setAttribute("x", String(radii.center));
    mark.setAttribute("y", String(radii.center));
    mark.setAttribute("text-anchor", "middle");
    mark.setAttribute("dominant-baseline", "central");
    mark.setAttribute("font-size", String(dims.size * 0.45));
    mark.setAttribute("font-weight", "700");
    mark.setAttribute("fill", TIER_COLOR.unknown);
    mark.setAttribute("class", "usage-circles__ring-unknown");
    mark.textContent = "?";
    svg.append(mark);
    return svg;
  }
  if (radii.inner === null) return svg;
  const inner: Stroke = { center: radii.center, radius: radii.inner, width: dims.inner };
  const known = model.tier !== "unknown";
  if (model.segmentCount === 1) {
    svg.append(circle(inner, "usage-circles__ring-time-track", track));
    if (known) {
      const innerArc = circle(inner, "usage-circles__ring-time", TIME_ELAPSED_COLOR);
      applyArcFraction(innerArc, inner.radius, model.elapsedFraction ?? 0);
      svg.append(innerArc);
    }
    return svg;
  }
  const gapRatio = dims.segmentGap / 100;
  svg.append(...buildSegmentSlots(inner, gapRatio, model.segmentCount, model.segmentCount, "usage-circles__ring-time-track", track));
  const elapsedCount = known ? (model.segmentsElapsed ?? 0) : 0;
  svg.append(...buildSegmentSlots(inner, gapRatio, model.segmentCount, elapsedCount, "usage-circles__ring-time", TIME_ELAPSED_COLOR));
  return svg;
}

// ---------------------------------------------------------------------------
// The expanded panel's per-window row: the same model as the ring, unrolled
// into two stacked bars — a colored usage bar, and beneath it a track that
// fills grey as the window's elapsed time approaches its reset (segmented by
// day for a weekly window, continuous for the 5-hour one).

const SEGMENT_GAP_PX = 2;
// Both bars of a row share one geometry — same height, same color under the
// unfilled part — so the pair reads as one control with two readings rather
// than two unrelated widgets.
const BAR_HEIGHT = "4px";

function div(style: Partial<CSSStyleDeclaration>, className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

function barTrack(className: string, extra: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  return div({ height: BAR_HEIGHT, width: "100%", overflow: "hidden", borderRadius: "9999px", backgroundColor: TRACK_COLOR, ...extra }, className);
}

function barFill(className: string, color: string, width: string): HTMLDivElement {
  return div({ height: "100%", borderRadius: "9999px", backgroundColor: color, width }, className);
}

function buildUsageBar(model: UsageWindowModel): HTMLDivElement {
  const track = barTrack("usage-circles__bar-track");
  const fill = barFill("usage-circles__bar-fill", TIER_COLOR[model.tier], `${model.usedPercent}%`);
  fill.dataset.tier = model.tier;
  track.append(fill);
  return track;
}

function buildContinuousTimeBar(model: UsageWindowModel): HTMLDivElement {
  const track = barTrack("usage-circles__bar-time-track", { marginTop: "4px" });
  track.append(barFill("usage-circles__bar-time-fill", TIME_ELAPSED_COLOR, `${(model.elapsedFraction ?? 0) * 100}%`));
  return track;
}

function buildSegmentedTimeBar(model: UsageWindowModel): HTMLDivElement {
  // The container carries the gaps, so its own background stays transparent:
  // each segment paints its own track, and the running one is filled only as
  // far as the day has gone.
  const track = barTrack("usage-circles__bar-time-track", {
    marginTop: "4px",
    backgroundColor: "transparent",
    borderRadius: "0",
    display: "flex",
    gap: `${SEGMENT_GAP_PX}px`,
  });

  for (const fraction of segmentFillFractions(model.elapsedFraction, model.segmentCount)) {
    const segment = barTrack("usage-circles__bar-time-segment", { width: "auto", flex: "1" });
    segment.dataset.elapsed = String(fraction >= 1);
    segment.append(barFill("usage-circles__bar-time-segment-fill", TIME_ELAPSED_COLOR, `${fraction * 100}%`));
    track.append(segment);
  }
  return track;
}

function buildTimeBar(model: UsageWindowModel): HTMLDivElement {
  return model.segmentCount === 1 ? buildContinuousTimeBar(model) : buildSegmentedTimeBar(model);
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
    model.resetsAt === null ? "No reset data available" : `Resets in ${model.resetRelativeLabel} (${model.resetAbsoluteLabel})`;

  row.append(heading, buildUsageBar(model), buildTimeBar(model), reset);
  return row;
}

const HEADER_LOGO_PX = 16;
const DETAILS_SIDE_PX = 6;

/** The marked row of a footer item's own limit: the sidebar's hover background. */
function markRow(row: HTMLDivElement): HTMLDivElement {
  row.dataset.highlighted = "true";
  Object.assign(row.style, { backgroundColor: "var(--sidebar-accent)", boxShadow: "inset 2px 0 0 var(--sidebar-foreground)" });
  return row;
}

/**
 * A footer item's window: the provider's logo and name, why it has no data, or
 * a row per limit window — the row of `marked`, the window the item's ring shows, stands out.
 */
export function buildProviderDetails(provider: ProviderStateWire, coloring: Coloring, nowMs: number, marked?: UsageWindowInput): HTMLDivElement {
  const details = div({ display: "flex", flexDirection: "column", gap: "12px", padding: `10px ${DETAILS_SIDE_PX}px 6px` }, "usage-circles__details");
  const header = div(
    { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "600", color: "var(--foreground)" },
    "usage-circles__panel-header",
  );
  const title = document.createElement("span");
  title.textContent = `${provider.title} Limits`;
  header.append(buildProviderLogo(provider, HEADER_LOGO_PX), title);
  details.append(header);
  if (provider.usage.status === "ok") {
    provider.usage.windows.forEach((window) => {
      const row = buildWindowRow(buildUsageWindowModel(window, nowMs, coloring));
      // As wide as the details' side padding, so the marked row's background
      // reaches its edges without overflowing the window.
      Object.assign(row.style, { padding: `6px ${DETAILS_SIDE_PX}px`, margin: `0 -${DETAILS_SIDE_PX}px`, borderRadius: "6px" });
      details.append(window === marked ? markRow(row) : row);
    });
    return details;
  }
  const status = div({ fontSize: "12px", color: "var(--muted-foreground)" }, "usage-circles__status");
  status.textContent = statusLabel(provider.usage.status, provider.usage.status === "error" ? provider.usage.message : undefined);
  details.append(status);
  return details;
}
