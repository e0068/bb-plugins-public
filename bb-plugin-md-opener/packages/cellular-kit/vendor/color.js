// kit/color.js — pure color math for the Swatch component and its picker.
//
// Ported from public/cellular.js: packedToHex/hexToPacked (the block-color packed-int encoding used
// by ColorSwatch, cellular.js:190-200) and hsv2rgb/rgb2hex/hex2hsv (the palette/picker arithmetic,
// cellular.js:1816-1822). Pure: no DOM, no globals — safe to import anywhere. See utils.js for the
// theme-side color helpers (hexRGBA/shade/hueRotate/relLum/autoText); those and these do not overlap.

// A color packed into one integer, low byte = red (matches the shader's unpackCol layout).
export function packedToHex(p) {
  p = Math.max(0, Math.min(0xffffff, Math.round(p) || 0));
  var b = Math.floor(p / 65536), g = Math.floor((p - b * 65536) / 256);
  return "#" + [p - b * 65536 - g * 256, g, b].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
}

// #rgb and #rrggbb both parse; #fff → white (each nibble doubled), not 0x000fff.
export function hexToPacked(h) {
  var t = String(h).replace(/^#/, "");
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  var n = parseInt(t, 16) || 0;
  return (n >> 16 & 255) + (n >> 8 & 255) * 256 + (n & 255) * 65536;
}

// HSV (h in [0,360), s/v in [0,1]) → [r,g,b] each in [0,1].
export function hsv2rgb(h, s, v) {
  var f = function (n) { var k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

// [r,g,b] each in [0,1] → "#rrggbb".
export function rgb2hex(r, g, b) {
  function c(x) { return ("0" + Math.round(x * 255).toString(16)).slice(-2); }
  return "#" + c(r) + c(g) + c(b);
}

// "#rgb"/"#rrggbb" → {h,s,v} (h in [0,360), s/v in [0,1]); malformed input → null.
export function hex2hsv(hex) {
  hex = (hex || "").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
  if (hex.length !== 6) return null;
  var r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
  if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { h: h, s: mx ? d / mx : 0, v: mx };
}
