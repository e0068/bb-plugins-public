import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type AutomationRules, type DoActionId, type Rule } from "./automation";
import { runTrigger, type Effects, type StepResult } from "./automation-run";

const rules = (...list: Rule[]): AutomationRules => ({ version: 1, rules: list });

/** Fake effects that log every call; `plan` overrides what a given action answers. */
function fakeEffects(plan: Partial<Record<DoActionId, () => StepResult | Promise<StepResult>>> = {}) {
  const log: DoActionId[] = [];
  const effects = new Proxy({} as Effects, {
    get: (_, id: string) => async () => {
      log.push(id as DoActionId);
      return (await plan[id as DoActionId]?.()) ?? { ok: true };
    },
  });
  return { log, effects };
}

describe("runTrigger on the default rules", () => {
  it("runs a merge, its outcome right after it, then the refresh once", async () => {
    const { log, effects } = fakeEffects({ "git.merge": () => ({ ok: true, emits: ["outcome.merged"] }) });
    await runTrigger(DEFAULT_RULES, "click.merge-archive", effects);
    expect(log).toEqual(["files.bump-versions", "git.merge", "git.pull-main", "bb.reinstall", "bb.tasks-done", "bb.archive", "bb.refresh"]);
  });

  it("stops completely after a refused merge — no archive, no refresh: the refusal changed nothing", async () => {
    const { log, effects } = fakeEffects({ "git.merge": () => ({ ok: false }) });
    const report = await runTrigger(DEFAULT_RULES, "click.merge-archive", effects);
    expect(log).toEqual(["files.bump-versions", "git.merge"]);
    expect(report.stopped).toBe(true);
  });

  it("refreshes even when an action throws, and rethrows", async () => {
    const { log, effects } = fakeEffects({ "git.fast-forward": () => Promise.reject(new Error("diverged")) });
    await expect(runTrigger(DEFAULT_RULES, "click.ff", effects)).rejects.toThrow("diverged");
    expect(log).toEqual(["git.fast-forward", "bb.refresh"]);
  });

  it("runs nothing, not even the refresh, for a trigger no rule holds", async () => {
    const { log, effects } = fakeEffects();
    await runTrigger(rules(), "click.merge", effects);
    expect(log).toEqual([]);
  });
});

describe("runTrigger semantics", () => {
  it("skips show actions — the front end applies those", async () => {
    const { log, effects } = fakeEffects();
    await runTrigger(rules({ id: "a", triggers: ["click.merge"], actions: ["show.merge", "git.merge"] }), "click.merge", effects);
    expect(log).toEqual(["git.merge"]);
  });

  it("runs each action once per run, even when two triggers reach it", async () => {
    const { log, effects } = fakeEffects({ "git.merge": () => ({ ok: true, emits: ["outcome.merged"] }) });
    const r = rules(
      { id: "a", triggers: ["click.merge"], actions: ["git.merge", "git.pull-main"] },
      { id: "b", triggers: ["outcome.merged"], actions: ["git.pull-main", "git.merge"] },
    );
    await runTrigger(r, "click.merge", effects);
    expect(log).toEqual(["git.merge", "git.pull-main"]);
  });

  it("fires each outcome once, so a cycle ends", async () => {
    const { log, effects } = fakeEffects({
      "git.create-pr": () => ({ ok: true, emits: ["outcome.pr-created"] }),
      "bb.refresh": () => ({ ok: true, emits: ["outcome.pr-created"] }),
    });
    const r = rules(
      { id: "a", triggers: ["click.pr"], actions: ["git.create-pr"] },
      { id: "b", triggers: ["outcome.pr-created"], actions: ["bb.refresh"] },
    );
    await runTrigger(r, "click.pr", effects);
    expect(log).toEqual(["git.create-pr", "bb.refresh"]);
  });

  it("follows the order of the tags", async () => {
    const { log, effects } = fakeEffects();
    await runTrigger(rules({ id: "a", triggers: ["click.archive"], actions: ["bb.archive", "bb.tasks-done"] }), "click.archive", effects);
    expect(log).toEqual(["bb.archive", "bb.tasks-done"]);
  });
});
