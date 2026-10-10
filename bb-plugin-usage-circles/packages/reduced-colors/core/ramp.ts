// Layer 1 — two colours into N steps. Pure: hex in, hex out, no DOM, no CSS.
//
// Steps are mixed in oklab, not in sRGB: oklab is built so that equal
// distances look equally different, so a blue → white ramp lightens by
// even-looking steps and a blue → yellow one passes through grey-green
// rather than a muddy dark middle. The mix is done in code rather than by
// CSS `color-mix()` so the promises — first step exactly low, last exactly
// high — are checked by tests, not left to the browser.

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` or `#rrggbb`, any case — the shape `<input type="color">` and the settings field accept. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** A valid hex colour as lower-case `#rrggbb`. */
function normalizeHex(hex: string): string {
  const digits = hex.slice(1).toLowerCase();
  return "#" + (digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits);
}

const map3 = (triple: Rgb | Lab, f: (value: number, axis: number) => number): Rgb => [
  f(triple[0], 0),
  f(triple[1], 1),
  f(triple[2], 2),
];

/** A normalised `#rrggbb` → sRGB channels in 0…1. */
const hexToRgb = (hex: string): Rgb => map3([1, 3, 5], (at) => parseInt(hex.slice(at, at + 2), 16) / 255);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const rgbToHex = (rgb: Rgb): string =>
  "#" + rgb.map((channel) => Math.round(clamp01(channel) * 255).toString(16).padStart(2, "0")).join("");

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const toGamma = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055);

// Björn Ottosson's reference matrices, https://bottosson.github.io/posts/oklab/
function rgbToOklab(rgb: Rgb): Lab {
  const [r, g, b] = map3(rgb, toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return map3(linear, toGamma);
}

/**
 * Step `index` of `last + 1` between two oklab points. Weighted by the two
 * integer distances rather than `low + (high - low) * t`, so the same step
 * counted from the other end is the very same sum — a reversed ramp is
 * exactly the ramp reversed, with no rounding drift at the edges of a byte.
 */
const lerpLab = (low: Lab, high: Lab, index: number, last: number): Lab =>
  map3(low, (value, axis) => (value * (last - index) + high[axis]! * index) / last);

/**
 * `count` colours from `low` to `high` as lower-case `#rrggbb`: the first is
 * exactly `low`, the last exactly `high`, the ones between are even steps in
 * oklab. One series gets `low`. A count that is not a positive whole number
 * gives no colours. An end that is not a hex colour is replaced by the other
 * end, so the ramp degrades to one flat colour; with both ends broken there
 * is nothing to paint with and the result is empty.
 */
export function rampColors(low: string, high: string, count: number): readonly string[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  if (!isHexColor(low) && !isHexColor(high)) return [];
  const [from, to] = [isHexColor(low) ? low : high, isHexColor(high) ? high : low].map(normalizeHex) as [string, string];
  if (count === 1) return [from];

  const last = count - 1;
  const [labFrom, labTo] = [rgbToOklab(hexToRgb(from)), rgbToOklab(hexToRgb(to))];
  return Array.from({ length: count }, (_, index) =>
    index === 0 ? from : index === last ? to : rgbToHex(oklabToRgb(lerpLab(labFrom, labTo, index, last))),
  );
}
