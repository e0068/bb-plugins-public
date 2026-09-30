// kit/menu.js — the one dropdown-menu popup used by Button(hasMenu), Input(hasMenu) and direct calls.
// Ported from public/cellular.js:389-447 (uiMenu).
//
// The studio's panelStruct/itemStruct arguments (which stamp .org-node/.st-<id> presenter classes)
// are NOT ported: those are lab-presenter theming hooks, not component behaviour
// (decisions/component-factory-inventory.md, "отсечь хуки презентера").
//
// menu = {title, cols, items, current, onSelect}. An item is one of:
//   {label, icon, title, onSelect}                                   — plain button, click → onSelect(item,i)
//   {type:"segment", options, current, onSelect}                      — segment row, does NOT close the menu
//   {type:"slider", label, icon, min, max, step, int, value, onInput} — slider row (Input num mode)
//   {type:"switch", label, value, onSelect}                          — switch row, does NOT close the menu
// guardEl — while it holds focus, an outside click does not close the menu (Input keeps it open
// while the value field is focused).
import { placePopup } from "./popup.js";
import { escHTML } from "./text.js";
import { segment } from "./segment.js";
import { input } from "./input.js";
import { toggle } from "./switch.js";

export function uiMenu(anchor, menu, guardEl) {
  var panel = null;
  function closeP() { if (!panel) return; panel.remove(); panel = null; document.removeEventListener("pointerdown", onOutside, true); }
  function onOutside(e) {
    if (!panel || panel.contains(e.target) || anchor.contains(e.target)) return;
    if (guardEl && document.activeElement === guardEl) return;
    closeP();
  }
  function openP() {
    if (panel) return;
    var r = anchor.getBoundingClientRect();
    panel = document.createElement("div"); panel.className = "lfomenu" + (menu.cols === 2 ? " cols2" : "");
    if (menu.title) { var hd = document.createElement("div"); hd.className = "mmhd"; hd.textContent = menu.title; panel.appendChild(hd); }
    var cur = menu.current;   // read once on open, not per item
    (menu.items || []).forEach(function (it, oi) {
      // A segment item does NOT close the menu (it refines neighbouring items).
      if (it.type === "segment") {
        panel.appendChild(segment(it.options || [], it.current || 0, function (k) { if (it.onSelect) it.onSelect(k); }));
        return;
      }
      if (it.type === "slider") {
        // A slider item is a plain Input in number mode; its icon goes to leftIcon.
        var v = it.value != null ? it.value : (it.min || 0);
        var row = input({ leftIcon: it.icon || null, label: it.label || "",
          num: { min: it.min != null ? it.min : 0, max: it.max != null ? it.max : 100, step: it.step || 1, default: v, slider: true, int: it.int },
          get: function () { return v; }, set: function (nv) { v = nv; if (it.onInput) it.onInput(nv); } });
        panel.appendChild(row);
        return;
      }
      // A switch item does NOT close the menu (it reveals/hides items below it).
      if (it.type === "switch") {
        panel.appendChild(toggle(it.label || "", function () { return !!it.value; }, function (v) { if (it.onSelect) it.onSelect(v); }));
        return;
      }
      var bt = document.createElement("button"); bt.type = "button";
      if (it.icon) bt.innerHTML = '<span class="blendico">' + it.icon + '</span><span class="lbl">' + escHTML(it.label || "") + '</span>';
      else bt.textContent = it.label || "";
      if (it.title) bt.title = it.title;
      if (oi === cur) bt.classList.add("on");
      bt.addEventListener("click", function (e) { e.stopPropagation(); closeP(); if (it.onSelect) it.onSelect(it, oi); else if (menu.onSelect) menu.onSelect(it, oi); });
      panel.appendChild(bt);
    });
    document.body.appendChild(panel);
    placePopup(panel, r.left, r.bottom + 4, r.top);
    setTimeout(function () { document.addEventListener("pointerdown", onOutside, true); }, 0);
  }
  return {
    open: openP, close: closeP, toggle: function () { panel ? closeP() : openP(); },
    isOpen: function () { return !!panel; }, contains: function (n) { return !!panel && panel.contains(n); }
  };
}

// Attach a dropdown menu to any row that carries a value field: the field itself is the primary
// trigger (focus opens); an icon, if present, is an additional trigger. Ported from
// cellular.js:450-469. Lives here (not in input.js) so Input never has to import Menu — see
// decisions/kit-input-menu-cycle.md; kit/index.js calls this for input(props.hasMenu).
export function attachMenu(row, menu, icon) {
  var pv = row.querySelector(".pv") || row.querySelector(".cinp");
  var mp = uiMenu(row, menu, pv);
  if (pv) {
    pv.addEventListener("focus", function () { mp.open(); });
    pv.addEventListener("blur", function (e) { var next = e.relatedTarget; if (mp.isOpen() && !(mp.contains(next) || row.contains(next))) mp.close(); });
  }
  if (icon) {
    icon.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); });
    icon.addEventListener("click", function (e) { e.stopPropagation(); mp.toggle(); });
  }
}
