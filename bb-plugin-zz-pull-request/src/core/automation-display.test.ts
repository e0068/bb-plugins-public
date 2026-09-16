import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  DEFAULT_RULES,
  actionsFor,
  isDisplayAction,
  parseRules,
  ruleProblems,
  type AutomationRules,
  type Rule,
} from "./automation";
import { runTrigger } from "./automation-run";
import { notificationsFor } from "./automation-notify";
import type { Notification } from "./notification";

const rule = (id: string, triggers: Rule["triggers"], actions: Rule["actions"]): Rule => ({ id, triggers, actions });
const rules = (...list: Rule[]): AutomationRules => ({ version: 2, rules: list });
const STATE = ["state.open", "state.env", "state.thread-pr", "state.poll"] as const;

/** The rules as version 1 stored them — the shape the owner's saved table still has. */
const V1_DEFAULTS = {
  version: 1,
  rules: [
    { id: "click-pr", triggers: ["click.pr"], actions: ["git.create-pr", "bb.tasks-in-review"] },
    { id: "click-pr-merge", triggers: ["click.pr-merge"], actions: ["git.create-pr", "bb.tasks-in-review", "files.bump-versions", "git.merge"] },
    { id: "click-pr-merge-archive", triggers: ["click.pr-merge-archive"], actions: ["git.create-pr", "files.bump-versions", "git.merge", "bb.tasks-done", "bb.archive"] },
    { id: "click-merge", triggers: ["click.merge"], actions: ["files.bump-versions", "git.merge"] },
    { id: "click-merge-archive", triggers: ["click.merge-archive"], actions: ["files.bump-versions", "git.merge", "bb.tasks-done", "bb.archive"] },
    { id: "click-archive", triggers: ["click.archive"], actions: ["bb.tasks-done", "bb.archive"] },
    { id: "click-ff", triggers: ["click.ff"], actions: ["git.fast-forward"] },
    { id: "click-wake", triggers: ["click.wake"], actions: ["bb.wake"] },
    { id: "click-retry-main", triggers: ["click.retry-main"], actions: ["git.pull-main"] },
    { id: "state-show", triggers: [...STATE], actions: ["show.wake", "show.ff", "show.pr", "show.merge", "show.main-not-pulled", "show.archive", "show.row-glyph"] },
    { id: "outcome-merged", triggers: ["outcome.merged"], actions: ["git.pull-main", "bb.reinstall"] },
    { id: "outcome-mutated", triggers: ["outcome.mutated"], actions: ["bb.refresh"] },
  ],
};

const note = (tone: Notification["tone"], prompt = false): Notification => ({
  tone,
  title: tone,
  details: [],
  link: null,
  ...(prompt ? { prompt: { confirmLabel: "y", cancelLabel: "n", repoint: { pluginId: "p", from: "path", source: "git", subdirectory: "d" } } } : {}),
});

describe("display actions: buttons and notifications", () => {
  it("are two kinds of action, and a run executes neither", async () => {
    expect(ACTIONS["show.merge"].domain).toBe("button");
    expect(ACTIONS["notify.result"].domain).toBe("notify");
    const log: string[] = [];
    const effects = new Proxy({} as never, { get: (_, id: string) => async () => (log.push(id), { ok: true }) });
    await runTrigger(rules(rule("a", ["click.merge"], ["notify.result", "show.merge", "git.merge"])), "click.merge", effects);
    expect(log).toEqual(["git.merge"]);
  });

  it("the default Merge click still runs bump then merge, and shows every kind of notification", () => {
    const actions = actionsFor(DEFAULT_RULES, "click.merge");
    expect(actions.filter((a) => !isDisplayAction(a))).toEqual(["files.bump-versions", "git.merge"]);
    expect(actions.filter((a) => a.startsWith("notify."))).toEqual(["notify.result", "notify.warnings", "notify.prompts", "notify.errors"]);
  });

  it("every default click row shows its errors", () => {
    for (const r of DEFAULT_RULES.rules.filter((x) => x.triggers.some((t) => t.startsWith("click.")))) {
      expect(r.actions).toContain("notify.errors");
    }
  });

  it("every default button is its own row with the four state triggers", () => {
    for (const show of ["show.wake", "show.ff", "show.pr", "show.merge", "show.main-not-pulled", "show.archive"] as const) {
      const holding = DEFAULT_RULES.rules.filter((r) => r.actions.includes(show));
      expect(holding).toHaveLength(1);
      expect(holding[0]!.actions).toEqual([show]);
      expect([...holding[0]!.triggers]).toEqual([...STATE]);
    }
  });

});

describe("ruleProblems for display actions", () => {
  it("names a notification in a row without a click", () => {
    expect(ruleProblems(rule("n", ["outcome.merged"], ["notify.result"]))).toHaveLength(1);
    expect(ruleProblems(rule("n", ["click.merge"], ["notify.result"]))).toEqual([]);
  });
});

describe("parseRules, version 2", () => {
  it("falls back to the defaults on garbage", () => {
    for (const junk of [null, 42, "x", { version: 3, rules: [] }, { rules: "no" }]) {
      expect(parseRules(junk)).toEqual(DEFAULT_RULES);
    }
  });

  it("drops ids it does not know and keeps the rest", () => {
    const parsed = parseRules({ version: 2, rules: [{ id: "a", triggers: ["click.merge", "click.gone"], actions: ["git.merge", "do.gone"] }] });
    expect(parsed.rules).toEqual([rule("a", ["click.merge"], ["git.merge"])]);
  });

  it("turns the version 1 defaults into exactly the version 2 defaults", () => {
    expect(parseRules(V1_DEFAULTS)).toEqual(DEFAULT_RULES);
  });

  it("keeps the owner's version 1 edits while migrating", () => {
    const edited = { ...V1_DEFAULTS, rules: V1_DEFAULTS.rules.map((r) => (r.id === "click-pr" ? { ...r, actions: [...r.actions, "files.bump-versions"] } : r)) };
    const migrated = parseRules(edited);
    expect(migrated.version).toBe(2);
    expect(migrated.rules.find((r) => r.id === "click-pr")!.actions).toEqual([
      "git.create-pr",
      "bb.tasks-in-review",
      "files.bump-versions",
      "notify.result",
      "notify.warnings",
      "notify.errors",
    ]);
    expect(migrated.rules.flatMap(ruleProblems)).toEqual([]);
    expect(new Set(migrated.rules.map((r) => r.id)).size).toBe(migrated.rules.length);
  });
});

describe("notificationsFor", () => {
  const all = [note("success"), note("warning"), note("warning", true), note("error")];

  it("keeps each notification only when the click's rules show its kind", () => {
    const only = (...actions: Rule["actions"]) => notificationsFor(rules(rule("a", ["click.merge"], actions)), "click.merge", all);
    expect(only("notify.result")).toEqual([all[0]]);
    expect(only("notify.warnings")).toEqual([all[1]]);
    expect(only("notify.prompts")).toEqual([all[2]]);
    expect(only("notify.errors")).toEqual([all[3]]);
    expect(only()).toEqual([]);
  });

  it("takes one notification as well as a list", () => {
    expect(notificationsFor(DEFAULT_RULES, "click.ff", note("success"))).toHaveLength(1);
    expect(notificationsFor(DEFAULT_RULES, "click.wake", note("success"))).toHaveLength(0);
  });
});
