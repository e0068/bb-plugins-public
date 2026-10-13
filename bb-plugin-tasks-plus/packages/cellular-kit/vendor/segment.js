// kit/segment.js — Segment control: a group of mutually-exclusive toggle buttons, exactly one active.
// Ported from public/cellular.js:782-806. Fully self-contained — zero H.*/DS.* dependencies.
//
// Two call forms, like the other components:
//  · segment(opts, cur, onSet)                         — array form: opts[i] = {html}|{text} (+title)
//  · segment({items:[{label,icon}], value, onSelect})  — props form (Segment taxonomy: count + label/icon)
import { escHTML } from "./text.js";

export function segment(a, cur, onSet) {
  if (arguments.length <= 1 && a && typeof a === "object" && !Array.isArray(a)) {
    var items = (a.items || []).map(function (it) {
      var ic = it.icon || "";
      if (!ic) return { text: it.label || "", title: it.label || "" };
      return { html: ic + (it.label ? '<span style="margin-left:4px">' + escHTML(it.label) + '</span>' : ""), title: it.label || "" };
    });
    var g = segmentBase(items, a.value || 0, a.onSelect || function () {});
    if (a.col) g.classList.add("col");   // vertical stack of buttons
    return g;
  }
  return segmentBase(a, cur, onSet);
}

export function segmentBase(opts, cur, onSet) {
  var grp = document.createElement("div"); grp.className = "cell uisegment";
  opts.forEach(function (o, v) {
    var b = document.createElement("button"); b.type = "button";
    if (v === cur) b.className = "on";
    if (o.html != null) b.innerHTML = o.html; else b.textContent = o.text != null ? o.text : "";
    if (o.title) b.title = o.title;
    b.addEventListener("click", function () {
      [].forEach.call(grp.children, function (x) { x.classList.remove("on"); });
      b.classList.add("on"); onSet(v);
    });
    grp.appendChild(b);
  });
  return grp;
}
