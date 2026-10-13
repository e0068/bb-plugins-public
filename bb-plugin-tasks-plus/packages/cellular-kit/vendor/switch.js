// kit/switch.js — Switch (toggle) cell. Ported from public/cellular.js:761-773.
// Toggle is a part of the component set (a Button can also show a switch knob) — this is the
// standalone Switch used directly and as a menu item.
//
// Two call forms, like the other components:
//  · toggle(label, getV, setV)        — array form
//  · toggle({label, get, set})        — props form (Switch taxonomy: label only)

export function toggle(a, getV, setV) {
  if (arguments.length <= 1 && a && typeof a === "object") return toggleBase(a.label || "", a.get, a.set);
  return toggleBase(a, getV, setV);
}

export function toggleBase(label, getV, setV) {
  var row = document.createElement("label"); row.className = "cell uiswitch";
  var lab = document.createElement("span"); lab.className = "tglab"; lab.textContent = label;
  var sw = document.createElement("span"); sw.className = "switch";
  var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = getV();
  var tr = document.createElement("span"); tr.className = "track";
  cb.addEventListener("change", function () { setV(cb.checked); });
  sw.appendChild(cb); sw.appendChild(tr); row.appendChild(lab); row.appendChild(sw); return row;
}
