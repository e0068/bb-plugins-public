/* outline-ops.ts — pure, DOM-free mutations on a workflow Tree for the outline editor.
 *
 * The React prototype currently inlines these as ad-hoc state updates; pulling them out here keeps the
 * UI a thin dispatcher (editorStore.update((draft) => addStep(draft, path, "agent"))) and lets the tree
 * edits themselves be unit-tested without React.
 *
 * Every function MUTATES the tree it is given in place and returns void — callers run them inside a
 * store's `update((draft) => …)`, which already deep-clones, so a second clone here would be wasted
 * work. An invalid path is a no-op, never a thrown error: the editor calls these from UI handlers where
 * a stale path (e.g. the node was just removed by another action) must not crash the app.
 */

import { type Agent, type Container, type Phase, type Step, type Tree, blankAgent, blankContainer } from "./workflow-model";

// path[0] = phase index; every further index is a step index, descending into nested containers.
export type OutlinePath = number[];

// Resolve a path to the Phase or Step it names, or null when the path is empty or leaves the tree.
export function nodeAt(tree: Tree, path: OutlinePath): Phase | Step | null {
  if (path.length === 0) return null;
  const phase = tree.phases[path[0]];
  if (!phase) return null;
  if (path.length === 1) return phase;

  let node: Phase | Step = phase;
  for (let i = 1; i < path.length; i++) {
    const steps: Step[] | undefined = "steps" in node ? node.steps : undefined;
    const step: Step | undefined = steps ? steps[path[i]] : undefined;
    if (!step) return null;
    node = step;
  }
  return node;
}

// Resolve the `steps` array a basePath points at: the phase's steps at length 1, otherwise the
// container's steps. Returns null when basePath is invalid or names an agent (agents have no steps).
function stepsAt(tree: Tree, basePath: OutlinePath): Step[] | null {
  const node = nodeAt(tree, basePath);
  if (!node) return null;
  if ("steps" in node) return node.steps;
  return null;
}

export function addStep(tree: Tree, basePath: OutlinePath, kind: "agent" | "group"): void {
  const steps = stepsAt(tree, basePath);
  if (!steps) return;
  steps.push(kind === "agent" ? blankAgent() : blankContainer("parallel"));
}

export function addPhase(tree: Tree): void {
  const title = "Phase " + (tree.phases.length + 1);
  tree.phases.push({ title, mode: "parallel", repeatBudget: null, steps: [blankAgent()] });
}

export function removeNode(tree: Tree, path: OutlinePath): void {
  if (path.length === 0) return;
  if (path.length === 1) {
    if (path[0] < 0 || path[0] >= tree.phases.length) return;
    tree.phases.splice(path[0], 1);
    return;
  }
  const parentSteps = stepsAt(tree, path.slice(0, -1));
  const index = path[path.length - 1];
  if (!parentSteps || index < 0 || index >= parentSteps.length) return;
  parentSteps.splice(index, 1);
}

// Binary toggle: legacy "single" and "pipeline" both flip to "parallel"; "parallel" flips to "pipeline".
// The outline editor never offers "single" — it only survives as a parse() leftover from older trees.
function nextMode(mode: string): "parallel" | "pipeline" {
  return mode === "parallel" ? "pipeline" : "parallel";
}

// Phase and Container are the only nodes with a `mode`/`title` — an Agent has neither. This guard lets
// toggleMode/renameNode narrow `Phase | Step` to `Phase | Container` without an `as` cast.
function isModal(node: Phase | Step): node is Phase | Container {
  return !("type" in node) || node.type === "container";
}

// Narrows `Phase | Step` to `Agent`; a Phase has no `type` field at all, so check membership first.
function isAgent(node: Phase | Step): node is Agent {
  return "type" in node && node.type === "agent";
}

export function toggleMode(tree: Tree, path: OutlinePath): void {
  const node = nodeAt(tree, path);
  if (!node || !isModal(node)) return;
  node.mode = nextMode(node.mode);
}

export function renameNode(tree: Tree, path: OutlinePath, title: string): void {
  const node = nodeAt(tree, path);
  if (!node || !isModal(node)) return;
  node.title = title;
}

export function setAgentField(tree: Tree, path: OutlinePath, patch: Partial<Agent>): void {
  const node = nodeAt(tree, path);
  if (!node || !isAgent(node)) return;
  Object.assign(node, patch);
}

export function applyTemplate(
  tree: Tree,
  path: OutlinePath,
  agentType: string,
  info: { model: string; effort: string; provider: string },
): void {
  const node = nodeAt(tree, path);
  if (!node || !isAgent(node)) return;
  node.agentType = agentType;
  node.model = info.model;
  node.effort = info.effort;
  node.provider = info.provider;
  // tools intentionally untouched: for a templated agent they are read-only, sourced from the .md agent.
}
