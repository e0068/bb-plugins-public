// kit/gesture.js — pointer-gesture helpers for the Input slider (touch scrubbing vs page scroll).
// Ported from public/cellular.js (dblTap ← cellular-host.js:73-85; GEST_SLOP/scrollerOf/glide/
// gestureArbiter ← cellular.js:488-535). DOM/touch — exercised by the browser gate, not Node.

// Double tap (finger) → synthesize dblclick, so value-reset works without a mouse.
export function dblTap(el) {
  var t0 = 0, x0 = 0, y0 = 0;
  el.addEventListener("pointerup", function (e) {
    if (e.pointerType !== "touch") return;
    var now = e.timeStamp || 0;
    if (now - t0 < 320 && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) < 24) {
      t0 = 0;
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
      return;
    }
    t0 = now; x0 = e.clientX; y0 = e.clientY;
  });
}

// Dead zone before a finger gesture commits to "slide" vs "scroll" — see gestureArbiter.
export var GEST_SLOP = 24;

// Nearest vertically-scrollable ancestor (so we can hand a rejected slide gesture back to scrolling).
export function scrollerOf(el) {
  for (var n = el; n && n !== document.body; n = n.parentElement) {
    var ov = getComputedStyle(n).overflowY;
    if ((ov === "auto" || ov === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

// Inertial fling after release — without it, hand-driven scrolling feels dead.
export function glide(sc, v) {
  if (Math.abs(v) < 0.02) return;
  var raf = 0;
  (function step() {
    sc.scrollTop -= v * 16; v *= 0.94;
    if (Math.abs(v) > 0.02) raf = requestAnimationFrame(step); else cancelAnimationFrame(raf);
  })();
}

// Arbitrate a finger gesture on a slider row: stay silent for GEST_SLOP px, then compare |dx|/|dy|
// and lock the decision until release (it never hops back). onSlider drives the value; onTap is the
// mandatory third branch for a gesture that ends before ever passing the slop (a plain tap).
export function gestureArbiter(e, row, onSlider, onTap) {
  var sx = e.clientX, sy = e.clientY, decided = null, sc = null, lastY = sy, lastT = e.timeStamp, vy = 0;
  function off() {
    document.removeEventListener("pointermove", mv, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", up, true);
  }
  function mv(ev) {
    if (!decided) {
      var dx = Math.abs(ev.clientX - sx), dy = Math.abs(ev.clientY - sy);
      if (dx < GEST_SLOP && dy < GEST_SLOP) return;
      if (dx >= dy) { decided = "slide"; off(); onSlider(ev); return; }
      decided = "scroll"; sc = scrollerOf(row); lastY = ev.clientY; lastT = ev.timeStamp;
      return;
    }
    if (!sc) return;
    var d = ev.clientY - lastY, dt = Math.max(1, ev.timeStamp - lastT);
    vy = d / dt; lastY = ev.clientY; lastT = ev.timeStamp;
    sc.scrollTop -= d;
  }
  function up(ev) {
    off();
    var cancelled = ev && ev.type === "pointercancel";
    if (!decided) { if (!cancelled && onTap) onTap(ev); return; }
    if (decided === "scroll" && sc && !cancelled) glide(sc, vy);
  }
  document.addEventListener("pointermove", mv, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
}
