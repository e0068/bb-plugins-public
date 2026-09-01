// validity.ts — pure validity checks over a workflow Tree for the constructor.
//
// For now the only rule: an agent step is usable only with a template chosen (non-empty agentType) —
// a template-less agent has no persona/tools to run. Groups carry no template; they recurse into their
// own steps. `agentsMissingTemplate` returns how many agents still lack one (0 = the tree is valid).

import { type Step, type Tree } from "./workflow-model";

function missingInSteps(steps: Step[]): number {
  return steps.reduce((n, step) => {
    if (step.type === "agent") return n + (step.agentType.trim() === "" ? 1 : 0);
    return n + missingInSteps(step.steps);
  }, 0);
}

export function agentsMissingTemplate(tree: Tree): number {
  return tree.phases.reduce((n, phase) => n + missingInSteps(phase.steps), 0);
}

export function isTreeValid(tree: Tree): boolean {
  return agentsMissingTemplate(tree) === 0;
}
