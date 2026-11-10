// kit/swatch.js — Swatch: a colour cell that opens a shared HSB/RGB picker popover.
// Ported from public/cellular.js: colorCell (1668-1683), openPicker/closePicker (1696-1712),
// buildPicker (818-909). The picker is assembled from the same Input/Segment/Cell components.
//
// Cut/rebound from the studio original (decisions/component-factory-inventory.md):
//  · ColorSwatch's inst.vals[pi] (a shader-instance model slot) → plain get/set callbacks, so the
//    component reads/writes the consumer's value and knows nothing about a shader model;
//  · H.pickColorFromCanvas (the "grab colour from the studio canvas" eyedropper) → the native
//    EyeDropper API with a silent fallback where unsupported — a client project has no studio canvas;
//  · H.trPhrase/H.trLabel (studio i18n) → plain literals / identity.
import { hex2hsv, hsv2rgb, rgb2hex } from "./color.js";
import { uiRow, uiCell } from "./cell.js";
import { input } from "./input.js";
import { segment } from "./segment.js";
import { placePopup } from "./popup.js";

var TARGET_ICON = '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" width="12" height="12">'
  + '<circle cx="6" cy="6" r="3.5" stroke="currentColor"/>'
  + '<path d="M6 .5v2M6 9.5v2M.5 6h2M9.5 6h2" stroke="currentColor" stroke-linecap="round"/></svg>';

// Native eyedropper (Chromium): grab a screen colour. No support → silently do nothing.
function pickScreenColor(cb) {
  if (typeof window === "undefined" || typeof window.EyeDropper !== "function") return;
  try { new window.EyeDropper().open().then(function (r) { if (r && r.sRGBHex) cb(r.sRGBHex); }).catch(function () {}); }
  catch (e) {}
}

var pkModel = "hsb";   // shared across pickers: switch once, expect it to stick

// Module-singleton picker popover: only one open at a time.
var _pkpop = null;
function pkOutside(e) {
  if (_pkpop && !_pkpop.contains(e.target) && !(e.target.classList && e.target.classList.contains("dsswatch"))) closePicker();
}
export function closePicker() {
  if (_pkpop) { _pkpop.remove(); _pkpop = null; document.removeEventListener("pointerdown", pkOutside, true); }
}
export function openPicker(anchor, label, getHex, setHex, getA, setA) {
  if (_pkpop) { closePicker(); return; }
  var pop = document.createElement("div"); pop.className = "pkpop";
  var pk = buildPicker(label, getHex, setHex, getA, setA);
  pop.appendChild(pk);
  document.body.appendChild(pop);
  pk._refresh();   // marker half-width is 0 before insertion, so the edge clamp did not compute
  var r = anchor.getBoundingClientRect();
  placePopup(pop, r.left, r.bottom + 4, r.top);
  _pkpop = pop;
  setTimeout(function () { document.addEventListener("pointerdown", pkOutside, true); }, 0);
}

// The picker panel: HSB square + hue strip + hex field + eyedropper + H·S·B/R·G·B number cells.
export function buildPicker(label, getHex, setHex, getA, setA) {
  var root = document.createElement("div"); root.className = "picker";
  root.innerHTML = '<div class="pksq"><div class="pkdot"></div></div><div class="pkhue"><div class="pkhk"></div></div><div class="pkhexrow"><span class="pkl"></span><input class="pkhex" spellcheck="false" maxlength="7"></div>';
  root.querySelector(".pkl").textContent = label;
  var sq = root.querySelector(".pksq"), dot = root.querySelector(".pkdot"), hue = root.querySelector(".pkhue"), hk = root.querySelector(".pkhk"), hex = root.querySelector(".pkhex");
  var st = hex2hsv(getHex()) || { h: 20, s: .6, v: .85 }, hsbCells = [];
  // Marker clamps to the edge from inside only within its own half-width — position stays exact everywhere else.
  function put(el, x, y) {
    var h = el.offsetWidth / 2;
    el.style.left = "clamp(" + h + "px, " + (x * 100) + "%, calc(100% - " + h + "px))";
    if (y != null) el.style.top = "clamp(" + h + "px, " + (y * 100) + "%, calc(100% - " + h + "px))";
  }
  function render(pushHex) {
    sq.style.backgroundColor = "hsl(" + st.h + ",100%,50%)";
    put(dot, st.s, 1 - st.v); put(hk, st.h / 360);
    var rgb = hsv2rgb(st.h, st.s, st.v), hx = rgb2hex(rgb[0], rgb[1], rgb[2]);
    setHex(hx); if (pushHex !== false) hex.value = hx.replace("#", "").toUpperCase();
    hsbCells.forEach(function (c) { if (c._refresh) c._refresh(); });
  }
  function dragSq(e) { var r = sq.getBoundingClientRect(); st.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); st.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); render(); }
  function dragHue(e) { var r = hue.getBoundingClientRect(); st.h = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 360; render(); }
  function drag(el2, fn) {
    el2.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      try { el2.setPointerCapture(e.pointerId); } catch (err) {}
      fn(e);
      var up = function (ev) {
        el2.removeEventListener("pointermove", mv); el2.removeEventListener("pointerup", up);
        el2.removeEventListener("pointercancel", up); el2.removeEventListener("lostpointercapture", up);
        try { el2.releasePointerCapture(ev && ev.pointerId != null ? ev.pointerId : e.pointerId); } catch (err) {}
      };
      var mv = function (ev) { if (ev.buttons === 0) { up(ev); return; } fn(ev); };
      el2.addEventListener("pointermove", mv); el2.addEventListener("pointerup", up);
      el2.addEventListener("pointercancel", up); el2.addEventListener("lostpointercapture", up);
    });
  }
  drag(sq, dragSq); drag(hue, dragHue);
  hex.addEventListener("change", function () { var h = hex2hsv(hex.value); if (h) { st = h; render(false); } else render(); });
  var eye = document.createElement("button"); eye.type = "button"; eye.className = "pkeye";
  eye.innerHTML = TARGET_ICON; eye.title = "Взять цвет с экрана";
  eye.onclick = function (e) {
    e.stopPropagation();
    closePicker();   // the picker hides the view; aim at the image
    pickScreenColor(function (hx) { var h = hex2hsv(hx); if (h) { st = h; render(); } });
  };
  root.querySelector(".pkhexrow").appendChild(eye);
  // Row of H·S·B (or R·G·B) number cells: the eye can't hit an exact value on the square, numbers can.
  var hsb = uiRow(); hsb.style.cssText = "display:flex;gap:var(--block-gap,2px);";
  function modelFields() {
    var f = pkModel === "rgb"
      ? [["R", 0, 255, 1, function () { return rgbNow()[0]; }, function (v) { setRGB(0, v); }],
         ["G", 0, 255, 1, function () { return rgbNow()[1]; }, function (v) { setRGB(1, v); }],
         ["B", 0, 255, 1, function () { return rgbNow()[2]; }, function (v) { setRGB(2, v); }]]
      : [["H", 0, 360, 1, function () { return st.h; }, function (v) { st.h = v; }],
         ["S", 0, 100, 1, function () { return st.s * 100; }, function (v) { st.s = v / 100; }],
         ["B", 0, 100, 1, function () { return st.v * 100; }, function (v) { st.v = v / 100; }]];
    if (getA) f.push(["α", 0, 100, 1, function () { return getA() * 100; }, function (v) { setA(v / 100); }]);
    return f;
  }
  function rgbNow() { var c = hsv2rgb(st.h, st.s, st.v); return [c[0] * 255, c[1] * 255, c[2] * 255]; }
  function setRGB(i, v) {
    var c = rgbNow(); c[i] = v;
    var h = hex2hsv(rgb2hex(c[0] / 255, c[1] / 255, c[2] / 255)); if (h) st = h;
  }
  function buildFields() {
    hsb.innerHTML = ""; hsbCells.length = 0;
    modelFields().forEach(function (f) {
      var cell = input(f[0], f[1], f[2], f[3], f[4], function (v) { f[5](v); render(); }, null,
        { fmt: function (x) { return String(Math.round(x)); } });
      cell.style.cssText += ";flex:1 1 0;min-width:0;";
      hsb.appendChild(cell); hsbCells.push(cell);
    });
  }
  var seg = segment([{ text: "HSB", title: "HSB" }, { text: "RGB", title: "RGB" }],
    pkModel === "rgb" ? 1 : 0, function (i) { pkModel = i ? "rgb" : "hsb"; buildFields(); render(); });
  root.appendChild(seg);
  buildFields();
  root.appendChild(hsb);
  render();
  root._refresh = function () { var h = hex2hsv(getHex()); if (h) st = h; sq.style.backgroundColor = "hsl(" + st.h + ",100%,50%)"; put(dot, st.s, 1 - st.v); put(hk, st.h / 360); hex.value = (getHex() || "").replace("#", "").toUpperCase(); };
  return root;
}

// colorCell: a swatch cell that opens the picker. `auto` = colour is computed (not editable), but its
// alpha can still be edited, so the picker opens on auto too when a getA is present.
export function colorCell(label, getHex, setHex, auto, cssVar, getA, setA) {
  var sw = document.createElement("span"); sw.className = "dsswatch"; sw.style.background = (auto && cssVar) ? "var(" + cssVar + ")" : getHex();
  var o = { label: label, title: auto ? "Цвет вычисляется автоматически" : "Открыть палитру" };
  if (!auto || getA) o.act = function () {
    openPicker(sw, label, getHex, auto ? function () {} : function (hx) { setHex(hx); sw.style.background = hx; }, getA, setA);
  };
  var c = uiCell(o); if (auto) c.style.opacity = ".5";
  c.appendChild(sw); return c;
}

// Public props form: swatch({label, get, set, auto, cssVar, getA, setA}).
export function swatch(props) {
  if (!props || typeof props !== "object") throw new TypeError("swatch(props): props object required");
  return colorCell(props.label || "", props.get, props.set, props.auto, props.cssVar, props.getA, props.setA);
}
