// kit/utils.js — canonical ESM home for Cellular's pure color/number utilities.
//
// These are byte-for-byte ports of the same-named (or, for `autoText`/`clamp01`, renamed) functions
// in public/cellular.js — that file stays a classic <script> (loaded by file://, no ES-module CORS),
// so it keeps its own copy rather than importing this one. See the "MIRROR of kit/utils.js" comments
// there, and test/kit/foundation-utils.test.js, which asserts the two stay byte-identical in behavior.
//
// Pure: no DOM, no localStorage, no globals touched at module scope — safe to import in Node or any
// bundler target, not just the browser.

// hex #rrggbb + alpha → rgba(): alpha is quantized to thousandths (toFixed(3)) to match the alpha
// sliders' .001 step (grid = step/10) — .853 must not collapse back to .85 (was toFixed(2)).
export function hexRGBA(hex, a) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex;
  var n = parseInt(m[1], 16);
  return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + (a == null ? 1 : +a.toFixed(3)) + ")";
}

// lighten(amt>0)/darken(amt<0) a hex color; amt in [-1,1] — fraction toward white/black.
export function shade(hex, amt) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex;
  var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  var t = amt >= 0 ? 255 : 0, f = Math.min(1, Math.abs(amt));
  return "#" + c.map(function (x) { return ("0" + Math.round(x + (t - x) * f).toString(16)).slice(-2); }).join("");
}

// rotate a hex color's HUE by deg degrees (RGB→HSL→shift hue→RGB). deg=0 / bad hex → unchanged.
export function hueRotate(hex, deg) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m || !deg) return hex;
  var n = parseInt(m[1], 16), r0 = (n >> 16 & 255) / 255, g0 = (n >> 8 & 255) / 255, b0 = (n & 255) / 255;
  var mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
  if (d) {
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0) : mx === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360) % 1; if (h < 0) h += 1;
  function h2(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
  var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return "#" + [h2(p, q, h + 1 / 3), h2(p, q, h), h2(p, q, h - 1 / 3)].map(function (x) { return ("0" + Math.round(x * 255).toString(16)).slice(-2); }).join("");
}

// relative luminance (perceptual weights, not true sRGB relative luminance) of a hex color, in [0,1].
export function relLum(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || "") || ["", "808080"]; var n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// auto text color for a hex background: dark text on light backgrounds, light text on dark ones.
// Mirror of public/cellular.js's `contrast(hex)` — renamed here for a name that reads at the call site.
export function autoText(hex) { return relLum(hex) > 0.55 ? "#111417" : "#f2fbfb"; }

// clamp a number into [0,1]. Mirror of public/cellular.js's `a01(x)`.
export function clamp01(x) { return Math.max(0, Math.min(1, x)); }
