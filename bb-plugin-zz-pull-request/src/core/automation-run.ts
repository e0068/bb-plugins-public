// Layer 1 (core) — runs one trigger over the rules. The effects are injected,
// so this module decides only the order: which actions, when an outcome's
// actions run, when the run stops.
//
//   - actions run in rule order, then tag order (actionsFor);
//   - an outcome an action emits runs right after that action, before the
//     rest of the row — the local main is pulled before an archive, as it was;
//   - a refused step (`ok: false`) stops the run outright: nothing after a
//     refused merge, so no archive of a branch that never landed, and no
//     `outcome.mutated` either — a refusal is the plain answer "nothing
//     happened" (a refused Merge click publishes nothing, as before);
//   - every trigger fires and every action runs at most once per run, which
//     also ends any cycle between outcomes;
//   - `outcome.mutated` fires once at the very end when anything ran — also
//     after a throw, so a failed fast-forward still makes the header re-check;
//   - display actions (buttons, notifications) are skipped: the front end
//     applies those.
import { actionsFor, isDisplayAction, type AutomationRules, type DoActionId, type OutcomeTrigger, type TriggerId } from "./automation";

export type StepResult = { ok: true; emits?: readonly OutcomeTrigger[] } | { ok: false };
export type Effects = Readonly<Record<DoActionId, () => Promise<StepResult>>>;
export interface RunReport {
  executed: DoActionId[];
  stopped: boolean;
}

export async function runTrigger(rules: AutomationRules, trigger: TriggerId, effects: Effects): Promise<RunReport> {
  const fired = new Set<TriggerId>();
  const executed: DoActionId[] = [];
  let stopped = false;

  const fire = async (current: TriggerId): Promise<void> => {
    if (stopped || fired.has(current)) return;
    fired.add(current);
    for (const action of actionsFor(rules, current)) {
      if (stopped) return;
      if (isDisplayAction(action) || executed.includes(action)) continue;
      executed.push(action);
      const result = await effects[action]();
      if (!result.ok) {
        stopped = true;
        return;
      }
      for (const outcome of result.emits ?? []) await fire(outcome);
    }
  };

  const settle = () => (executed.length > 0 && !stopped ? fire("outcome.mutated") : Promise.resolve());
  try {
    await fire(trigger);
  } catch (error) {
    await settle();
    throw error;
  }
  await settle();
  return { executed, stopped };
}
