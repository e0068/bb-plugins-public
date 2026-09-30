// kit/button.js — Button (always interactive). Ported from public/cellular.js:702-731 (uiButtonProps),
// with the accessibility gap closed: the studio built a clickable div.uicell.act WITHOUT role /
// tabindex / keyboard, so the external Button was LESS accessible than the internal uiCell (which
// does add them). Here the cell carries role="button", tabindex=0, and Enter/Space activation — the
// same floor uiCell guarantees — so click and keyboard drive one shared `activate()`.
//
// One layout for any props: [leftIcon] label … value [rightIcon] (+ optional switch knob). Button's
// markup differs from uiCell (leftIcon/.cval/switch knob), so it hand-builds the cell but shares the
// a11y floor via makeActivatable — the one definition both Button and uiCell call.
// `toggle` and `hasMenu` are click BEHAVIOUR, not different markup; both may be set at once.
//   · toggle:true   — click flips the button's pressed state (class .on), driven by get/set
//   · hasMenu:true  — click opens the popup menu (props.menu)
// `active=off`→Cell is deferred (first-iteration-scope): the Button is always interactive.
import { uiMenu } from "./menu.js";
import { makeActivatable } from "./cell.js";

export function button(props) {
  if (!props || typeof props !== "object") throw new TypeError("button(props): props object required");
  var cell = document.createElement("div");
  cell.className = "uicell act";
  if (props.title || props.label) cell.title = props.title || props.label;
  if (props.leftIcon) { var li = document.createElement("span"); li.className = "blendico"; li.innerHTML = props.leftIcon; cell.appendChild(li); }
  var lab = document.createElement("span"); lab.className = "clab"; lab.textContent = props.label || ""; cell.appendChild(lab);
  var val = document.createElement("span"); val.className = "cval"; cell.appendChild(val);
  if (props.rightIcon) { var ri = document.createElement("span"); ri.className = "cch"; ri.innerHTML = props.rightIcon; cell.appendChild(ri); }
  // showSwitch — a switch visual on a toggle button (same .switch markup as the Switch component),
  // purely reflecting state: the whole cell handles the click, the knob itself catches no events.
  var swKnob = null, swCb = null;
  if (props.showSwitch) {
    swKnob = document.createElement("span"); swKnob.className = "switch"; swKnob.style.pointerEvents = "none";
    swCb = document.createElement("input"); swCb.type = "checkbox"; swCb.tabIndex = -1;
    var swTr = document.createElement("span"); swTr.className = "track";
    swKnob.appendChild(swCb); swKnob.appendChild(swTr); cell.appendChild(swKnob);
  }
  var mp = (props.hasMenu && props.menu) ? uiMenu(cell, props.menu) : null;
  function refresh() {
    val.textContent = props.value != null ? props.value : "";
    var on = props.get ? !!props.get() : false;
    if (props.toggle) cell.classList.toggle("on", on);
    if (swCb) swCb.checked = on;
  }
  refresh();
  function activate() {
    if (props.toggle && props.set && props.get) { props.set(!props.get()); refresh(); }
    if (mp) mp.toggle();
    if (props.onClick) props.onClick();
  }
  // Accessibility floor the studio div lacked (role/tabindex/keyboard) — shared with uiCell.
  makeActivatable(cell, activate);
  cell._refresh = refresh;
  return cell;
}
