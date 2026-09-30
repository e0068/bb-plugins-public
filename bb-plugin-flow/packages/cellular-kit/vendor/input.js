// kit/input.js — Input, with its three modes: plain text, number, and slider (slider is a MODE of
// number, not a separate component). Ported from public/cellular.js: uiInput/uiInputProps/
// uiInputValueAlign/attachIcon (313-374), uiInputNum (536-683), uiInputPlain (982-993). attachMenu
// (450-469) is ported into kit/menu.js instead — see the import note below.
//
// Deliberately CUT from the studio original (kept in the lab, not the package — see
// decisions/component-factory-inventory.md):
//  · the LFO/MIDI "ghost" (row._ghostAt, the --mac/--gmac macro colours) — studio modulation, not a
//    component concern;
//  · typedEntry/clampParam — the studio let typed entry exceed min/max via a parameter-setter clamp;
//    at the package boundary the consumer's own set() decides clamping, so this machinery is inert;
//  · H.setSliderDrag — it blocked a studio block-move gesture that does not exist here.
// DS.dblResetInput (a studio theme preset) becomes the module config flag `dblResetInput` (default
// true) — flip it with setDblResetInput(). The double-tap reset is component behaviour, not a theme.
import { dimLabelHTML } from "./text.js";
import { stepDec, expP2V, expV2P, fillRange, scrubK } from "./slider-math.js";
import { evalExpr } from "./expr.js";
import { dblTap, gestureArbiter } from "./gesture.js";
// No import from "./menu.js": menu.js itself imports input() for its {type:"slider"} items, so
// Input must stay below Menu in the dependency graph. hasMenu/menu below are only stashed on the
// row for kit/index.js (the composition root) to wire up via menu.js's attachMenu() — see
// decisions/kit-input-menu-cycle.md.

var dblResetInput = true;
export function setDblResetInput(v) { dblResetInput = !!v; }

// A mouse click anywhere in the input (value, label, padding): select the value as a whole (default),
// or place the caret at the click point when the click landed in the value itself.
// Keyboard focus (Tab) always selects all regardless of this flag — unaffected, unchanged.
var selectAllOnClick = true;
export function setSelectAllOnClick(v) { selectAllOnClick = !!v; }

// Single entry point, three call forms:
//  · input(placeholder)                                          → plain text
//  · input(label, min, max, step, get, set, defVal, opts)        → number/slider (positional)
//  · input({leftIcon,label,valueAlign,placeholder,rightIcon,num,hasMenu,menu,get,set}) → props form
export function input(a, min, max, step, getV, setV, defVal, opts) {
  if (arguments.length <= 1) return (a && typeof a === "object") ? inputProps(a) : inputPlain(a);
  return inputNum(a, min, max, step, getV, setV, defVal, opts);
}

export function inputProps(props) {
  props = props || {};
  var row;
  if (props.num) {
    var n = props.num;
    var sliderOn = n.slider !== false;   // slider is a sub-property of num: it only toggles drag capture
    var sOpts = { exp: n.exp, noTrack: !sliderOn, int: n.int };
    row = inputNum(props.label || "", n.min, n.max, n.step, props.get, props.set, n.default, sOpts);
  } else {
    row = inputPlain(props.placeholder, props.label);
  }
  inputValueAlign(row, props.valueAlign);   // default "right"
  var iconLeft = props.leftIcon ? attachIcon(row, props.leftIcon, "left") : null;
  var iconRight = props.rightIcon ? attachIcon(row, props.rightIcon, "right") : null;
  if (props.hasMenu && props.menu) { row._pendingMenu = props.menu; row._pendingMenuIcon = iconRight || iconLeft; }
  return row;
}

// Align the value within the row (same in both modes; default "right").
export function inputValueAlign(row, align) {
  align = align || "right";
  var head = row.querySelector(".sihead");
  if (head) {
    var lab = head.querySelector(".lb");
    if (align === "right") { if (lab) lab.style.flex = ""; head.style.justifyContent = ""; }
    else { if (lab) lab.style.flex = "0 1 auto"; head.style.justifyContent = align === "center" ? "center" : "flex-start"; }
    return;
  }
  var clab = row.querySelector(".clab"); if (clab) clab.style.flex = "0 0 auto";
  var inp = row.querySelector(".cinp");
  if (inp) { inp.style.flex = "1 1 0"; inp.style.textAlign = align; }
}

// Decorative hint icon on an Input row — no behaviour (menu/click live separately, see menu.js's attachMenu).
export function attachIcon(row, iconSvg, side) {
  var ico = document.createElement("span"); ico.className = "blendico"; ico.innerHTML = iconSvg;
  var _bh = row._badgeHost || row;
  if (side === "left") _bh.insertBefore(ico, _bh.firstChild); else _bh.appendChild(ico);
  return ico;
}

export function inputPlain(placeholder, label) {
  var c = document.createElement("div"); c.className = "uicell"; c.style.cursor = "text";
  if (label) { var lab = document.createElement("span"); lab.className = "clab"; lab.textContent = label; c.appendChild(lab); }
  var i = document.createElement("input"); i.type = "text"; i.className = "cinp"; i.placeholder = placeholder; i.spellcheck = false;
  // click anywhere in the cell (including padding and label) focuses the one-line input — easy to
  // miss otherwise. A miss also selects the whole value when the flag is on: there is no text under
  // the cursor to place a caret in, and the flag promises "click the input", not "click the field".
  c.addEventListener("pointerdown", function (e) {
    if (e.target === i) return;
    e.preventDefault(); i.focus(); if (selectAllOnClick) i.select();
  });
  // click into the field itself: select all on click (default) or leave the native caret placement —
  // same mechanism as inputNum below (preventDefault before the browser plants a caret, then take
  // over focus/select ourselves; skipped once already focused, so re-clicking can still reposition).
  i.addEventListener("pointerdown", function (e) {
    if (selectAllOnClick && document.activeElement !== i) { e.preventDefault(); i.focus(); i.select(); }
  });
  c.appendChild(i); c._input = i; return c;
}

export function inputNum(label, min, max, step, getV, setV, defVal, opts) {
  opts = opts || {};
  var row = document.createElement("div"); row.className = "cell uislider";
  var head = document.createElement("div"); head.className = "sihead";
  var lab = document.createElement("span"); lab.className = "lb"; lab.innerHTML = dimLabelHTML(label); lab.title = label;
  // arrow paging: plain arrow = the declared step, Shift = ×10 (coarse), Alt = ÷10 (fine).
  var st = parseFloat(step) || 1, coarse = st * 10, fine = opts.int ? 1 : st / 10, grid = fine;
  var dec = opts.int ? 0 : stepDec(step) + 1;
  // exponential (power) response: fine near the low end, coarse near the top. Positive ranges only.
  var isExp = !!opts.exp && max > min, EG = (typeof opts.exp === "number") ? opts.exp : 3;
  function p2v(p) { return expP2V(min, max, EG, p); }
  function v2p(v) { return expV2P(min, max, EG, v); }
  var track = document.createElement("div"); track.className = "sitrack";
  if (opts.noTrack) track.classList.add("notrack");   // visibility:hidden — track hidden and click-through, layout unchanged
  var inp = document.createElement("input"); inp.type = "range"; inp.tabIndex = -1;
  if (isExp) { inp.min = 0; inp.max = 1; inp.step = 0.0005; } else { inp.min = min; inp.max = max; inp.step = fine; }
  if (min < 0) inp.classList.add("nofill");   // two-sided slider — no fill line
  // For an exp slider input.min/max is POSITION (0..1), so fillRange cannot find zero from them;
  // a signed exp scale puts zero exactly mid-travel (p=0.5), so tell fillRange that explicitly.
  if (isExp && min < 0) inp.dataset.zeroPos = "50";
  var num = document.createElement("input"); num.type = "text"; num.className = "pv"; num.inputMode = "decimal"; num.spellcheck = false;
  // hide trailing zero decimals: 16.0→16, 1.00→1, 0.50→0.5; two-sided positives get an explicit "+"
  function fmt(x) { if (opts.fmt) return opts.fmt(x); var s = dec ? Number(x).toFixed(dec).replace(/\.?0+$/, "") : String(Math.round(x)); return (min < 0 && x > 0 ? "+" : "") + s; }
  function show() { var v = getV(); var cl = Math.max(min, Math.min(max, v)); inp.value = isExp ? v2p(cl) : cl; num.value = fmt(v); num.size = Math.max(1, String(num.value).length); fillRange(inp); }
  function set(v) { if (isNaN(v)) { show(); return; } setV(parseFloat((Math.round(v / grid) * grid).toFixed(6))); show(); }
  function stepBy(dir, alt, shift) { set(getV() + dir * (alt ? fine : (shift ? coarse : st))); }
  show();
  inp.addEventListener("input", function () { setV(isExp ? p2v(parseFloat(inp.value)) : parseFloat(inp.value)); num.value = fmt(getV()); fillRange(inp); });
  // dbl-click resets to the default (two-sided sliders reset to 0). After reset we blur the field.
  dblTap(row);   // finger: synthesize dblclick — reset would otherwise be mouse-only
  row.addEventListener("dblclick", function () {
    if (!dblResetInput) return;
    set(min < 0 ? 0 : (defVal != null ? defVal : min));
    num.blur();
  });
  // slider keys (focused via click): ←↓ decrease, →↑ increase; Shift = ×10, Alt = ÷10
  inp.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); stepBy(-1, e.altKey, e.shiftKey); }
    else if (e.key === "ArrowUp") { e.preventDefault(); stepBy(1, e.altKey, e.shiftKey); }
  });
  // click into the value: select it all (default) or place the caret at the click point, per the
  // selectAllOnClick flag; keyboard focus (Tab/↑↓) always selects all, regardless of the flag.
  // Native mousedown sets focus AND plants the caret at the click point synchronously as part of its
  // own default action — calling select() from the "focus" handler races that and can lose, so when
  // selecting on click we preventDefault() first (cancelling the native placement entirely) and take
  // over focus/select ourselves. Skipped once already focused, so a second click can still reposition.
  var byMouse = false;
  num.addEventListener("pointerdown", function (e) {
    byMouse = true; setTimeout(function () { byMouse = false; }, 0);
    if (selectAllOnClick && document.activeElement !== num) { e.preventDefault(); num.focus(); num.select(); }
  });
  num.addEventListener("focus", function () { if (!byMouse) num.select(); });
  // The typed value may be an arithmetic expression ("1920/2", "(8+2)*4"), evaluated here; a bad
  // expression is NaN, which set() reverts. See kit/expr.js and decisions/input-expr-no-eval.md.
  num.addEventListener("change", function () { set(evalExpr(num.value)); });
  num.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); set(evalExpr(num.value)); num.blur(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); stepBy(1, e.altKey, e.shiftKey); }
    else if (e.key === "ArrowDown") { e.preventDefault(); stepBy(-1, e.altKey, e.shiftKey); }
    // ←/→ — native caret movement in the field
  });
  // Hit zone "drag from anywhere": the slider jumps on click and drags from any point of the cell;
  // the native input only draws the track/thumb and handles keys.
  inp.style.pointerEvents = "none";
  if (!opts.noTrack) {
    row.addEventListener("pointerdown", function (e) {
      if (e.button || e.altKey || (e.target.closest && e.target.closest(".srnd"))) return;   // right button — not a slider gesture
      e.preventDefault();
      if (e.pointerType === "touch") {
        gestureArbiter(e, row, startSlide, function () { num.focus(); if (selectAllOnClick && num.select) num.select(); });
        return;
      }
      startSlide(e);
      // Slider changes ONLY by dragging (3px threshold; a tap without motion = focus the field); the
      // value does not jump to the click point. Recomputed from the LIVE getV() each step, so it
      // self-corrects if the value is changed externally mid-drag.
      function startSlide(e) {
        var sx = e.clientX, sy = e.clientY, engaged = false, gx = sx, r = inp.getBoundingClientRect();
        function mv(ev) {
          if (!engaged) { if (Math.abs(ev.clientX - sx) < 3) return; engaged = true; gx = ev.clientX; }
          if (!r.width) r = inp.getBoundingClientRect(); if (!r.width) return;
          var cur = Math.max(min, Math.min(max, getV()));
          var p = isExp ? v2p(cur) : (max > min ? (cur - min) / (max - min) : 0);
          p += (ev.clientX - gx) / r.width * scrubK(ev.clientY - sy); gx = ev.clientX;
          p = p < 0 ? 0 : (p > 1 ? 1 : p);
          setV(isExp ? p2v(p) : (min + (max - min) * p)); show();
        }
        function up(ev) {
          document.removeEventListener("pointermove", mv, true);
          document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", up, true);
          if (!engaged && ev && ev.type !== "pointercancel") { num.focus(); if (selectAllOnClick && num.select) num.select(); }
        }
        document.addEventListener("pointermove", mv, true);
        document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", up, true);
      }
    });
  } else {
    // Slider off — there is no row interceptor, so a click that misses the field (label, padding,
    // the track's place) natively does nothing. The flag promises "click the input", so we carry
    // the miss into the value ourselves — exactly like a tap without motion in slider mode above.
    row.addEventListener("pointerdown", function (e) {
      if (e.button || e.altKey || e.target === num || (e.target.closest && e.target.closest(".srnd"))) return;   // right button, Alt, the field itself and head buttons — not our case (Alt is left alone, same as the slider branch)
      if (!selectAllOnClick) return;   // off — previous behaviour: a miss does nothing
      e.preventDefault(); num.focus(); num.select();
    });
  }
  if (!opts.hideLabel) head.appendChild(lab); else head.style.justifyContent = "center";
  if (opts.extra) head.appendChild(opts.extra); head.appendChild(num);
  row.appendChild(head);
  track.appendChild(inp); row.appendChild(track);   // track always in DOM — cell size independent of noTrack
  row._set = set; row._refresh = show; row._badgeHost = head;
  return row;
}
