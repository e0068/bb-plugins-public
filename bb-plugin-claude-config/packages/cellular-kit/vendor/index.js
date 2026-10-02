// kit/index.js — the kit's public ESM entry point. Single import surface for consumers.
//
// Components (layer 2, port of the four DS factories + their shared helpers):
export { button } from "./button.js";
import { input as inputCore, inputProps as inputPropsCore, inputPlain, inputValueAlign, attachIcon, setDblResetInput, setSelectAllOnClick } from "./input.js";
import { uiMenu, attachMenu } from "./menu.js";
export { inputPlain, inputValueAlign, attachIcon, setDblResetInput, setSelectAllOnClick };
export { uiMenu, attachMenu };

// input.js and menu.js each stay a one-way dependency (menu.js imports input.js for its
// {type:"slider"} items) — this is the one place allowed to know about both, so hasMenu
// composition (input.js stashes it on the row as _pendingMenu/_pendingMenuIcon) happens here
// instead of inside input.js. See decisions/kit-input-menu-cycle.md.
function withMenu(row) {
  if (row && row._pendingMenu) {
    attachMenu(row, row._pendingMenu, row._pendingMenuIcon);
    row._pendingMenu = null; row._pendingMenuIcon = null;
  }
  return row;
}
// input.js's `input()` dispatches on arguments.length (plain/props/positional-numeric forms) — a
// wrapper with a fixed parameter list would always forward the full arity and break that dispatch,
// so forward args as given instead.
export function input(...args) {
  return withMenu(inputCore(...args));
}
export function inputProps(props) {
  return withMenu(inputPropsCore(props));
}

export { segment, segmentBase } from "./segment.js";
export { toggle, toggleBase } from "./switch.js";
export { swatch, colorCell, buildPicker, openPicker, closePicker } from "./swatch.js";
export { uiCell, uiRow, makeActivatable } from "./cell.js";

// Theming seam (layer 4): generate the static .cl-<id> CSS bridge for a set of model structure ids.
export { bridgeCSS, bridgePairs, bridgedCellVars, THEMED_CHANNELS } from "./seam.js";

// Theme runtime (layer 4): the consumer path that turns a baked theme into the --cl-<id>-* contract.
// Re-exported through the kit's ESM facade so the bundle is self-contained — no separate <script>
// from /public. Runtime lives in ./cellular-model.js (byte-copy of public/); see ./model.js.
export { applyBaked, driveBaked, toDesignTokens, bake } from "./model.js";

// Pure utility layers (layers 0–1): safe to import anywhere, no DOM, no import-time side effects.
export * from "./utils.js";
export * from "./color.js";
export * from "./slider-math.js";
export * from "./expr.js";
export * from "./text.js";
