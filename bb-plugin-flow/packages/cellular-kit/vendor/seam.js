// kit/seam.js — the theming seam (layer 4). Generates the STATIC CSS bridge that lets a baked
// theme paint the kit's components: `.cl-<id> { --cell-<x>: var(--cl-<id>-<y>); … }`.
//
// Why a bridge exists (decisions/theme-component-seam, theme-seam-model-invariant): a consumer runs
// CellularModel.applyBaked, which sets the portable `--cl-<id>-*` contract (EMBEDDING.md) on :root,
// and adds the scope class `.cl-<id>` to a kit component. The kit's components read their own
// internal `--cell-*`. This bridge is the ONLY thing that connects the two — without it the package
// ships unpaintable. It is theme-INVARIANT: it depends only on the SET of model structure ids and
// the component `--cell-*` contract, never on a specific baked file's values, so it is generated once
// (at package build, per id set), not per baked theme.
//
// Names: the consumer-facing baked keys (EMBEDDING.md "The CSS variable contract") mostly match the
// component `--cell-*` suffixes 1:1, EXCEPT two the model spells differently — `font-weight` and
// `text-color` — where the flat component name is `weight` / `text`. BRIDGE_RENAME captures exactly
// those two; every other channel is identity. This mirrors public/cellular-model.js's CHROME_TO_CANON
// (cellSuffix → bakedKey), and test/kit/seam.test.js asserts the two stay in sync so they cannot drift.
//
// NOT bridged in iteration 1: `font-family`. The model bakes --cl-<id>-font-family (EMBEDDING.md) but
// the kit components use `font: inherit` and read no --cell-font-family, so a themed typeface does not
// reach them yet. Deliberate scope cut (a themed font face is a later increment), not a silent gap —
// there is no --cell-font-family read for the completeness gate to flag.

// Base themed channels the components read (flat --cell-<suffix>) → baked key (--cl-<id>-<key>).
// Identity unless listed in BRIDGE_RENAME. This IS the component theming contract: every entry here
// is a --cell-* a component reads AND a channel the model emits.
export var BRIDGE_RENAME = Object.freeze({ weight: "font-weight", text: "text-color" });

export var THEMED_CHANNELS = Object.freeze([
  "bg", "shadow", "gloss", "radius", "gap", "pad-x", "pad-y",
  "weight", "font-size", "line-height", "track", "case", "text"
]);

// Channels that also carry static state variants the components read (--cell-<x>-hover / -focus).
// Only `bg` and `gloss`: the iteration-1 components animate hover/focus via background + inset gloss
// (kit/components.css:96-98) — the outer shadow is a resting container drop-shadow (css:168) with NO
// state variant, so `shadow` is not here (bridging --cell-shadow-hover would map something nothing
// reads). `disabled` is likewise absent: the components have no disabled visual state (the known
// disabled→resting gap, project-readiness-review). States expand only where a component reads them —
// test/kit/seam-completeness.test.js pins this SET to the CSS's actual reads.
export var STATE_CHANNELS = Object.freeze(["bg", "gloss"]);
export var CHANNEL_STATES = Object.freeze(["hover", "focus"]);

function bakedKey(suffix) { return BRIDGE_RENAME[suffix] || suffix; }

// Every --cell-* the bridge produces for one structure — base channels plus the state variants.
// (The set the completeness gate compares against the components' reads.)
export function bridgedCellVars() {
  var out = THEMED_CHANNELS.slice();
  STATE_CHANNELS.forEach(function (c) { CHANNEL_STATES.forEach(function (s) { out.push(c + "-" + s); }); });
  return out;
}

// The bridge declarations for one structure id (array of [cellVar, cssValue]).
// Each declaration falls back to the package default (--cell-<x>-default in kit/components.css) when
// the theme omits that channel. This fallback is ESSENTIAL, not decorative: a `.cl-<id>` rule
// REDECLARES --cell-<x> on the scope, so without a fallback an omitted channel makes --cell-<x>
// guaranteed-invalid ON THE SCOPE — overriding the :root default — and the component drops to the CSS
// initial value (transparent bg, 0 radius, 16px text), NOT the package default. The fallback target
// is --cell-<x>-default (which the scope never redeclares), because falling back to var(--cell-<x>)
// itself would be a self-reference cycle. Net: on any scope, --cell-<x> = theme-value OR package-default.
function bridgeDecl(id, cellVar, bakedVar) {
  return ["--cell-" + cellVar, "var(--cl-" + id + "-" + bakedVar + ", var(--cell-" + cellVar + "-default))"];
}
export function bridgePairs(id) {
  var pairs = [];
  THEMED_CHANNELS.forEach(function (suffix) {
    pairs.push(bridgeDecl(id, suffix, bakedKey(suffix)));
  });
  STATE_CHANNELS.forEach(function (suffix) {
    CHANNEL_STATES.forEach(function (state) {
      pairs.push(bridgeDecl(id, suffix + "-" + state, bakedKey(suffix) + "-" + state));
    });
  });
  return pairs;
}

// Generate the full static bridge stylesheet for a set of structure ids.
// ids: array of strings (the model's structure ids, e.g. ["stBtn","stCard"]).
export function bridgeCSS(ids) {
  if (!Array.isArray(ids)) throw new TypeError("bridgeCSS(ids): array of structure ids required");
  return ids.map(function (id) {
    var body = bridgePairs(id).map(function (p) { return "  " + p[0] + ": " + p[1] + ";"; }).join("\n");
    return ".cl-" + id + " {\n" + body + "\n}";
  }).join("\n\n") + "\n";
}
