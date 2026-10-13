// kit/cell.js — the base cell primitive every component sits on. Ported from public/cellular.js:
// uiRow (949) and uiCell (954-977).
//
// A clickable cell (`act`) is a <div>, so on its own it is "generic" to a screen reader and skipped
// by the keyboard. makeActivatable adds exactly what a <button> gives for free — role="button",
// tabindex, and Enter/Space activation — without changing the tag (nested cells inside other
// interactive cells must stay valid HTML, not "button in a button"). This is the ONE place that
// floor is defined: uiCell here and Button (kit/button.js) both call it, so the studio a11y gap the
// Ф2 gate closes cannot drift between them.

export function uiRow() { var r = document.createElement("div"); r.className = "uirow"; return r; }

// Give a clickable <div> the accessibility floor of a <button>: announce its role, put it in the tab
// order, and activate `handler` on click and on Enter/Space (Space default-prevented so it does not
// scroll the page). `handler` receives the triggering event.
export function makeActivatable(el, handler) {
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("click", handler);
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); handler(e); }
  });
}

// o = {label, value, head, act, icon, title}. `act` (a click handler) marks the cell interactive.
export function uiCell(o) {
  o = o || {};
  var c = document.createElement("div"); c.className = "uicell" + (o.head ? " chead" : "") + (o.act ? " act" : "");
  if (o.title) c.title = o.title;
  var l = document.createElement("span"); l.className = "clab"; l.textContent = o.label || ""; c.appendChild(l);
  if (o.value != null) { var v = document.createElement("span"); v.className = "cval"; v.textContent = o.value; c.appendChild(v); }
  if (o.icon) { var i = document.createElement("span"); i.className = "cch"; i.innerHTML = o.icon; c.appendChild(i); }
  if (o.act) makeActivatable(c, o.act);
  c._lab = l; return c;
}
