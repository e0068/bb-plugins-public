/* workflow-model.ts — the workflow model + code generator/parser for the constructor.
 *
 * A workflow is ONE .js file that a `/workflows`-style engine (bb workflows OR Claude Code)
 * executes. In the constructor it is modelled as a TREE (workflow → phases → steps; a step is an
 * agent or a nested parallel/pipeline container). This module owns pure, DOM-free, bb-free
 * concerns so it can be unit-tested on its own:
 *
 *   compile(tree, engine) → the .js source the engine runs: a human-readable `export const meta = {…}`
 *                    + body, THEN a two-line marker — `// Made with Claude Config` and a machine line
 *                    `// @cc-wf vN {json}`. The json is a COMPACT side-trace: only the agent knobs the
 *                    body cannot round-trip (agentType/model/effort/provider, per agent in DFS order).
 *                    Structure, prompts and schema are NOT duplicated there — they live only in the body.
 *
 *   parse(source, engine) → the tree, recovered by PARSING THE BODY (parseBody) and overlaying the
 *                    side-trace, then re-compiling and byte-comparing to prove the parse exact
 *                    (verifyRecompile). Returns null when: there is no marker (hand-written / foreign
 *                    file), OR the body was hand-edited so the recompile no longer matches. A legacy file
 *                    still carrying the old `/* @composer-workflow … *\/` mirror is read from that mirror
 *                    for backward compatibility. A null result opens the file read-only (store.ts).
 *
 * The self-verifying round-trip means a parse bug degrades to "read-only", never to silent data loss.
 *
 * The tree shape (also the mirror JSON):
 *   tree      = { name, description, phases:[phase] }
 *   phase     = { title, mode:"single"|"parallel"|"pipeline", repeatBudget:null|Number,
 *                 iterateOver:String, maxParallel:null|Number, repeat:null|RepeatSpec, steps:[step] }
 *   step      = agent | container
 *   agent     = { type:"agent", label, prompt, model, provider, effort, agentType, schema,
 *                 repeat:null|RepeatSpec }   // "" = omit
 *   container = { type:"container", mode:"parallel"|"pipeline", steps:[step],
 *                 iterateOver:String, maxParallel:null|Number, repeat:null|RepeatSpec }
 *   RepeatSpec = { maxLoops:Number, until:String }
 *
 * Modes: single = one step; parallel = N independent steps run at once; pipeline = N stages in order,
 * each stage sees the previous stage's result as `{{prev}}` interpolated into an agent prompt.
 *
 * Node settings, not node types (decision workflow-node-settings-model, BP-134):
 *   iterateOver — non-empty on a "parallel" node = fan-out from data, not authored branches. `steps[0]`
 *                 is a single per-item TEMPLATE (not N branches); the array comes from `prev[iterateOver]`
 *                 (the enclosing pipeline stage's incoming value — see decision for why {{prev}} already
 *                 covers this without a cross-phase result channel); `{{item}}` in the template's prompt
 *                 is the current element.
 *   iterateInWaves — modifier on iterateOver (decision workflow-node-settings-model, task
 *                 workflow-constructor-dynamic-waves): `prev[iterateOver]` is an array OF ARRAYS (waves)
 *                 instead of a flat array of items. Waves run one at a time, in order; the branches
 *                 inside a wave still run in parallel (and still respect maxParallel). Unlike `repeat`,
 *                 the round count is `prev[iterateOver].length` at runtime, not an authored maxLoops —
 *                 `repeat` reruns one static call a fixed number of times and cannot bind a different
 *                 data slice per round, which is exactly the gap this field closes.
 *   maxParallel — cap on simultaneous branches. Neither engine's `parallel()` accepts a concurrency
 *                 option (measured against the installed bb workflows runtime and the workflow-authoring
 *                 reference), so a cap compiles to manual batching, not an engine argument.
 *   repeat      — { maxLoops, until } on ANY step (agent or container) or a phase: re-run the whole node
 *                 up to maxLoops times, checking `until` (a raw JS boolean expression over the loop's
 *                 `result`) after each run. Generalizes `repeatBudget` (a different, independent axis —
 *                 stop when token budget runs out, not when a data condition is met); both can be set at
 *                 once. `until` is spliced into the compiled body verbatim, same trust level already
 *                 given to `schema`.
 */

export type PhaseMode = "single" | "parallel" | "pipeline";
export type ContainerMode = "parallel" | "pipeline";

// The two engines the same tree can target. They share the primitives but diverge on agent options:
//   bb     — `bb workflows`, files in .bb/workflows/. Agent opts: label + schema always; bare
//            model/effort/agentType are rejected, but a per-agent selection is accepted as the full
//            provider+model+reasoningLevel triple — emitted only when all three of provider/model/
//            effort are set (a partial selection is dropped and the agent inherits the session model).
//   claude — Claude Code /workflows, files in ~/.claude/workflows/. Agent opts: label, agentType,
//            model, effort, schema (no provider — Claude Code resolves the provider from agentType).
// Measured with `bb workflows validate`; see decision engine-divergence-store-aware-compile.
export type Engine = "bb" | "claude";

// A bounded re-run of the node it's attached to: up to maxLoops attempts, stopping early once `until`
// (a JS boolean expression evaluated against `result`, the node's last run) is truthy. Empty `until` =
// no early exit, run exactly maxLoops times. See decision workflow-node-settings-model for why this is
// a per-node property rather than a dedicated loop node, and for the accepted approximation (the
// condition is checked only after the WHOLE node — agent or group — finishes, not mid-group).
export interface RepeatSpec {
  maxLoops: number;
  until: string;
}

export interface Agent {
  type: "agent";
  label: string;
  prompt: string;
  // The four agent "knobs". The body cannot be trusted to round-trip them — under bb `agentType` is never
  // emitted and a partial model/effort/provider triple is dropped whole — so on save they are written to
  // the marker's side-trace and, on parse, taken from there (authoritative), not re-read from the body.
  model: string;
  provider: string;
  effort: string;
  agentType: string;
  schema: string;
  repeat: RepeatSpec | null;
}

export interface Container {
  type: "container";
  mode: ContainerMode;
  steps: Step[];
  // "" = steps are authored branches (today's behaviour). Non-empty (mode "parallel" only) = the name
  // of an array field on the incoming `{{prev}}`; steps[0] is then a single per-item template, not a
  // list of branches.
  iterateOver: string;
  // true = `prev[iterateOver]` is an array of arrays (waves): run wave 0 to completion, then wave 1, …
  // No effect while iterateOver is "".
  iterateInWaves: boolean;
  maxParallel: number | null;
  repeat: RepeatSpec | null;
}

export type Step = Agent | Container;

export interface Phase {
  title: string;
  mode: PhaseMode;
  repeatBudget: number | null;
  steps: Step[];
  iterateOver: string;
  iterateInWaves: boolean;
  maxParallel: number | null;
  repeat: RepeatSpec | null;
}

export interface Tree {
  name: string;
  description: string;
  phases: Phase[];
}

const MIRROR_OPEN = "/* @composer-workflow"; // legacy trailing mirror — still READ for backward compat
const MIRROR_CLOSE = "*/";

// The marker compile() now appends instead of the mirror: a human line and a machine line
// `// @cc-wf vN {json}`. The json is a compact side-trace of the agent knobs the body can't round-trip.
const WF_FORMAT_VERSION = 1;
const MARKER_LABEL = "// Made with Claude Config";
const MARKER_MACHINE = "// @cc-wf"; // followed by " vN " + json

// choices offered in the frontmatter dropdowns (kept here so parser-side docs and UI agree)
export const MODELS = [
  "",
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-haiku-4-5-20251001",
];
export const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
export const MODES: PhaseMode[] = ["single", "parallel", "pipeline"];

// ---- literal helpers ----
function dq(s: unknown): string {
  return JSON.stringify(String(s == null ? "" : s)); // a double-quoted JS string literal (safe for any content)
}

// a template-literal for a (possibly multi-line) prompt; {{prev}} becomes ${prev} so a pipeline stage
// can splice in the previous stage's result, and (only for an each-template step) {{item}} becomes
// ${item}. Escapes backslashes, backticks and ${ first, THEN restores the placeholders as real
// interpolations.
function promptLiteral(s: unknown, allowPrev: boolean, allowItem: boolean): string {
  let esc = String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  esc = esc.replace(/\{\{prev\}\}/g, allowPrev ? "${prev}" : ""); // no meaning outside a pipeline stage → drop it
  esc = esc.replace(/\{\{item\}\}/g, allowItem ? "${item}" : ""); // no meaning outside an each-template → drop it
  return "`" + esc + "`";
}

function pad(level: number): string {
  return "  ".repeat(Math.max(0, level)); // 2 spaces per level
}

// opts object literal for an agent() call — only non-empty fields, schema inlined verbatim (raw JSON the
// user typed). The set of allowed fields depends on the target engine (see Engine).
function agentOpts(a: Agent, engine: Engine): string {
  const parts: string[] = [];
  if (a.label) parts.push("label: " + dq(a.label));
  if (engine === "claude") {
    if (a.agentType) parts.push("agentType: " + dq(a.agentType));
    if (a.model) parts.push("model: " + dq(a.model));
    if (a.effort) parts.push("effort: " + dq(a.effort));
  }
  // bb rejects a bare model/effort and has no agentType at all, but accepts the full
  // provider+model+reasoningLevel triple — emit it only when all three are set; a partial selection is
  // dropped so the agent falls back to inheriting the session's provider/model/reasoning.
  if (engine === "bb" && a.provider && a.model && a.effort) {
    parts.push("provider: " + dq(a.provider));
    parts.push("model: " + dq(a.model));
    parts.push("reasoningLevel: " + dq(a.effort));
  }
  if (a.schema && a.schema.trim()) parts.push("schema: " + a.schema.trim());
  return parts.length ? "{ " + parts.join(", ") + " }" : "{}";
}

// ---- expression builders (return a JS expression string, no leading await) ----
function agentExpr(a: Agent, allowPrev: boolean, allowItem: boolean, engine: Engine): string {
  return "agent(" + promptLiteral(a.prompt, allowPrev, allowItem) + ", " + agentOpts(a, engine) + ")";
}

// Wrap a group's array-of-thunks expression in a manual concurrency cap. Neither engine's `parallel()`
// reads a second argument (measured against the installed bb workflows runtime and the
// workflow-authoring reference — see decision workflow-node-settings-model), so a cap can only be
// batching: slice the thunks into chunks of `maxParallel`, await one `parallel()` per chunk, concat the
// results. `null`/non-positive → unchanged: a single `parallel(thunksArrayExpr)`, byte-identical to the
// pre-BP-134 output.
function parallelWithLimit(thunksArrayExpr: string, maxParallel: number | null, level: number): string {
  if (maxParallel == null || maxParallel <= 0) return "parallel(" + thunksArrayExpr + ")";
  const n = Math.max(1, Math.round(maxParallel));
  const p = pad(level + 1);
  return (
    "(async () => {\n" +
    p + "const items = " + thunksArrayExpr + ";\n" +
    p + "const out = [];\n" +
    p + "for (let i = 0; i < items.length; i += " + n + ") out.push(...(await parallel(items.slice(i, i + " + n + "))));\n" +
    p + "return out;\n" +
    pad(level) + "})()"
  );
}

// Sequential rounds of parallel fan-out, one wave at a time: `wavesArrayExpr` is an array of arrays
// (`prev[iterateOver]`), unknown length at compile time. Each wave's items become thunks and go through
// `parallelWithLimit` exactly like flat iterateOver, so a `maxParallel` cap still applies WITHIN a wave.
// Waves themselves are never capped — the point is one wave finishes before the next starts.
function wavesWithLimit(wavesArrayExpr: string, perItemThunkExpr: string, maxParallel: number | null, level: number): string {
  const p = pad(level + 1);
  // `waveItems`, not `items` — parallelWithLimit's own batching branch declares its OWN `const items =
  // <thunksArrayExpr>`; splicing an `items.map(...)` string in as that same expression would make it
  // read its own not-yet-initialized binding (`const items = items.map(...)` throws, TDZ).
  const inner = parallelWithLimit("waveItems.map((item) => () => " + perItemThunkExpr + ")", maxParallel, level + 2);
  return (
    "(async () => {\n" +
    p + "const waves = " + wavesArrayExpr + ";\n" +
    p + "const out = [];\n" +
    p + "for (const wave of waves) {\n" +
    pad(level + 2) + "const waveItems = Array.isArray(wave) ? wave : [];\n" +
    pad(level + 2) + "out.push(...(await " + inner + "));\n" +
    p + "}\n" +
    p + "return out;\n" +
    pad(level) + "})()"
  );
}

// Wrap a node's own expression in a bounded until-loop. `result` is the name every round's value binds
// to, both inside `until` (spliced verbatim, same trust level as `schema`) and as the whole wrapper's
// return value. null → unchanged.
function wrapRepeat(expr: string, repeat: RepeatSpec | null, level: number): string {
  if (!repeat) return expr;
  const n = Math.max(1, Math.round(repeat.maxLoops));
  const until = (repeat.until || "").trim();
  const p = pad(level + 1);
  const lines = [
    "(async () => {",
    p + "let result = null;",
    p + "for (let round = 0; round < " + n + "; round++) {",
    p + "  result = await " + expr + ";",
  ];
  if (until) lines.push(p + "  if (result && (" + until + ")) break;");
  lines.push(p + "}", p + "return result;", pad(level) + "})()");
  return lines.join("\n");
}

function stepExpr(step: Step, level: number, allowPrev: boolean, allowItem: boolean, engine: Engine): string {
  if (step.type === "container") {
    const inner = modeExpr(
      step.mode,
      step.steps,
      level,
      engine,
      { iterateOver: step.iterateOver, iterateInWaves: step.iterateInWaves, maxParallel: step.maxParallel },
      allowPrev,
    );
    return wrapRepeat(inner, step.repeat, level);
  }
  return wrapRepeat(agentExpr(step, allowPrev, allowItem, engine), step.repeat, level);
}

// a composite expression for a (mode, steps) group — used by both a phase body and a nested container.
// `allowPrev` says whether a `prev` binding genuinely exists in the enclosing lexical scope right now
// (true only inside a pipeline stage's `(prev) => …`) — threaded down so a container nested inside a
// pipeline stage can still resolve {{prev}}, which previously only worked for a bare agent stage.
function modeExpr(
  mode: string,
  steps: Step[],
  level: number,
  engine: Engine,
  groupOpts: { iterateOver: string; iterateInWaves?: boolean; maxParallel: number | null },
  allowPrev: boolean,
): string {
  steps = steps || [];
  if (mode === "single" || (steps.length === 1 && mode !== "pipeline" && mode !== "parallel"))
    return stepExpr(steps[0] || blankAgent(), level, false, false, engine);
  if (mode === "parallel") {
    const iterateOver = (groupOpts.iterateOver || "").trim();
    if (iterateOver) {
      const template = steps[0] || blankAgent();
      // `{{prev}}` may legitimately be undeclared here (iterateOver used outside a pipeline stage is a
      // misconfiguration, not a crash) — guarded with `typeof`, same total-function preference the rest
      // of the codebase applies to generated code paths.
      const arr = 'typeof prev !== "undefined" && prev && Array.isArray(prev[' + dq(iterateOver) + "]) ? prev[" + dq(iterateOver) + "] : []";
      const thunk = stepExpr(template, level + 1, allowPrev, true, engine);
      if (groupOpts.iterateInWaves) return wavesWithLimit(arr, thunk, groupOpts.maxParallel, level);
      return parallelWithLimit("(" + arr + ").map((item) => () => " + thunk + ")", groupOpts.maxParallel, level);
    }
    const thunks = steps.map((s) => pad(level + 1) + "() => " + stepExpr(s, level + 1, allowPrev, false, engine));
    return parallelWithLimit("[\n" + thunks.join(",\n") + ",\n" + pad(level) + "]", groupOpts.maxParallel, level);
  }
  // pipeline: seed with a single truthy placeholder item, each stage is (prev) => <step>; agents may use
  // {{prev}} — and so may a nested container's own descendants, via the threaded allowPrev=true below.
  // The seed is NOT null: the engine treats a null pipeline item as "dropped" and skips every
  // remaining stage, so pipeline([null]) silently runs zero agents. See task workflow-composer-pipeline-null-seed.
  const stages = steps.map((s) => pad(level + 1) + "(prev) => " + stepExpr(s, level + 1, true, false, engine));
  return "pipeline([{}],\n" + stages.join(",\n") + ",\n" + pad(level) + ")";
}

function phaseBody(phase: Phase, engine: Engine): string {
  const steps = phase.steps && phase.steps.length ? phase.steps : [blankAgent()];
  const mode = phase.mode || "single";
  let expr = modeExpr(
    mode === "single" && steps.length > 1 ? "parallel" : mode,
    steps,
    1,
    engine,
    { iterateOver: phase.iterateOver, iterateInWaves: phase.iterateInWaves, maxParallel: phase.maxParallel },
    false, // a phase is never itself nested inside a pipeline stage — no cross-phase `prev` (see decision)
  );
  expr = wrapRepeat(expr, phase.repeat, 1);
  const lines = ["  phase(" + dq(phase.title || "Phase") + ")"];
  const budget = phase.repeatBudget;
  if (budget != null && budget > 0) {
    // repeat while the token budget allows
    lines.push("  while (budget.total && budget.remaining() > " + Math.round(budget) + ") {");
    lines.push("    await " + expr);
    lines.push("  }");
  } else {
    lines.push("  await " + expr);
  }
  return lines.join("\n");
}

function metaBlock(tree: Tree): string {
  const phases = (tree.phases || []).map((p) => "    { title: " + dq(p.title || "Phase") + " },");
  const ph = phases.length ? "\n" + phases.join("\n") + "\n  " : "";
  return (
    "export const meta = {\n" +
    "  name: " +
    dq(tree.name || "workflow") +
    ",\n" +
    "  description: " +
    dq(tree.description || "") +
    ",\n" +
    "  phases: [" +
    ph +
    "],\n" +
    "}"
  );
}

// Compile the tree to .js for the target engine (default "bb", this IDE's own). The output is a pure
// function of (tree, engine): meta + body + a two-line marker whose machine line carries the compact
// side-trace. verifyRecompile relies on this determinism to prove a parse exact.
export function compile(tree: Tree, engine: Engine = "bb"): string {
  tree = tree || blankTree("workflow");
  const body = (tree.phases || []).map((p) => phaseBody(p, engine)).join("\n\n");
  return metaBlock(tree) + "\n\n" + body + "\n\n" + writeMarker(tree) + "\n";
}

// ---- marker + side-trace ----

interface AgentKnobs {
  agentType?: string;
  model?: string;
  effort?: string;
  provider?: string;
}

// Every agent in the tree, in the same depth-first order compile()/parseBody visit them, so the
// side-trace array lines up with the agents positionally.
function collectAgents(tree: Tree): Agent[] {
  const out: Agent[] = [];
  const walk = (steps: Step[]): void => {
    for (const s of steps) {
      if (s.type === "agent") out.push(s);
      else walk(s.steps);
    }
  };
  for (const p of tree.phases || []) walk(p.steps || []);
  return out;
}

function knobsOf(a: Agent): AgentKnobs {
  const k: AgentKnobs = {};
  if (a.agentType) k.agentType = a.agentType;
  if (a.model) k.model = a.model;
  if (a.effort) k.effort = a.effort;
  if (a.provider) k.provider = a.provider;
  return k;
}

export function writeMarker(tree: Tree): string {
  const agents = collectAgents(tree).map(knobsOf);
  return MARKER_LABEL + "\n" + MARKER_MACHINE + " v" + WF_FORMAT_VERSION + " " + JSON.stringify({ agents });
}

// Read the trailing machine marker back. Scans from the LAST line so a prompt that happens to contain
// "// @cc-wf" can't win. Returns null when the marker is absent or its version is not one we wrote.
export function readMarker(source: string): { version: number; agents: AgentKnobs[] } | null {
  if (typeof source !== "string") return null;
  const lines = source.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    const head = MARKER_MACHINE + " v";
    if (!line.startsWith(head)) continue;
    const rest = line.slice(head.length);
    const sp = rest.indexOf(" ");
    if (sp === -1) return null;
    const version = Number(rest.slice(0, sp));
    if (!Number.isInteger(version) || version !== WF_FORMAT_VERSION) return null; // foreign / future format
    try {
      const raw = JSON.parse(rest.slice(sp + 1)) as { agents?: unknown };
      const agents = Array.isArray(raw.agents) ? raw.agents.map(normalizeKnobs) : [];
      return { version, agents };
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeKnobs(k: unknown): AgentKnobs {
  const o = (k && typeof k === "object" ? k : {}) as Record<string, unknown>;
  const out: AgentKnobs = {};
  for (const key of ["agentType", "model", "effort", "provider"] as const) {
    if (typeof o[key] === "string" && o[key]) out[key] = o[key] as string;
  }
  return out;
}

// ---- body parser (inverts compile()'s canonical output) ----

// Skip a string/template literal that STARTS at s[i] (a quote char); returns the index of its closing
// quote (or s.length if unterminated). Inside a `template`, a `${…}` interpolation is skipped as a
// balanced group so a `}` in a nested object literal doesn't end it early.
function skipString(s: string, i: number): number {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (q === "`" && c === "$" && s[j + 1] === "{") {
      const e = findClose(s, j + 1);
      if (e === -1) return s.length;
      j = e;
      continue;
    }
    if (c === q) return j;
  }
  return s.length;
}

// Index of the bracket that closes the one at s[open] ((), [], {}), respecting strings. −1 if unbalanced.
function findClose(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// End index (exclusive) of an expression starting at i, stopping at the first `stop` char seen at
// bracket-depth 0 and outside a string. Used for `const x = <expr>;` and `result = await <expr>;`.
function scanExprEnd(s: string, i: number, stop: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      j = skipString(s, j);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && stop.includes(c)) return j;
  }
  return s.length;
}

// Split the inside of a bracket group into top-level comma-separated parts (nested brackets/strings
// protected); whitespace-only parts (e.g. a trailing comma's tail) are dropped.
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(inner, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// Reverse promptLiteral: backtick content → the authored prompt. Placeholders first (the un-escaped
// ${prev}/${item} interpolations compile wrote), then unescape \${ \` \\.
function reversePrompt(lit: string): string {
  return lit
    .replace(/(?<!\\)\$\{prev\}/g, "{{prev}}")
    .replace(/(?<!\\)\$\{item\}/g, "{{item}}")
    .replace(/\\\$\{/g, "${")
    .replace(/\\`/g, "`")
    .replace(/\\\\/g, "\\");
}

interface GroupInfo {
  mode: PhaseMode;
  steps: Step[];
  iterateOver: string;
  iterateInWaves: boolean;
  maxParallel: number | null;
}

// A bounded-loop (wrapRepeat) wrapper peeled off the front of a step/phase expression, or null.
function peelRepeat(expr: string): { inner: string; repeat: RepeatSpec | null } {
  if (!expr.startsWith("(async () => {") || !expr.includes("let result = null;")) return { inner: expr, repeat: null };
  const roundsM = expr.match(/for \(let round = 0; round < (\d+); round\+\+\)/);
  const awaitIdx = expr.indexOf("result = await ");
  if (!roundsM || awaitIdx === -1) return { inner: expr, repeat: null };
  const from = awaitIdx + "result = await ".length;
  const end = scanExprEnd(expr, from, ";");
  const inner = expr.slice(from, end).trim();
  let until = "";
  const ifIdx = expr.indexOf("if (result && (", end);
  if (ifIdx !== -1) {
    const condOpen = expr.indexOf("(", ifIdx + 2); // the `(` of `if (…)`
    const condClose = findClose(expr, condOpen);
    if (condClose !== -1) {
      const cond = expr.slice(condOpen + 1, condClose).trim(); // result && (<until>)
      until = cond.replace(/^result && \(/, "").replace(/\)$/, "").trim();
    }
  }
  return { inner, repeat: { maxLoops: Number(roundsM[1]), until } };
}

// Parse ONE step expression (a thunk/stage body): an agent leaf or a container, plus its peeled repeat.
function parseStepExpr(expr: string): Step | null {
  const { inner, repeat } = peelRepeat(expr.trim());
  if (inner.startsWith("agent(")) {
    const a = parseAgentCall(inner);
    if (!a) return null;
    a.repeat = repeat;
    return a;
  }
  const g = parseGroupExpr(inner);
  if (!g || (g.mode !== "parallel" && g.mode !== "pipeline")) return null;
  return {
    type: "container",
    mode: g.mode,
    steps: g.steps,
    iterateOver: g.iterateOver,
    iterateInWaves: g.iterateInWaves,
    maxParallel: g.maxParallel,
    repeat,
  };
}

// Parse an `agent(<promptLiteral>, <opts>)` call. Only label/prompt/schema come from the body; the four
// knobs are overlaid from the marker side-trace afterwards.
function parseAgentCall(expr: string): Agent | null {
  const open = expr.indexOf("(");
  const close = findClose(expr, open);
  if (open === -1 || close === -1) return null;
  const args = expr.slice(open + 1, close);
  if (args[0] !== "`") return null;
  const promptEnd = skipString(args, 0); // args[0] is the backtick of the prompt literal
  const agent = blankAgent();
  agent.prompt = reversePrompt(args.slice(1, promptEnd));
  const rest = args.slice(promptEnd + 1).replace(/^\s*,\s*/, "");
  if (rest.startsWith("{")) {
    const objClose = findClose(rest, 0);
    const inner = objClose === -1 ? "" : rest.slice(1, objClose);
    for (const field of splitTopLevel(inner)) {
      const colon = field.indexOf(":");
      if (colon === -1) continue;
      const key = field.slice(0, colon).trim();
      const value = field.slice(colon + 1).trim();
      if (key === "label") {
        try {
          agent.label = JSON.parse(value) as string;
        } catch {
          return null;
        }
      } else if (key === "schema") {
        agent.schema = value;
      }
    }
  }
  return agent;
}

// The `prev["name"]` collection an iterateOver group fans out over.
function iterateOverName(arrExpr: string): string {
  const m = arrExpr.match(/prev\["((?:\\.|[^"\\])*)"\]/);
  return m ? m[1] : "";
}

// Parse a group expression → mode + steps (+ BP-134 settings). Handles: bare agent (mode single),
// parallel([...]) / parallel((arr).map(...)), pipeline([{}], …), and the maxParallel/iterateInWaves IIFEs.
function parseGroupExpr(expr: string): GroupInfo | null {
  expr = expr.trim();

  if (expr.startsWith("agent(")) {
    const a = parseAgentCall(expr);
    if (!a) return null;
    return { mode: "single", steps: [a], iterateOver: "", iterateInWaves: false, maxParallel: null };
  }

  if (expr.startsWith("pipeline(")) {
    const open = expr.indexOf("(");
    const close = findClose(expr, open);
    if (close === -1) return null;
    const steps: Step[] = [];
    for (const part of splitTopLevel(expr.slice(open + 1, close))) {
      if (part.startsWith("[{}]")) continue; // the seed
      const step = parseStepExpr(part.replace(/^\(prev\)\s*=>\s*/, ""));
      if (!step) return null;
      steps.push(step);
    }
    return { mode: "pipeline", steps, iterateOver: "", iterateInWaves: false, maxParallel: null };
  }

  if (expr.startsWith("parallel(")) {
    const close = findClose(expr, "parallel".length);
    if (close === -1) return null;
    return parseParallelArg(expr.slice("parallel(".length, close).trim());
  }

  if (expr.startsWith("(async () => {")) {
    if (expr.includes("const waves = ")) return parseWavesIife(expr);
    if (expr.includes("const items = ")) return parseMaxParallelIife(expr);
  }
  return null;
}

// The argument of parallel(...): either a static `[ () => step, … ]` or `(arr).map((item) => () => step)`.
function parseParallelArg(arg: string): GroupInfo | null {
  if (arg.startsWith("[")) {
    const close = findClose(arg, 0);
    if (close === -1) return null;
    const steps: Step[] = [];
    for (const part of splitTopLevel(arg.slice(1, close))) {
      const step = parseStepExpr(part.replace(/^\(\)\s*=>\s*/, ""));
      if (!step) return null;
      steps.push(step);
    }
    return { mode: "parallel", steps, iterateOver: "", iterateInWaves: false, maxParallel: null };
  }
  return parseMapArg(arg, null, false);
}

// `(arr).map((item) => () => <template>)` → an iterateOver group with a single per-item template step.
function parseMapArg(arg: string, maxParallel: number | null, inWaves: boolean): GroupInfo | null {
  const mapIdx = arg.lastIndexOf(".map(");
  if (mapIdx === -1) return null;
  const arrExpr = arg.slice(0, mapIdx);
  const mapOpen = mapIdx + ".map".length;
  const mapClose = findClose(arg, mapOpen);
  if (mapClose === -1) return null;
  const cb = arg.slice(mapOpen + 1, mapClose).replace(/^\(item\)\s*=>\s*\(\)\s*=>\s*/, "");
  const step = parseStepExpr(cb);
  if (!step) return null;
  return { mode: "parallel", steps: [step], iterateOver: iterateOverName(arrExpr), iterateInWaves: inWaves, maxParallel };
}

// A maxParallel batch IIFE: `const items = <thunksArrayExpr>;` + `i += <n>`. The thunksArrayExpr is itself
// a parallel argument (static list or an iterateOver .map), reused via parseParallelArg/parseMapArg.
function parseMaxParallelIife(expr: string): GroupInfo | null {
  const from = expr.indexOf("const items = ") + "const items = ".length;
  const thunks = expr.slice(from, scanExprEnd(expr, from, ";")).trim();
  const n = expr.match(/i \+= (\d+)\)/);
  const maxParallel = n ? Number(n[1]) : null;
  const inner = thunks.startsWith("[") ? parseParallelArg(thunks) : parseMapArg(thunks, maxParallel, false);
  if (!inner) return null;
  return { ...inner, maxParallel };
}

// An iterateInWaves IIFE: `const waves = <arr>;` and an inner `waveItems.map((item) => () => <template>)`.
function parseWavesIife(expr: string): GroupInfo | null {
  const from = expr.indexOf("const waves = ") + "const waves = ".length;
  const arr = expr.slice(from, scanExprEnd(expr, from, ";")).trim();
  const mapIdx = expr.indexOf("waveItems.map(");
  if (mapIdx === -1) return null;
  const mapOpen = mapIdx + "waveItems.map".length;
  const mapClose = findClose(expr, mapOpen);
  if (mapClose === -1) return null;
  const cb = expr.slice(mapOpen + 1, mapClose).replace(/^\(item\)\s*=>\s*\(\)\s*=>\s*/, "");
  const step = parseStepExpr(cb);
  if (!step) return null;
  const n = expr.match(/i \+= (\d+)\)/);
  return { mode: "parallel", steps: [step], iterateOver: iterateOverName(arr), iterateInWaves: true, maxParallel: n ? Number(n[1]) : null };
}

// Read a meta string field (name/description) — compile() writes both with dq (JSON.stringify), so the
// exact value round-trips through JSON.parse.
function readMetaStringField(source: string, key: string): string {
  const metaIdx = source.indexOf("export const meta = {");
  if (metaIdx === -1) return "";
  const m = source.slice(metaIdx).match(new RegExp(key + '\\s*:\\s*("(?:\\\\.|[^"\\\\])*")'));
  if (!m) return "";
  try {
    return JSON.parse(m[1]) as string;
  } catch {
    return "";
  }
}

// Byte positions where a `  phase("…")` line begins, scanned at top level (a prompt line that looks like
// one, inside a template literal, is skipped).
function phaseStarts(body: string): number[] {
  const starts: number[] = [];
  if (body.startsWith("  phase(")) starts.push(0);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(body, i);
      continue;
    }
    if (c === "\n" && body.startsWith("  phase(", i + 1)) starts.push(i + 1);
  }
  return starts;
}

// Parse one phase chunk (`  phase("…")` + `await <expr>`, optionally wrapped in a budget while-loop).
function parsePhaseChunk(chunk: string): Phase | null {
  const titleM = chunk.match(/^ {2}phase\("((?:\\.|[^"\\])*)"\)/);
  const title = titleM ? (JSON.parse('"' + titleM[1] + '"') as string) : "Phase";
  const budgetM = chunk.match(/while \(budget\.total && budget\.remaining\(\) > (\d+)\) \{/);
  const awaitIdx = chunk.indexOf("await ");
  if (awaitIdx === -1) return null;
  const from = awaitIdx + "await ".length;
  const exprEnd = budgetM ? chunk.lastIndexOf("\n  }") : chunk.length;
  const expr = chunk.slice(from, exprEnd === -1 ? chunk.length : exprEnd).trim();
  const { inner, repeat } = peelRepeat(expr);
  const g = parseGroupExpr(inner);
  if (!g) return null;
  return {
    title,
    mode: g.mode,
    repeatBudget: budgetM ? Number(budgetM[1]) : null,
    steps: g.steps,
    iterateOver: g.iterateOver,
    iterateInWaves: g.iterateInWaves,
    maxParallel: g.maxParallel,
    repeat,
  };
}

// Recover the tree by parsing the executable body. Returns null on any shape it does not recognise.
// The four agent knobs are left blank here; parse() overlays them from the marker side-trace.
export function parseBody(source: string): Tree | null {
  const metaIdx = source.indexOf("export const meta = {");
  if (metaIdx === -1) return null;
  const metaClose = findClose(source, source.indexOf("{", metaIdx));
  if (metaClose === -1) return null;
  const markerIdx = source.lastIndexOf("\n" + MARKER_LABEL);
  // Keep the phase lines' `  ` indent (a leading trim would hide the first `  phase(` from phaseStarts);
  // only trailing whitespace is dropped.
  const bodyText = source.slice(metaClose + 1, markerIdx === -1 ? source.length : markerIdx).replace(/\s+$/, "");
  const starts = phaseStarts(bodyText);
  if (starts.length === 0) return null;
  const phases: Phase[] = [];
  for (let k = 0; k < starts.length; k++) {
    const chunk = bodyText.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : bodyText.length).trimEnd();
    const phase = parsePhaseChunk(chunk);
    if (!phase) return null;
    phases.push(phase);
  }
  return { name: readMetaStringField(source, "name"), description: readMetaStringField(source, "description"), phases };
}

// Recompile the recovered tree and compare byte-for-byte (line endings normalised, trailing blank lines
// trimmed) — a hand-edited body no longer reproduces, so the file opens read-only instead of being
// silently overwritten. The side-trace is part of the recompiled text (not a separate check, since it
// isn't in the body), so editing it is safe — it is simply picked up as a change of agent knobs.
export function verifyRecompile(source: string, tree: Tree, engine: Engine): boolean {
  const norm = (s: string): string => s.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return norm(compile(tree, engine)) === norm(source);
}

// Overlay the marker's agent knobs onto the parsed tree, in the same DFS order writeMarker used.
function overlayKnobs(tree: Tree, knobs: AgentKnobs[]): void {
  collectAgents(tree).forEach((a, i) => {
    const k = knobs[i];
    a.agentType = k?.agentType ?? "";
    a.model = k?.model ?? "";
    a.effort = k?.effort ?? "";
    a.provider = k?.provider ?? "";
  });
}

// File → tree, or null (→ read-only). Order: a legacy mirror is trusted as before; otherwise our marker
// gates a body parse proven by recompile. `engine` is always known from the file's store (engineForStore).
export function parse(source: string, engine: Engine = "bb"): Tree | null {
  if (typeof source !== "string") return null;

  // New format FIRST: a file the current constructor wrote carries our marker. Checking it before the
  // legacy mirror matters because a new file's prompt/schema/description may legitimately contain the
  // literal "/* @composer-workflow" — routing it to the legacy branch would wrongly return null. The
  // recompile check keeps this safe even if a legacy file were somehow misread here.
  const marker = readMarker(source);
  if (marker) {
    const parsed = parseBody(source);
    if (!parsed) return null;
    overlayKnobs(parsed, marker.agents);
    const tree = normalizeTree(parsed);
    if (!verifyRecompile(source, tree, engine)) return null; // body hand-edited → read-only
    return tree;
  }

  // Legacy fallback: a file still carrying the old machine mirror — read it verbatim as before (trusted
  // unconditionally, the way the mirror always was; the recompile invariant does not apply here).
  const open = source.lastIndexOf(MIRROR_OPEN);
  if (open !== -1) {
    let body = source.slice(open + MIRROR_OPEN.length).trimEnd();
    if (body.endsWith(MIRROR_CLOSE)) body = body.slice(0, -MIRROR_CLOSE.length).trim();
    try {
      const raw = JSON.parse(body) as unknown;
      if (!raw || typeof raw !== "object" || !Array.isArray((raw as Tree).phases)) return null;
      return normalizeTree(raw as Tree);
    } catch {
      return null;
    }
  }

  return null; // no marker, no mirror → hand-written / foreign → read-only
}

// Back-fill every node with its current default fields, so a tree recovered from an older mirror matches
// today's shape. Unknown keys are dropped by rebuilding from the blank shapes; known values are kept.
function normalizeRepeat(r: unknown): RepeatSpec | null {
  if (!r || typeof r !== "object") return null;
  const maxLoops = (r as Partial<RepeatSpec>).maxLoops;
  const until = (r as Partial<RepeatSpec>).until;
  return {
    maxLoops: typeof maxLoops === "number" && maxLoops > 0 ? maxLoops : 1,
    until: typeof until === "string" ? until : "",
  };
}

function normalizeStep(step: Partial<Step> | null | undefined): Step {
  if (step && step.type === "container") {
    const mode: ContainerMode = step.mode === "pipeline" ? "pipeline" : "parallel";
    return {
      ...blankContainer(mode),
      steps: Array.isArray(step.steps) ? step.steps.map(normalizeStep) : [],
      iterateOver: typeof step.iterateOver === "string" ? step.iterateOver : "",
      iterateInWaves: step.iterateInWaves === true,
      maxParallel: typeof step.maxParallel === "number" ? step.maxParallel : null,
      repeat: normalizeRepeat(step.repeat),
    };
  }
  // A legacy mirror may carry now-removed fields (agent `tools`, container `title`); picking known keys
  // explicitly (rather than spreading `...a`) drops those old fields cleanly.
  const a = (step ?? {}) as Partial<Agent>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    type: "agent",
    label: str(a.label),
    prompt: str(a.prompt),
    model: str(a.model),
    provider: str(a.provider),
    effort: str(a.effort),
    agentType: str(a.agentType),
    schema: str(a.schema),
    repeat: normalizeRepeat(a.repeat),
  };
}

function normalizeTree(tree: Tree): Tree {
  return {
    name: typeof tree.name === "string" ? tree.name : "workflow",
    description: typeof tree.description === "string" ? tree.description : "",
    phases: (Array.isArray(tree.phases) ? tree.phases : []).map((p) => ({
      ...blankPhase(typeof p?.title === "string" ? p.title : "Phase"),
      mode: p?.mode ?? "single",
      repeatBudget: p?.repeatBudget ?? null,
      steps: Array.isArray(p?.steps) ? p.steps.map(normalizeStep) : [],
      iterateOver: typeof p?.iterateOver === "string" ? p.iterateOver : "",
      iterateInWaves: p?.iterateInWaves === true,
      maxParallel: typeof p?.maxParallel === "number" ? p.maxParallel : null,
      repeat: normalizeRepeat(p?.repeat),
    })),
  };
}

// Best-effort read of `description` from a hand-written workflow's `export const meta = {…}` block —
// the fallback the list uses when parse() finds no mirror (so a hand-written .js still shows a
// description, not a blank row). Scans from `export const meta` so a later `description:` in an agent's
// opts can't win, and accepts a single/double/backtick-quoted value that may start on the next line.
// Escaped newlines collapse to spaces for a one-line list label; unknown/malformed meta → "".
export function readMetaDescription(source: string): string {
  if (typeof source !== "string") return "";
  const metaIdx = source.indexOf("export const meta");
  if (metaIdx === -1) return "";
  const m = source.slice(metaIdx).match(/description\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/);
  if (!m) return "";
  return m[2]
    .replace(/\\n/g, " ")
    .replace(/\\(['"`\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- blank nodes ----
export function blankAgent(): Agent {
  return {
    type: "agent",
    label: "",
    prompt: "",
    model: "",
    provider: "",
    effort: "",
    agentType: "",
    schema: "",
    repeat: null,
  };
}
export function blankContainer(mode: ContainerMode = "parallel"): Container {
  return { type: "container", mode, steps: [blankAgent()], iterateOver: "", iterateInWaves: false, maxParallel: null, repeat: null };
}
export function blankPhase(title = "Phase"): Phase {
  return { title, mode: "single", repeatBudget: null, steps: [blankAgent()], iterateOver: "", iterateInWaves: false, maxParallel: null, repeat: null };
}
export function blankTree(name = "workflow"): Tree {
  return { name, description: "", phases: [blankPhase("Phase 1")] };
}
