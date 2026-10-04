// Layer 1 — pure: how a footer ring looks. Where the provider's logo sits is a
// plugin setting; the dimensions are tuned with sliders in the plugin's own
// settings section and stored as one record. Every dimension is in CSS pixels
// at BB's 32 px footer button, except the two percentages.

export type LogoPlacement = "center" | "corner";

/** The "Provider logo" setting's options, in `LogoPlacement` order. */
export const LOGO_OPTIONS = ["In the center", "In the corner"] as const;

export const logoPlacementOf = (label: unknown): LogoPlacement => (label === LOGO_OPTIONS[1] ? "corner" : "center");

export interface RingDims {
  /** Side of the square the rings are drawn in. */
  readonly size: number;
  /** Stroke of the outer, usage ring. */
  readonly outer: number;
  /** Stroke of the inner, time ring. */
  readonly inner: number;
  /** Space between the two rings. */
  readonly gap: number;
  /** Gap between a weekly ring's day segments, % of a segment. */
  readonly segmentGap: number;
  /** Strength of the empty track under both rings, %. */
  readonly track: number;
  readonly centerLogo: number;
  readonly cornerLogo: number;
  /** Sidebar-colored padding around the corner logo, over the ring's edge. */
  readonly cornerPad: number;
  /** How far the corner logo sticks out above the box. */
  readonly cornerTop: number;
  /** How far the corner logo sticks out right of the box. */
  readonly cornerRight: number;
}

export interface RingStyle {
  readonly logo: LogoPlacement;
  readonly dims: RingDims;
}

export type DimGroup = "rings" | "center" | "corner";

export interface DimField {
  readonly key: keyof RingDims;
  readonly group: DimGroup;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: "px" | "%";
}

export const DIM_FIELDS: readonly DimField[] = [
  { key: "size", group: "rings", label: "Ring size", min: 14, max: 32, step: 1, unit: "px" },
  { key: "outer", group: "rings", label: "Usage ring thickness", min: 0.5, max: 5, step: 0.1, unit: "px" },
  { key: "inner", group: "rings", label: "Time ring thickness", min: 0.5, max: 4, step: 0.1, unit: "px" },
  { key: "gap", group: "rings", label: "Space between rings", min: 0, max: 4, step: 0.1, unit: "px" },
  { key: "segmentGap", group: "rings", label: "Gap between days", min: 0, max: 50, step: 1, unit: "%" },
  { key: "track", group: "rings", label: "Empty track strength", min: 0, max: 100, step: 5, unit: "%" },
  { key: "centerLogo", group: "center", label: "Logo size", min: 3, max: 16, step: 0.5, unit: "px" },
  { key: "cornerLogo", group: "corner", label: "Logo size", min: 4, max: 14, step: 0.5, unit: "px" },
  { key: "cornerPad", group: "corner", label: "Backing around the logo", min: 0, max: 3, step: 0.5, unit: "px" },
  { key: "cornerTop", group: "corner", label: "Shift up", min: -4, max: 8, step: 0.5, unit: "px" },
  { key: "cornerRight", group: "corner", label: "Shift right", min: -4, max: 8, step: 0.5, unit: "px" },
];

export const DEFAULT_RING_DIMS: RingDims = {
  size: 28,
  outer: 2,
  inner: 2,
  gap: 1,
  segmentGap: 20,
  track: 80,
  centerLogo: 12,
  cornerLogo: 12,
  cornerPad: 1,
  cornerTop: 4,
  cornerRight: 4,
};

export const DEFAULT_RING_STYLE: RingStyle = { logo: "center", dims: DEFAULT_RING_DIMS };

const clamp = (value: number, { min, max }: DimField): number => Math.min(max, Math.max(min, value));

/** Stored dimensions, each one pulled into its slider's range; a missing or broken one is the default. */
export function parseRingDims(raw: unknown): RingDims {
  const record: Record<string, unknown> = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    DIM_FIELDS.map((field) => {
      const value = record[field.key];
      return [field.key, typeof value === "number" && Number.isFinite(value) ? clamp(value, field) : DEFAULT_RING_DIMS[field.key]];
    }),
  ) as unknown as RingDims;
}

export interface RingRadii {
  readonly center: number;
  readonly outer: number;
  /** `null` — the outer ring and the gap leave the inner ring no room. */
  readonly inner: number | null;
}

/** Stroke-centered radii: the outer ring touches the box, the inner one sits a gap inside it. */
export function ringRadii({ size, outer, inner, gap }: RingDims): RingRadii {
  const center = size / 2;
  const outerRadius = center - outer / 2;
  const innerRadius = outerRadius - outer / 2 - gap - inner / 2;
  return { center, outer: outerRadius, inner: innerRadius - inner / 2 > 0 ? innerRadius : null };
}
