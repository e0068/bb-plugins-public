// kit/slider-math.js — the numeric engine behind the Input component's slider.
//
// Ported from public/cellular-host.js (the standalone host that re-implements the studio's H.*):
// cl01/expP2V/expV2P (host:25-36), stepDec (host:57), fillRange (host:42-50); and scrubK from
// public/cellular.js:480. All pure math except fillRange, which writes two flat --cell-* custom
// properties onto a passed range element's style — it touches only the element it is given, so the
// package never installs the global `document` "input" delegate that cellular-host.js:52 uses (that
// would be an import-time side effect; components wire fillRange to their own input event instead).

export function cl01(p) { return p < 0 ? 0 : (p > 1 ? 1 : p); }

// Slider thumb position 0..1 ↔ value under a non-linear (exp) scale. g=1 degenerates to linear, so
// one code path serves both linear and exponential sliders. Signed ranges put zero at p=0.5.
export function expP2V(mn, mx, g, p) {
  p = cl01(p);
  if (mn >= 0) return mn + (mx - mn) * Math.pow(p, g);
  if (p >= 0.5) return mx * Math.pow((p - 0.5) / 0.5, g);
  return mn * Math.pow((0.5 - p) / 0.5, g);
}
export function expV2P(mn, mx, g, v) {
  if (mn >= 0) return Math.pow(cl01((v - mn) / (mx - mn)), 1 / g);
  if (v >= 0) return 0.5 + 0.5 * Math.pow(cl01(mx > 0 ? v / mx : 0), 1 / g);
  return 0.5 - 0.5 * Math.pow(cl01(mn < 0 ? v / mn : 0), 1 / g);
}

// decimals in a step: 0.005 → 3, 1 → 0 (drives the value field's char width and rounding).
export function stepDec(s) { return (String(s).split(".")[1] || "").length; }

// iPhone-style scrubbing: the further the pointer strays vertically, the finer the horizontal step.
// Stepped, not smooth — the hand feels the precision gear change and can lean on it.
export function scrubK(dy) { dy = Math.abs(dy); return dy < 48 ? 1 : dy < 96 ? 0.25 : dy < 192 ? 0.1 : 0.025; }

// Paint the covered part of a range slider: write --cell-track-fill (%) that the track gradient reads.
// A two-sided slider fills from zero, whose position goes in --cell-track-zero (an exp scale sets
// min/max as position not value, so uiInput hands us the zero via el.dataset.zeroPos).
export function fillRange(el) {
  var mn = parseFloat(el.min), mx = parseFloat(el.max), v = parseFloat(el.value);
  var cl = function (x) { return Math.max(0, Math.min(100, x)); };
  var p = mx > mn ? (v - mn) / (mx - mn) * 100 : 0;
  el.style.setProperty("--cell-track-fill", cl(p).toFixed(1) + "%");
  var z = el.dataset.zeroPos != null ? parseFloat(el.dataset.zeroPos)
        : (mx > mn ? (0 - mn) / (mx - mn) * 100 : 0);
  el.style.setProperty("--cell-track-zero", cl(z).toFixed(1) + "%");
}
