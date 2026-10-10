// Layer 2 — rendering. Turns one usage-window model into DOM, in two forms
// off the same data: buildRingIcon (the two-concentric-ring SVG of a footer
// item) and buildWindowRow (the two stacked bars of the item's window), plus
// the window's content: buildProviderDetails, a row per limit of one provider,
// and buildAllLimits, a card per limit of both providers. Pure DOM
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
  type LimitCard,
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
  const track = barTrack("usage-circles__bar-time-track");
  track.append(barFill("usage-circles__bar-time-fill", TIME_ELAPSED_COLOR, `${(model.elapsedFraction ?? 0) * 100}%`));
  return track;
}

function buildSegmentedTimeBar(model: UsageWindowModel): HTMLDivElement {
  // The container carries the gaps, so its own background stays transparent:
  // each segment paints its own track, and the running one is filled only as
  // far as the day has gone.
  const track = barTrack("usage-circles__bar-time-track", {
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

// As the mockup: the name, the time to the reset and the percent on one line in the
// window title's type, 4 px above the bars, 2 px between the bars.
const LINE_GAP_PX = 4;
const BAR_GAP_PX = 2;
const TEXT: Partial<CSSStyleDeclaration> = { fontSize: "12px", fontWeight: "500", lineHeight: "normal" };

function cell(tag: "span" | "strong", text: string, style: Partial<CSSStyleDeclaration>, className = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  Object.assign(node.style, { minWidth: "0", whiteSpace: "nowrap", ...style });
  node.textContent = text;
  return node;
}

export function buildWindowRow(model: UsageWindowModel): HTMLDivElement {
  const row = div({ display: "flex", flexDirection: "column", gap: `${LINE_GAP_PX}px` }, "usage-circles__window-row");

  // The middle column is centered whatever the widths of the name and the percent.
  const heading = div(
    { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "baseline", columnGap: "8px", ...TEXT, color: "var(--foreground)" },
    "usage-circles__window-heading",
  );
  const reset = model.resetsAt === null ? "No reset data available" : `${model.resetRelativeLabel} (${model.resetAbsoluteLabel})`;
  heading.append(
    cell("span", model.shortLabel, { overflow: "hidden", textOverflow: "ellipsis" }),
    cell("span", reset, { textAlign: "center", color: "var(--muted-foreground)", opacity: "0.7" }, "usage-circles__window-reset"),
    cell("strong", `${Math.round(model.usedPercent)}%`, { textAlign: "right", fontWeight: "500", minWidth: "auto" }),
  );

  row.append(heading, buildBars(model));
  return row;
}

/** The usage bar over the time bar. */
function buildBars(model: UsageWindowModel): HTMLDivElement {
  const bars = div({ display: "flex", flexDirection: "column", gap: `${BAR_GAP_PX}px` }, "usage-circles__window-bars");
  bars.append(buildUsageBar(model), buildTimeBar(model));
  return bars;
}

/** The provider's logo in the window's header. */
export const HEADER_LOGO_PX = 16;
/** The provider's logo before a card's name in the grid. */
const CARD_LOGO_PX = 12;
// The sidebar's thread rows: 8 px in from its edges, their text 8 px further in — with the window's title.
const DETAILS_SIDE_PX = 8;
const ROW_PADDING = "8px";
const DETAILS_PADDING = `0 ${DETAILS_SIDE_PX}px ${DETAILS_SIDE_PX}px`;
const ROWS_GAP = "2px";

/**
 * A limit as a card of the grid: the name and the percent, the two bars, and
 * under them the time to the reset on the left and its clock time on the right.
 */
export function buildLimitCard(model: UsageWindowModel, logo: HTMLElement | null): HTMLDivElement {
  const card = div({ display: "flex", flexDirection: "column", gap: `${LINE_GAP_PX}px`, minWidth: "0" }, "usage-circles__card");
  const heading = div({ display: "flex", alignItems: "center", gap: "2px", ...TEXT, color: "var(--foreground)" }, "usage-circles__card-heading");
  heading.append(
    ...(logo === null ? [] : [logo]),
    cell("span", model.shortLabel, { flex: "1", overflow: "hidden", textOverflow: "ellipsis" }),
    cell("strong", `${Math.round(model.usedPercent)}%`, { fontWeight: "500", minWidth: "auto" }),
  );
  const reset = div(
    { display: "flex", justifyContent: "space-between", gap: "4px", ...TEXT, color: "var(--muted-foreground)", opacity: "0.7" },
    "usage-circles__card-reset",
  );
  const when = model.resetsAt === null ? ["No reset data"] : [model.resetRelativeLabel, model.resetAbsoluteLabel];
  reset.append(...when.map((text) => cell("span", text, {})));
  card.append(heading, buildBars(model), reset);
  return card;
}

/** A row or a card of the window, inset like the sidebar's threads; the item's own one gets the background of the selected thread. */
function placeLimit(node: HTMLDivElement, marked: boolean): HTMLDivElement {
  Object.assign(node.style, { padding: ROW_PADDING, borderRadius: "6px" });
  if (!marked) return node;
  node.dataset.highlighted = "true";
  node.style.backgroundColor = "var(--sidebar-accent)";
  return node;
}

function listOf(rows: readonly HTMLDivElement[]): HTMLDivElement {
  const list = div({ display: "flex", flexDirection: "column", gap: ROWS_GAP, padding: DETAILS_PADDING }, "usage-circles__details");
  list.append(...rows);
  return list;
}

/** Cards in two columns; an odd last card takes both. */
function gridOf(cards: readonly HTMLDivElement[]): HTMLDivElement {
  const grid = div({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ROWS_GAP, padding: DETAILS_PADDING }, "usage-circles__details");
  if (cards.length % 2 === 1) cards[cards.length - 1]!.style.gridColumn = "1 / -1";
  grid.append(...cards);
  return grid;
}

function statusLine(text: string): HTMLDivElement {
  const status = div({ fontSize: "12px", color: "var(--muted-foreground)", padding: ROW_PADDING }, "usage-circles__status");
  status.textContent = text;
  return status;
}

/** Why a provider has no data, in the user's words. */
const whyNoData = (usage: Exclude<ProviderStateWire["usage"], { status: "ok" }>): string =>
  statusLabel(usage.status, usage.status === "error" ? usage.message : undefined);

/**
 * A footer item's window under the provider's logo and name: why it has no data, or
 * its limits a row each, the one of `marked`, the window the item's ring shows, standing out.
 */
export function buildProviderDetails(provider: ProviderStateWire, coloring: Coloring, nowMs: number, marked?: UsageWindowInput): HTMLDivElement {
  const { usage } = provider;
  if (usage.status !== "ok") return listOf([statusLine(whyNoData(usage))]);
  return listOf(usage.windows.map((window) => placeLimit(buildWindowRow(buildUsageWindowModel(window, nowMs, coloring)), window === marked)));
}

/** Why a provider of the grid has no data, under its logo, across both columns. */
function missingLine(provider: ProviderStateWire): HTMLDivElement {
  const line = statusLine(provider.usage.status === "ok" ? "" : whyNoData(provider.usage));
  Object.assign(line.style, { display: "flex", alignItems: "center", gap: "4px", gridColumn: "1 / -1" });
  line.prepend(buildProviderLogo(provider, CARD_LOGO_PX));
  return line;
}

/**
 * The grid: a card per limit of both providers, in the given order, each with its provider's logo,
 * the one of `marked` standing out; then why each of `missing` has no data.
 */
export function buildAllLimits(
  limits: readonly LimitCard[],
  coloring: Coloring,
  nowMs: number,
  marked?: UsageWindowInput,
  missing: readonly ProviderStateWire[] = [],
): HTMLDivElement {
  if (limits.length === 0 && missing.length === 0) return listOf([statusLine("No limits to show — pick them under Limits in the plugin's settings")]);
  const grid = gridOf(
    limits.map(({ provider, window }) =>
      placeLimit(buildLimitCard(buildUsageWindowModel(window, nowMs, coloring), buildProviderLogo(provider, CARD_LOGO_PX)), window === marked),
    ),
  );
  grid.append(...missing.map(missingLine));
  return grid;
}
