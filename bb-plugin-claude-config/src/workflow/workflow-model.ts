/* workflow-model.ts — the workflow model + code generator/parser for the constructor.
 *
 * A workflow is ONE .js file that a `/workflows`-style engine (bb workflows OR Claude Code)
 * executes. In the constructor it is modelled as a TREE (workflow → phases → steps; a step is an
 * agent or a nested parallel/pipeline container). This module owns two pure, DOM-free, bb-free
 * concerns so it can be unit-tested on its own:
 *
 *   compile(tree)  → the .js source string the engine runs. It writes a human-readable
 *                    `export const meta = {…}` + body, THEN appends a machine-readable mirror of the
 *                    tree in a trailing `/* @composer-workflow … *\/` comment. parse() reads that
 *                    mirror back (100% reliable) instead of parsing arbitrary JS — so the round-trip
 *                    tree ↔ file is exact for files this constructor wrote.
 *
 *   parse(source)  → the tree recovered from the mirror, or null when the file has none (a
 *                    hand-written workflow is then opened as raw source, not reconstructed).
 *
 * Ported almost verbatim from composer-graph/editor/composer-workflow.js; the compile output is
 * identical, so files round-trip between the two constructors.
 *
 * The tree shape (also the mirror JSON):
 *   tree      = { name, description, phases:[phase] }
 *   phase     = { title, mode:"single"|"parallel"|"pipeline", repeatBudget:null|Number, steps:[step] }
 *   step      = agent | container
 *   agent     = { type:"agent", label, prompt, model, provider, effort, agentType, schema, tools:[String] }   // "" = omit
 *   container = { type:"container", mode:"parallel"|"pipeline", steps:[step], title }
 *
 * Modes: single = one step; parallel = N independent steps run at once; pipeline = N stages in order,
 * each stage sees the previous stage's result as `{{prev}}` interpolated into an agent prompt.
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

export interface Agent {
  type: "agent";
  label: string;
  prompt: string;
  model: string;
  provider: string;
  effort: string;
  agentType: string;
  schema: string;
  // Draft tool list for an inline agent not yet saved as a .md agent. NEITHER bb NOR Claude Code accept
  // `tools` as an agent() option, so this is NEVER emitted into the compiled body — editor state only,
  // round-tripped through the mirror. Once agentType picks a saved .md agent, the UI reads its tools
  // from the .md file instead of this field.
  tools: string[];
}

export interface Container {
  type: "container";
  mode: ContainerMode;
  steps: Step[];
  // Outline group name shown in the constructor. Round-trips through the mirror only; the compiled
  // body has no notion of a container's title.
  title: string;
}

export type Step = Agent | Container;

export interface Phase {
  title: string;
  mode: PhaseMode;
  repeatBudget: number | null;
  steps: Step[];
}

export interface Tree {
  name: string;
  description: string;
  phases: Phase[];
}

const MIRROR_OPEN = "/* @composer-workflow"; // the trailing mirror parse() reads back
const MIRROR_CLOSE = "*/";

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
// can splice in the previous stage's result. Escapes backslashes, backticks and ${ first, THEN restores
// the {{prev}} placeholder as a real interpolation.
function promptLiteral(s: unknown, allowPrev: boolean): string {
  let esc = String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
  esc = esc.replace(/\{\{prev\}\}/g, allowPrev ? "${prev}" : ""); // outside a pipeline stage {{prev}} has no meaning → drop it
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
function agentExpr(a: Agent, allowPrev: boolean, engine: Engine): string {
  return "agent(" + promptLiteral(a.prompt, allowPrev) + ", " + agentOpts(a, engine) + ")";
}

function stepExpr(step: Step, level: number, allowPrev: boolean, engine: Engine): string {
  if (step.type === "container") return modeExpr(step.mode, step.steps, level, engine);
  return agentExpr(step, allowPrev, engine);
}

// a composite expression for a (mode, steps) group — used by both a phase body and a nested container
function modeExpr(mode: string, steps: Step[], level: number, engine: Engine): string {
  steps = steps || [];
  if (mode === "single" || (steps.length === 1 && mode !== "pipeline" && mode !== "parallel"))
    return stepExpr(steps[0] || blankAgent(), level, false, engine);
  if (mode === "parallel") {
    const thunks = steps.map((s) => pad(level + 1) + "() => " + stepExpr(s, level + 1, false, engine));
    return "parallel([\n" + thunks.join(",\n") + ",\n" + pad(level) + "])";
  }
  // pipeline: seed with a single truthy placeholder item, each stage is (prev) => <step>; agents may use
  // {{prev}}. The seed is NOT null: the engine treats a null pipeline item as "dropped" and skips every
  // remaining stage, so pipeline([null]) silently runs zero agents. See task workflow-composer-pipeline-null-seed.
  const stages = steps.map(
    (s) => pad(level + 1) + "(prev) => " + stepExpr(s, level + 1, s.type !== "container", engine),
  );
  return "pipeline([{}],\n" + stages.join(",\n") + ",\n" + pad(level) + ")";
}

function phaseBody(phase: Phase, engine: Engine): string {
  const steps = phase.steps && phase.steps.length ? phase.steps : [blankAgent()];
  const mode = phase.mode || "single";
  const expr = modeExpr(mode === "single" && steps.length > 1 ? "parallel" : mode, steps, 1, engine);
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

// Compile the tree to .js for the target engine (default "bb", this IDE's own). The trailing mirror is
// engine-agnostic — it snapshots the tree verbatim, so parse() recovers it whichever engine wrote it.
export function compile(tree: Tree, engine: Engine = "bb"): string {
  tree = tree || blankTree("workflow");
  const body = (tree.phases || []).map((p) => phaseBody(p, engine)).join("\n\n");
  const mirror = MIRROR_OPEN + "\n" + JSON.stringify(tree, null, 2) + "\n" + MIRROR_CLOSE + "\n";
  return metaBlock(tree) + "\n\n" + body + "\n\n" + mirror;
}

// Recover the tree from the trailing mirror. Returns null when the file has no mirror (hand-written) or
// the mirror is not valid JSON. The mirror is compile()'s last output, so we read from the LAST opener
// and strip a trailing close marker — robust even if a prompt happens to contain "*/".
export function parse(source: string): Tree | null {
  if (typeof source !== "string") return null;
  const open = source.lastIndexOf(MIRROR_OPEN);
  if (open === -1) return null;
  let body = source.slice(open + MIRROR_OPEN.length).trimEnd();
  if (body.endsWith(MIRROR_CLOSE)) body = body.slice(0, -MIRROR_CLOSE.length).trim();
  try {
    const raw = JSON.parse(body) as unknown;
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as Tree).phases)) return null;
    // A mirror written before a field existed (e.g. an old file with no agent `tools` or group `title`)
    // parses to nodes missing that field. Fill defaults here so the recovered tree is always well-formed —
    // the UI can then read agent.tools/container.title without guarding every access.
    return normalizeTree(raw as Tree);
  } catch {
    return null;
  }
}

// Back-fill every node with its current default fields, so a tree recovered from an older mirror matches
// today's shape. Unknown keys are dropped by rebuilding from the blank shapes; known values are kept.
function normalizeStep(step: Partial<Step> | null | undefined): Step {
  if (step && step.type === "container") {
    const mode: ContainerMode = step.mode === "pipeline" ? "pipeline" : "parallel";
    return {
      ...blankContainer(mode),
      title: typeof step.title === "string" ? step.title : "",
      steps: Array.isArray(step.steps) ? step.steps.map(normalizeStep) : [],
    };
  }
  const a = (step ?? {}) as Partial<Agent>;
  return { ...blankAgent(), ...a, type: "agent", tools: Array.isArray(a.tools) ? a.tools : [] };
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
    tools: [],
  };
}
export function blankContainer(mode: ContainerMode = "parallel"): Container {
  return { type: "container", mode, steps: [blankAgent()], title: "" };
}
export function blankPhase(title = "Phase"): Phase {
  return { title, mode: "single", repeatBudget: null, steps: [blankAgent()] };
}
export function blankTree(name = "workflow"): Tree {
  return { name, description: "", phases: [blankPhase("Phase 1")] };
}
