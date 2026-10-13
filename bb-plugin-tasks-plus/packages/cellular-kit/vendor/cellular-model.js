/* cellular-model.js — Cellular model layer (Structures + Styles).
 *
 * Pure, dependency-free resolution / bake / apply / tokens for the CURRENT model
 * (the one authored in lab.html). NO dependency on window.Cellular, NO DOM at the
 * core — so it runs in the browser AND in Node (unit-testable). Only the two
 * consumer entry points that write to the page (applyBaked with a target, driveBaked)
 * touch the DOM, and both guard for it.
 *
 * Three roles:
 *   bake(model)            author side  → a flat, resolved "cellular.baked" object
 *   applyBaked(baked,opts) consumer     → CSS custom properties  (--cl-<id>-*)
 *   toDesignTokens(baked)  consumer     → W3C Design Tokens (DTCG) document
 *   driveBaked(baked,opts) consumer     → live parametric tick (cursor / LFO)
 *
 * The runtime resolves nothing structural: bake() flattens the branch model
 * (refs + inheritance + per-property deltas) into final values in the configurator;
 * the consumer only lays them onto CSS variables. The one thing computed on the
 * client is parametric modulation (cursor / LFO) — an opt-in, additive layer.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.CellularModel = api; if (root.Cellular) root.Cellular.model = api; }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  "use strict";

  var BAKED_FORMAT = "cellular.baked", BAKED_VERSION = 2;

  // ============================= color math =============================
  // Self-contained ports of cellular.js (hexRGBA/shade/hueRotate) so the module
  // needs no window.Cellular — identical formulas, kept byte-faithful on purpose.
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function hexRGBA(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex;
    var n = parseInt(m[1], 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + (a == null ? 1 : +(+a).toFixed(3)) + ")";
  }
  function shade(hex, amt) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex;
    var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255];
    var t = amt >= 0 ? 255 : 0, f = Math.min(1, Math.abs(amt));
    return "#" + c.map(function (x) { return ("0" + Math.round(x + (t - x) * f).toString(16)).slice(-2); }).join("");
  }
  function hueRotate(hex, deg) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m || !deg) return hex;
    var n = parseInt(m[1], 16), r0 = (n >> 16 & 255) / 255, g0 = (n >> 8 & 255) / 255, b0 = (n & 255) / 255;
    var mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0) : mx === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4;
      h /= 6;
    }
    h = (h + deg / 360) % 1; if (h < 0) h += 1;
    function h2(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return "#" + [h2(p, q, h + 1 / 3), h2(p, q, h), h2(p, q, h - 1 / 3)].map(function (x) { return ("0" + Math.round(x * 255).toString(16)).slice(-2); }).join("");
  }
  // rgba(...)/#rrggbb → #rrggbbaa (for DTCG color tokens, which want a single hex value).
  function toHex8(css) {
    var h = /^#?([0-9a-f]{6})$/i.exec(css || "");
    if (h) return "#" + h[1].toLowerCase() + "ff";
    var r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css || "");
    if (!r) return css;
    function h2(x) { return ("0" + (x & 255).toString(16)).slice(-2); }
    var a = r[4] == null ? 1 : +r[4];
    return "#" + h2(+r[1]) + h2(+r[2]) + h2(+r[3]) + h2(Math.round(clamp01(a) * 255));
  }

  // ============================= model resolution =============================
  // A "model" M is { colors, sizes, typos, effects, structures } — the shape lab.html
  // persists. These mirror lab.html's resolver 1:1 (structRef / resolveProp / applyOp),
  // but take M explicitly instead of closing over it, so they're pure.

  function byId(list, id) { if (!list) return null; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  // nearest ancestor (incl. self) whose ref[slot] is set
  function structRef(M, id, slot) {
    var st = byId(M.structures, id), d = 0;
    while (st && d < 50) { if (st.ref && st.ref[slot] != null) return { id: st.ref[slot], owner: st, own: st.id === id }; st = st.parent ? byId(M.structures, st.parent) : null; d++; }
    return null;
  }
  function chainOf(M, stId) { var a = [], s = byId(M.structures, stId); while (s) { a.unshift(s); s = s.parent ? byId(M.structures, s.parent) : null; } return a; }
  function applyOp(base, ov) { base = (base == null ? 0 : base); var v = ov.val || 0; switch (ov.op) { case "add": return base + v; case "sub": return base - v; case "mul": return base * v; case "div": return v ? base / v : base; default: return v; } }

  function styleFieldVal(M, slot, id, field) {
    if (id == null) return null;
    if (slot === "size") { var z = byId(M.sizes, id); return z ? z[field] : null; }
    if (slot === "fill") { var c = byId(M.colors, id); return c ? (field === "__alpha" ? c.alpha : c[field]) : null; }
    if (slot === "typo") { var t = byId(M.typos, id); return t ? t[field] : null; }
    var e = byId(M.effects, id); if (!e) return null;
    if (field === "__alpha") { var col = byId(M.colors, e.color); return col ? col.alpha : null; }
    return e[field];
  }

  // property schema: key → {slot, field, transform}. Mirror of lab.html PROP_CATS.
  // transform props (bright/hue) are not style fields — base 0 (identity), deltas move them.
  var PROP = {
    "fill.alpha":  { slot: "fill", field: "__alpha" },
    "fill.bright": { transform: true },
    "fill.hue":    { transform: true },
    "size.radius": { slot: "size", field: "radius" },
    "size.gap":    { slot: "size", field: "gap" },
    "size.padX":   { slot: "size", field: "padX" },
    "size.padY":   { slot: "size", field: "padY" },
    "typo.weight":   { slot: "typo", field: "weight" },
    "typo.size":     { slot: "typo", field: "size" },
    "typo.lh":       { slot: "typo", field: "lh" },
    "typo.tracking": { slot: "typo", field: "tracking" },
    "eff.x":      { slot: "effectOuter", field: "x" },
    "eff.y":      { slot: "effectOuter", field: "y" },
    "eff.blur":   { slot: "effectOuter", field: "blur" },
    "eff.spread": { slot: "effectOuter", field: "spread" },
    "eff.alpha":  { slot: "effectOuter", field: "__alpha" }
  };

  // value of one property key for a structure: base (from the resolved style) + over-deltas up the chain.
  // THIS is the fix for the old bakeStructure bug — bake now goes through resolveProp (applies `over`),
  // instead of reading the style field directly and silently dropping branch deltas.
  function resolveProp(M, stId, key) {
    var prop = PROP[key];
    var v = prop.transform ? 0 : styleFieldVal(M, prop.slot, (function () { var r = structRef(M, stId, prop.slot); return r ? r.id : null; })(), prop.field);
    var chain = chainOf(M, stId);
    for (var i = 0; i < chain.length; i++) { var ov = chain[i].over && chain[i].over[key]; if (ov) v = applyOp(v, ov); }
    return v;
  }
  function resolveHex(M, stId, baseHex) { var h = baseHex, chain = chainOf(M, stId); for (var i = 0; i < chain.length; i++) { var ov = chain[i].over && chain[i].over["fill.hex"]; if (ov && ov.hex) h = ov.hex; } return h; }
  function colorCss(M, colorId) { var c = byId(M.colors, colorId); return c ? hexRGBA(c.hex, clamp01(c.alpha)) : "transparent"; }

  // ============================= assembly (channels → CSS) =============================
  // Shared by resting bake, static states, and the live parametric tick — one place that
  // turns a set of numeric channels into a CSS value, so all three stay consistent.
  function fillCss(ch) { var h = ch.hex; if (ch.bright) h = shade(h, ch.bright); if (ch.hue) h = hueRotate(h, ch.hue); var a = clamp01(ch.alpha == null ? 1 : ch.alpha); return a >= 1 ? h : hexRGBA(h, a); }
  function shadowCss(ch) { return (ch.kind === "inner" ? "inset " : "") + ch.x + "px " + ch.y + "px " + Math.max(0, ch.blur) + "px " + ch.spread + "px " + hexRGBA(ch.colorHex, clamp01(ch.alpha == null ? 1 : ch.alpha)); }
  function lhCss(v, unit) { return unit === "%" ? String(v / 100) : (v + "px"); }
  function trackCss(v, unit) { return unit === "%" ? ((v / 100) + "em") : (v + "px"); }

  // channel field a prop key drives, and the output CSS var it lands in
  var KEY_FIELD = { "fill.bright": "bright", "fill.hue": "hue", "fill.alpha": "alpha",
    "size.radius": "radius", "size.gap": "gap", "size.padX": "padX", "size.padY": "padY",
    "typo.weight": "weight", "typo.size": "size", "typo.lh": "lh", "typo.tracking": "tracking",
    "eff.x": "x", "eff.y": "y", "eff.blur": "blur", "eff.spread": "spread", "eff.alpha": "alpha" };
  var KEY_GROUP = {}, KEY_VAR = {};
  (function () {
    var v = { "size.radius": "radius", "size.gap": "gap", "size.padX": "pad-x", "size.padY": "pad-y",
      "typo.weight": "font-weight", "typo.size": "font-size", "typo.lh": "line-height", "typo.tracking": "track" };
    Object.keys(KEY_FIELD).forEach(function (k) { var g = k.split(".")[0]; KEY_GROUP[k] = g; KEY_VAR[k] = v[k] || (g === "fill" ? "bg" : g === "eff" ? "shadow" : k); });
  })();

  // Emit the CSS var(s) for one group from its channel object. Returns { varName: css }.
  function groupVars(group, ch, typo) {
    if (group === "fill") return ch.present ? { "bg": fillCss(ch) } : {};
    if (group === "eff") return ch.present ? { "shadow": shadowCss(ch) } : {};
    if (group === "size") { var o = {}; if (!ch.present) return o;   // clamp ≥0 to match lab presenter (a `sub`/negative delta must not emit -4px)
      if (ch.radius != null) o["radius"] = Math.max(0, ch.radius) + "px"; if (ch.gap != null) o["gap"] = Math.max(0, ch.gap) + "px";
      if (ch.padX != null) o["pad-x"] = Math.max(0, ch.padX) + "px"; if (ch.padY != null) o["pad-y"] = Math.max(0, ch.padY) + "px"; return o; }
    if (group === "typo") { var t = {}; if (!ch.present) return t;
      if (ch.weight != null) t["font-weight"] = String(ch.weight); if (ch.size != null) t["font-size"] = ch.size + "px";
      if (ch.lh != null) t["line-height"] = lhCss(ch.lh, typo.lhUnit); if (ch.tracking != null) t["track"] = trackCss(ch.tracking, typo.trackUnit);
      return t; }
    return {};
  }

  // ============================= resolveStructure =============================
  // Full resolve of one structure → resting channels (raw), resting CSS vars, static
  // state overrides, and parametric descriptors. This is the single resolve path bake()
  // and (via bake output) the consumer share.
  function resolveStructure(M, id) {
    var st = byId(M.structures, id); if (!st) return null;
    var fRef = structRef(M, id, "fill"), sRef = structRef(M, id, "size"), tRef = structRef(M, id, "typo"),
        eRef = structRef(M, id, "effectOuter"), iRef = structRef(M, id, "effectInner");
    var fCol = fRef ? byId(M.colors, fRef.id) : null;
    var tStyle = tRef ? byId(M.typos, tRef.id) : null;
    var eEff = eRef ? byId(M.effects, eRef.id) : null, eCol = eEff ? byId(M.colors, eEff.color) : null;
    // Inner effect (gloss) is NOT resolved through the PROP/resolveProp chain-delta system (there is
    // no "gloss.x"/"gloss.blur" prop-key — see the PROP table above) — it is intentionally a direct,
    // undeltable read of the referenced effect, same as effectCss() below composes it for CSS. We keep
    // the decomposed channels (not just the composed `css` string) so toDesignTokens can emit gloss as
    // a real DTCG shadow layer instead of an opaque string — see toDesignTokens/shadowLayer.
    var iEff = iRef ? byId(M.effects, iRef.id) : null, iCol = iEff ? byId(M.colors, iEff.color) : null;

    var raw = {
      fill: { present: !!fRef, hex: fRef ? resolveHex(M, id, (fCol && fCol.hex) || "#000000") : null,
        bright: resolveProp(M, id, "fill.bright"), hue: resolveProp(M, id, "fill.hue"), alpha: resolveProp(M, id, "fill.alpha") },
      size: { present: !!sRef, radius: resolveProp(M, id, "size.radius"), gap: resolveProp(M, id, "size.gap"),
        padX: resolveProp(M, id, "size.padX"), padY: resolveProp(M, id, "size.padY") },
      typo: { present: !!tRef, weight: resolveProp(M, id, "typo.weight"), size: resolveProp(M, id, "typo.size"),
        lh: resolveProp(M, id, "typo.lh"), tracking: resolveProp(M, id, "typo.tracking"),
        lhUnit: tStyle && tStyle.lhUnit, trackUnit: tStyle && tStyle.trackUnit, caps: !!(tStyle && tStyle.caps),
        colorId: tStyle && tStyle.color || null, font: (tStyle && tStyle.font) || "" },
      eff: { present: !!eRef, kind: eEff && eEff.kind || "outer", colorHex: (eCol && eCol.hex) || "#000000",
        x: resolveProp(M, id, "eff.x"), y: resolveProp(M, id, "eff.y"), blur: resolveProp(M, id, "eff.blur"),
        spread: resolveProp(M, id, "eff.spread"), alpha: resolveProp(M, id, "eff.alpha") },
      gloss: { present: !!iRef, css: iRef ? effectCss(M, iRef.id) : null,
        kind: (iEff && iEff.kind) || "inner", colorHex: (iCol && iCol.hex) || "#000000",
        x: iEff ? iEff.x : null, y: iEff ? iEff.y : null, blur: iEff ? iEff.blur : null, spread: iEff ? iEff.spread : null,
        alpha: iCol ? iCol.alpha : null }
    };

    // resting CSS vars
    var vars = {};
    merge(vars, groupVars("fill", raw.fill, raw.typo));
    merge(vars, groupVars("size", raw.size, raw.typo));
    merge(vars, groupVars("typo", raw.typo, raw.typo));
    merge(vars, groupVars("eff", raw.eff, raw.typo));
    // Contract choice: gloss (inner effect) is its OWN var --cl-<id>-gloss, independent of the outer
    // shadow — the consumer composes both: box-shadow: var(--cl-x-shadow), var(--cl-x-gloss). This
    // deliberately differs from lab's presenter (which comma-appends the inner effect into the single
    // --cell-shadow, and only when an outer effect exists); the --cl-* contract keeps them separable.
    if (raw.gloss.present && raw.gloss.css) vars["gloss"] = raw.gloss.css;
    if (raw.typo.present) { vars["case"] = raw.typo.caps ? "uppercase" : "none";
      if (raw.typo.colorId) vars["text-color"] = colorCss(M, raw.typo.colorId);
      if (raw.typo.font) vars["font-family"] = raw.typo.font; }

    // states
    var states = {}, param = [];
    (st.states || []).forEach(function (s) {
      var chans = s.chans || {};
      if (s.kind === "hover" || s.kind === "focus" || s.kind === "disabled") {
        var sv = computeStateVars(raw, chans, 1);
        if (Object.keys(sv).length) states[s.kind] = sv;
      } else if (isParam(s.kind)) {
        param.push({ kind: s.kind, curve: s.curve || 0, freq: s.freq != null ? s.freq : 0.3, radius: s.radius != null ? s.radius : 340, chans: cloneChans(chans) });
      }
    });

    // reactive (B6, see paramTouchesEff below): true iff a cur-x/cur-y/cur-dist/lfo state drives one
    // of this structure's eff.* channels — the shadow moves on its own and must stay per-tile.
    return { id: st.id, name: st.name, parent: st.parent || null, req: !!st.req, vars: vars, states: states, param: param, raw: raw, reactive: paramTouchesEff(param) };
  }

  function effectCss(M, id) { var e = byId(M.effects, id); if (!e) return null; return (e.kind === "inner" ? "inset " : "") + e.x + "px " + e.y + "px " + e.blur + "px " + e.spread + "px " + colorCss(M, e.color); }

  // ============================= shadow reactivity (B6) =============================
  // A structure's shadow is "reactive" when a parametric state (cur-x/cur-y/cur-dist/lfo — the
  // kinds resolveStructure() already collects into `param`, see isParam below) drives one of its
  // eff.* channels: the shadow itself keeps changing every frame (courtesy of the live --nx/--ny/
  // lfo terms the presenter compiles per node), so it MUST stay a per-tile box-shadow — a container-
  // level filter:drop-shadow() cannot carry a different value per descendant. A structure with no
  // such binding is "static": its shadow never changes on its own, so it is safe to hoist onto the
  // parent container as one filter:drop-shadow() silhouette (no more inter-tile shadow pile-up,
  // since drop-shadow paints the container's alpha SHAPE once, not each tile's box separately).
  // See design/render-architecture.md, "Тени и B6" — this is the compile-time classifier that
  // decision describes; consumers (the lab.html presenter, via its own mirror of this same check on
  // st.states) decide the actual hoist using this flag, not by touching `param` again per frame.
  function paramTouchesEff(param) {
    return (param || []).some(function (p) {
      var chans = p.chans || {};
      return Object.keys(chans).some(function (k) { return k.indexOf("eff.") === 0; });
    });
  }

  // ============================= resolveStructVars (Фаза 0) =============================
  // Единый резолвер рендера (design/render-architecture.md). applyChrome (lab.html) зовёт его
  // напрямую для resting-значений хрома; buildVars/structRuleCss (презентер, тот же файл) остаются
  // на своём пути в этой итерации (полная эмиссия + суффиксные hover/focus — контракт, который
  // resolveStructVars пока не покрывает, см. дизайн-документ), кроме gloss-слота (Механизм B).
  //
  // Оборачивает resolveStructure(mdl, sid).vars в канонические имена CSS-переменных.
  // Канон = "--cell-" + ключ, ровно как ключи уже называются в resolveStructure().vars.
  // Плюс "--org-*"-зеркала для bg/shadow (контейнерные имена узла, см. render-architecture.md §«Пространства имён»).
  // Значение то же самое, дублирования расчёта нет — только второе имя для того же числа.
  var ORG_MIRROR_KEY = { "bg": "org-fill", "shadow": "org-shadow" };
  // Карта переименований: единственное место, где ЛЕГАСИ-суффикс хрома lab.html (то, что раньше
  // писал легаси-хром резервным построением фона/тени, а до него — applyDS, на --cell-<суффикс>)
  // назван ПО-ДРУГОМУ, чем канонический ключ resolveStructure(...).vars. Все остальные суффиксы
  // совпадают буквально с канон-ключом (identity).
  // Общий источник для lab.html (applyChrome — направление канон→суффикс) и test/seam-emit.test.js
  // (направление суффикс→канон) — ни один из них не заводит свою копию этой карты.
  var CHROME_TO_CANON = Object.freeze({
    weight: "font-weight",
    text: "text-color",
    bg: "bg",
    shadow: "shadow",
    gloss: "gloss",
    radius: "radius",
    "pad-x": "pad-x",
    "pad-y": "pad-y",
    gap: "gap",
    "font-size": "font-size",
    "line-height": "line-height",
    track: "track",
    case: "case"
  });
  function structVarsToPairs(vars) {
    var pairs = [];
    Object.keys(vars).forEach(function (k) {
      pairs.push(["--cell-" + k, vars[k]]);
      if (ORG_MIRROR_KEY[k]) pairs.push(["--" + ORG_MIRROR_KEY[k], vars[k]]);
    });
    return pairs;
  }
  // sid — id структуры. mdl — модель M. boolOnList — имена активных булевых состояний ('hover'/'focus'/'disabled'),
  // в порядке применения (поздний в списке перекрывает ранний при конфликте по имени переменной).
  // Пустой/пропущенный boolOnList → чистый resting (тот же набор значений, что resolveStructure(mdl,sid).vars).
  // Не пересчитывает состояние заново: resolveStructure уже прогнал каждое hover/focus/disabled через
  // computeStateVars(raw, chans, 1) и положил результат в st.states[kind] — здесь только мёрдж готового.
  function resolveStructVars(sid, mdl, boolOnList) {
    var st = resolveStructure(mdl, sid); if (!st) return [];
    var vars = shallow(st.vars);
    (boolOnList || []).forEach(function (kind) {
      var sv = st.states[kind];
      if (sv) merge(vars, sv);
    });
    return structVarsToPairs(vars);
  }

  // Recompute only the vars touched by `chans`, modulated by t (1 for static states, 0..1 for parametric).
  function computeStateVars(raw, chans, t) {
    var out = {}, groups = {};
    Object.keys(chans).forEach(function (k) { if (KEY_GROUP[k]) groups[KEY_GROUP[k]] = true; });
    Object.keys(groups).forEach(function (g) {
      var base = raw[g], ch = shallow(base);
      Object.keys(chans).forEach(function (k) {
        if (KEY_GROUP[k] !== g) return; var field = KEY_FIELD[k], b = base[field];
        ch[field] = (b == null ? 0 : b) + (applyOp(b, chans[k]) - (b == null ? 0 : b)) * t;
      });
      var gv = groupVars(g, ch, raw.typo);
      // keep only vars whose key was actually in chans (size/typo are per-field; fill/eff aggregate)
      Object.keys(chans).forEach(function (k) { if (KEY_GROUP[k] === g) { var vn = KEY_VAR[k]; if (gv[vn] != null) out[vn] = gv[vn]; } });
    });
    return out;
  }

  // ============================= bake =============================
  // modelId/modelVersion identify WHICH authoring model produced this baked file, so a consumer
  // (applyBaked) can warn on a mismatch instead of silently applying a foreign model's vars under
  // the caller's expected id. Priority: explicit opts.* > the model's own field > a safe default —
  // never undefined, so a baked file can always be compared later even if nobody set either.
  function bakeModelId(M, opts) {
    if (opts.modelId != null) return opts.modelId;
    if (M && M.modelId != null) return M.modelId;
    if (M && M.id != null) return M.id;
    return "";
  }
  function bakeModelVersion(M, opts) {
    if (opts.modelVersion != null) return opts.modelVersion;
    if (M && M.modelVersion != null) return M.modelVersion;
    return BAKED_VERSION;
  }
  function bake(M, opts) {
    opts = opts || {};
    var structures = (M && M.structures || []).map(function (st) { return resolveStructure(M, st.id); }).filter(Boolean);
    var out = { format: BAKED_FORMAT, version: BAKED_VERSION, structures: structures,
      modelId: bakeModelId(M, opts), modelVersion: bakeModelVersion(M, opts) };
    if (opts.savedAt) out.savedAt = opts.savedAt;
    if (opts.name) out.name = opts.name;
    return out;
  }
  // ============================= emitModel (author side, split-on-save) =============================
  // The MODEL artifact is the in-memory blob M projected onto TOPOLOGY ONLY — ids, names,
  // parent graph, ref bindings, style-node roles (effect.kind / typo.colorAuto) and node→node
  // bindings (typo.color / effect.color) — plus the organ→structure dependency. ZERO tuning
  // values (hex/px/weight/caps/over/states): those are the Theme's half of M. Split happens
  // ONLY on serialization; M in memory and the resolver stay untouched.
  // Shape/rationale: docs/decisions/model-artifact-emit-shape.md; design/artifact-schemas.md.
  var MODEL_FORMAT = "cellular.model", MODEL_VERSION = 1;
  function orNull(v) { return v == null ? null : v; }   // undefined→null so JSON.stringify keeps the field (parent/color)
  function modelId(M, opts) {
    if (opts.model != null) return opts.model;
    if (M && M.model != null) return M.model;
    if (M && M.id != null) return M.id;
    return "";
  }
  // Organ→structure dependency is a ONE-WAY projection of the organism tree (comp-bearing nodes),
  // deduped by (comp,structId) — NOT a serialization of the editable tree (nesting/layout live in M).
  function emitOrgans(node, out, seen) {
    if (!node || typeof node !== "object") return out;
    if (node.comp && node.comp.id != null && node.structId != null) {
      var key = node.comp.id + " " + node.structId;
      if (!seen[key]) { seen[key] = 1; out.push({ comp: node.comp.id, structId: node.structId }); }
    }
    if (Array.isArray(node.kids)) node.kids.forEach(function (k) { emitOrgans(k, out, seen); });
    return out;
  }
  // Topology projection of the four style-node kinds, shared by emitModel (M→artifact) and
  // modelToM (artifact→M) so the two stay symmetric by construction.
  function projColor(c)  { return { id: c.id, name: c.name }; }
  function projSize(z)   { return { id: z.id, name: z.name, parent: orNull(z.parent) }; }
  function projTypo(t)   { return { id: t.id, name: t.name, parent: orNull(t.parent), color: orNull(t.color), colorAuto: !!t.colorAuto }; }
  function projEffect(e) { return { id: e.id, name: e.name, parent: orNull(e.parent), kind: e.kind, color: orNull(e.color) }; }
  function projStruct(s) { return { id: s.id, name: s.name, parent: orNull(s.parent), req: !!s.req, ref: shallow(s.ref || {}) }; }
  // Only object elements are projectable — a stray null/primitive in an array must not crash the map (totality).
  function objList(o, k) { return (Array.isArray(o && o[k]) ? o[k] : []).filter(function (x) { return x && typeof x === "object"; }); }
  function emitModel(M, opts) {
    opts = opts || {};
    return {
      format: MODEL_FORMAT, model: modelId(M, opts), version: MODEL_VERSION,
      colors:  objList(M, "colors").map(projColor),
      sizes:   objList(M, "sizes").map(projSize),
      typos:   objList(M, "typos").map(projTypo),
      effects: objList(M, "effects").map(projEffect),
      structures: objList(M, "structures").map(projStruct),
      organs: emitOrgans(M && M.organism, [], {})
    };
  }
  // Inverse projection: an M-shaped topology (empty values, empty organism seed) for round-trip
  // load of a MODEL file back into the Lab. Structures regain the M form (over:{}, states:[]);
  // organs is NOT reconstructed (one-way projection). ensureModel on the Lab side sanitizes further.
  function modelToM(model) {
    var m = {
      colors:  objList(model, "colors").map(projColor),
      sizes:   objList(model, "sizes").map(projSize),
      typos:   objList(model, "typos").map(projTypo),
      effects: objList(model, "effects").map(projEffect),
      structures: objList(model, "structures").map(function (s) { var p = projStruct(s); p.over = {}; p.states = []; return p; }),
      organism: { id: "oRoot", structId: null, comp: null, kids: [] },
      organStruct: {}
    };
    if (model && model.model != null) m.model = model.model;   // keep provenance so re-emit is stable
    return m;
  }

  // Forward-only normalizer. v2 passes through; unknown/older shapes get the current envelope
  // so a stale file never crashes the applier (it just yields no structures it can't read).
  function migrateBaked(payload) {
    if (!payload || typeof payload !== "object") return { format: BAKED_FORMAT, version: BAKED_VERSION, structures: [] };
    if (payload.version === BAKED_VERSION && Array.isArray(payload.structures)) return payload;
    return { format: BAKED_FORMAT, version: BAKED_VERSION, structures: Array.isArray(payload.structures) ? payload.structures : [], _from: payload.version || null };
  }

  // ============================= applyBaked (consumer, static) =============================
  // baked → flat map of CSS custom properties. Writes to opts.target if given (and DOM exists).
  // key = structure id by default (stable across renames); opts.keyBy:'name' or a fn for readability.
  // Mismatch is a WARNING, not a throw: a consumer may legitimately reuse an old baked file while
  // the authoring model moves on (or vice versa) — the --cl-* contract itself doesn't change shape,
  // so refusing to apply would break a working page over a label. opts.modelId/expectedModelId let
  // the caller name what it expected; absent either, no check runs (back-compat, no new warn).
  function checkModelId(baked, opts) {
    var expected = opts.modelId != null ? opts.modelId : opts.expectedModelId;
    if (expected == null) return;
    if (baked.modelId === expected) return;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[cellular] applyBaked: modelId mismatch — expected '" + expected + "', baked has '" + baked.modelId + "'");
    }
  }
  function applyBaked(baked, opts) {
    baked = migrateBaked(baked); opts = opts || {};
    checkModelId(baked, opts);
    var prefix = opts.prefix || "--cl-";
    var keyMap = keyMapFor(baked.structures, opts.keyBy);
    var vars = {};
    baked.structures.forEach(function (s) {
      var k = keyMap[s.id];
      Object.keys(s.vars || {}).forEach(function (vn) { vars[prefix + k + "-" + vn] = s.vars[vn]; });
      Object.keys(s.states || {}).forEach(function (state) { var sv = s.states[state]; Object.keys(sv).forEach(function (vn) { vars[prefix + k + "-" + vn + "-" + state] = sv[vn]; }); });
    });
    var target = opts.target;
    if (target && target.style && typeof target.style.setProperty === "function") Object.keys(vars).forEach(function (p) { target.style.setProperty(p, vars[p]); });
    return { vars: vars, count: Object.keys(vars).length };
  }

  // ============================= toDesignTokens (consumer, W3C DTCG) =============================
  // Static only — parametric descriptors cannot be a single token value; they live under
  // $extensions.cellular for Cellular-aware tooling and are ignored by standard pipelines.
  function dim(px) { return { $type: "dimension", $value: { value: px, unit: "px" } }; }
  // One DTCG shadow layer object (color/offsetX/offsetY/blur/spread + `inset`). `inset` is not part
  // of the original DTCG core spec, but mirrors the boolean the CSS side already keys off of
  // (effectCss: `(e.kind === "inner" ? "inset " : "")`) — kept as a direct field on the layer object,
  // not tucked under $extensions, so array-of-layers consumers can branch on it without a namespaced
  // lookup per layer.
  function shadowLayer(colorHex, alpha, x, y, blur, spread, inset) {
    var o = { color: toHex8(hexRGBA(colorHex, clamp01(alpha == null ? 1 : alpha))),
      offsetX: { value: x, unit: "px" }, offsetY: { value: y, unit: "px" },
      blur: { value: Math.max(0, blur), unit: "px" }, spread: { value: spread, unit: "px" } };
    if (inset) o.inset = true;
    return o;
  }
  function toDesignTokens(baked) {
    baked = migrateBaked(baked);
    var doc = { $extensions: { cellular: { format: "cellular.tokens.w3c", version: 1, bakedVersion: baked.version } }, cl: {} };
    baked.structures.forEach(function (s) {
      var r = s.raw || {}, g = { $extensions: { cellular: { id: s.id, parent: s.parent, req: s.req } } };
      if (r.fill && r.fill.present) g.bg = { $type: "color", $value: toHex8(fillCss(r.fill)) };
      if (r.size && r.size.present) { if (r.size.radius != null) g.radius = dim(r.size.radius); if (r.size.gap != null) g.gap = dim(r.size.gap);
        if (r.size.padX != null) g["pad-x"] = dim(r.size.padX); if (r.size.padY != null) g["pad-y"] = dim(r.size.padY); }
      if (r.typo && r.typo.present) {
        if (r.typo.weight != null) g["font-weight"] = { $type: "fontWeight", $value: r.typo.weight };
        if (r.typo.size != null) g["font-size"] = dim(r.typo.size);
        if (r.typo.colorId != null && s.vars && s.vars["text-color"]) g["text-color"] = { $type: "color", $value: toHex8(s.vars["text-color"]) };
        if (r.typo.font) g["font-family"] = { $type: "fontFamily", $value: r.typo.font };
      }
      // Shadow: `box-shadow: var(--cl-x-shadow), var(--cl-x-gloss)` in CSS is two comma-joined layers
      // (EMBEDDING.md, "shadow and gloss are separate variables — compose them yourself"). The W3C
      // shadow $type's $value accepts either one layer object or an array of layers (DTCG "multiple
      // shadows" form) — an array here is the literal token-side mirror of the CSS comma-list, so a
      // structure with BOTH an outer effect and gloss gets a 2-layer array; either alone stays the
      // single-object form (no array-wrapping tax on the common case).
      var layers = [];
      if (r.eff && r.eff.present) layers.push(shadowLayer(r.eff.colorHex, r.eff.alpha, r.eff.x, r.eff.y, r.eff.blur, r.eff.spread, r.eff.kind === "inner"));
      if (r.gloss && r.gloss.present) layers.push(shadowLayer(r.gloss.colorHex, r.gloss.alpha, r.gloss.x, r.gloss.y, r.gloss.blur, r.gloss.spread, r.gloss.kind === "inner"));
      if (layers.length) g.shadow = { $type: "shadow", $value: layers.length === 1 ? layers[0] : layers };
      if (s.param && s.param.length) g.$extensions.cellular.param = s.param;
      doc.cl[s.id] = g;
    });
    return doc;
  }

  // ============================= driveBaked (consumer, parametric) =============================
  // Live cursor/LFO tick. Container-level sources (cur-x / cur-y / lfo) write --cl-<id>-<var>
  // on the target root each frame. cur-dist is per-element (needs each bound tile's rect) and is
  // opt-in via opts.tiles(structureId)->[elements]; without it, cur-dist descriptors are skipped
  // (reported, not silently dropped). No-op with a clear return in non-DOM environments.
  function isParam(kind) { return kind === "cur-x" || kind === "cur-y" || kind === "cur-dist" || kind === "lfo"; }
  function curve(i, t) { switch (i) { case 1: return t * t * (3 - 2 * t); case 2: return t * t; case 3: return 1 - (1 - t) * (1 - t); case 4: return t * t * t; default: return t; } }
  function driveBaked(baked, opts) {
    baked = migrateBaked(baked); opts = opts || {};
    if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return { stop: function () {}, active: false };
    var root = opts.target || document.documentElement, prefix = opts.prefix || "--cl-";
    var keyMap = keyMapFor(baked.structures, opts.keyBy);
    var space = opts.space || (root.getBoundingClientRect ? root : document.documentElement);
    var mx = -1e5, my = -1e5, raf = 0, t0 = now(), running = true, dropped = [];
    var jobs = []; // {id, kind, curve, freq, radius, chans, raw, tiles?}
    baked.structures.forEach(function (s) {
      (s.param || []).forEach(function (p) {
        if (p.kind === "cur-dist" && typeof opts.tiles !== "function") { dropped.push(s.id + ":cur-dist"); return; }
        jobs.push({ id: s.id, p: p, raw: s.raw });
      });
    });
    if (dropped.length && typeof console !== "undefined") console.warn("[cellular] cur-dist descriptors need opts.tiles(structureId); skipped: " + dropped.join(", "));
    if (!jobs.length) return { stop: function () {}, active: false };
    var hasLfo = jobs.some(function (j) { return j.p.kind === "lfo"; });

    function paramT(p, rect, sr) {
      var t;
      if (p.kind === "lfo") t = (Math.sin((now() - t0) / 1000 * (p.freq || 0.3) * 2 * Math.PI) + 1) / 2;
      else if (p.kind === "cur-x") t = (mx - sr.left) / (sr.width || 1);
      else if (p.kind === "cur-y") t = (my - sr.top) / (sr.height || 1);
      else { var b = rect; var dx = b.left + b.width / 2 - mx, dy = b.top + b.height / 2 - my; t = 1 - Math.sqrt(dx * dx + dy * dy) / (p.radius || 340); }
      t = t < 0 ? 0 : (t > 1 ? 1 : t); return curve(p.curve || 0, t);
    }
    function paint() {
      var sr = space.getBoundingClientRect();   // one layout read per frame, not per job
      for (var i = 0; i < jobs.length; i++) { var j = jobs[i], p = j.p, key = keyFor(j.id);
        if (p.kind === "cur-dist") { var els = opts.tiles(j.id) || []; for (var e = 0; e < els.length; e++) writeVars(els[e], key, computeStateVars(j.raw, p.chans, paramT(p, els[e].getBoundingClientRect(), sr)), prefix); }
        else writeVars(root, key, computeStateVars(j.raw, p.chans, paramT(p, null, sr)), prefix);
      }
    }
    function keyFor(id) { return keyMap[id] || id; }
    function loop() { if (!running) return; if (hasLfo) paint(); raf = requestAnimationFrame(loop); }
    function onMove(e) { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(function () { raf = 0; paint(); if (hasLfo) loop(); }); }
    document.addEventListener("pointermove", onMove);
    if (hasLfo) loop();
    return { stop: function () { running = false; if (raf) cancelAnimationFrame(raf); document.removeEventListener("pointermove", onMove); }, active: true, jobs: jobs.length, dropped: dropped };
  }
  function writeVars(el, key, vmap, prefix) { if (!el || !el.style) return; Object.keys(vmap).forEach(function (vn) { el.style.setProperty(prefix + key + "-" + vn, vmap[vn]); }); }
  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  // ============================= small utils =============================
  function merge(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }
  function shallow(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }
  function cloneChans(c) { var r = {}; Object.keys(c).forEach(function (k) { r[k] = { op: c[k].op, val: c[k].val }; }); return r; }
  // Cyrillic→Latin so keyBy:"name" yields readable, DISTINCT slugs for Russian-named structures
  // (the Lab's native language): "Ячейка"→"yacheyka", "Блок"→"blok" — not both collapsing to "s".
  var CYR = { "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya" };
  function slug(s) { var t = String(s || "").toLowerCase().replace(/[а-яё]/g, function (c) { return CYR[c] != null ? CYR[c] : c; }).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return t || "s"; }
  // Unique key per structure. Default keyBy=id (ids are already unique). For name/fn keys, dedup with
  // a numeric suffix and warn — a slug collision must never silently overwrite a structure's theme.
  function keyMapFor(structures, keyBy) {
    var raw = typeof keyBy === "function" ? keyBy : (keyBy === "name" ? function (s) { return slug(s.name || s.id); } : function (s) { return s.id; });
    var map = {}, used = {}, dedup = !!keyBy;
    structures.forEach(function (s) { var base = raw(s), k = base, n = 2;
      if (dedup) { while (used[k]) k = base + "-" + (n++); if (k !== base && typeof console !== "undefined" && console.warn) console.warn("[cellular] key collision '" + base + "' → '" + k + "' (structure " + s.id + ")"); }
      used[k] = 1; map[s.id] = k; });
    return map;
  }

  return {
    FORMAT: BAKED_FORMAT, VERSION: BAKED_VERSION, PROP: PROP,
    // color math
    hexRGBA: hexRGBA, shade: shade, hueRotate: hueRotate, toHex8: toHex8,
    // resolution (author side)
    byId: byId, structRef: structRef, resolveProp: resolveProp, resolveHex: resolveHex, resolveStructure: resolveStructure,
    resolveStructVars: resolveStructVars, computeStateVars: computeStateVars, CHROME_TO_CANON: CHROME_TO_CANON,
    bake: bake, migrateBaked: migrateBaked,
    MODEL_FORMAT: MODEL_FORMAT, MODEL_VERSION: MODEL_VERSION, emitModel: emitModel, modelToM: modelToM,
    // consumer side
    applyBaked: applyBaked, toDesignTokens: toDesignTokens, driveBaked: driveBaked,
    slug: slug
  };
});
