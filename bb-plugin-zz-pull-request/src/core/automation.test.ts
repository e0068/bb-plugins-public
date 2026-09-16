import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ACTION_IDS,
  DEFAULT_RULES,
  TRIGGER_IDS,
  actionsFor,
  archiveNeedsPreflight,
  moveRule,
  normalizeRules,
  parseRules,
  ruleGroup,
  ruleProblems,
  sameRules,
  shownBy,
  type AutomationRules,
  type Rule,
} from "./automation";

const rule = (id: string, triggers: Rule["triggers"], actions: Rule["actions"]): Rule => ({ id, triggers, actions });
const rules = (...list: Rule[]): AutomationRules => ({ version: 1, rules: list });

const arbRule = fc.record({
  id: fc.uuid(),
  triggers: fc.uniqueArray(fc.constantFrom(...TRIGGER_IDS), { maxLength: 4 }),
  actions: fc.uniqueArray(fc.constantFrom(...ACTION_IDS), { maxLength: 5 }),
});
const arbRules = fc.array(arbRule, { maxLength: 8 }).map((list) => rules(...list));

describe("default rules", () => {
  it("parse to themselves", () => {
    expect(parseRules(JSON.parse(JSON.stringify(DEFAULT_RULES)))).toEqual(DEFAULT_RULES);
  });

  it("are already normalized", () => {
    expect(normalizeRules(DEFAULT_RULES)).toEqual(DEFAULT_RULES);
  });

  it("pull main and reinstall once a PR is merged", () => {
    expect(actionsFor(DEFAULT_RULES, "outcome.merged")).toEqual(["git.pull-main", "bb.reinstall"]);
  });

  it("show the Merge button on every state trigger", () => {
    expect([...shownBy(DEFAULT_RULES, "show.merge")].sort()).toEqual(["state.env", "state.open", "state.poll", "state.thread-pr"]);
  });

  it("give every rule a trigger and no problem", () => {
    expect(DEFAULT_RULES.rules.flatMap(ruleProblems)).toEqual([]);
  });
});

describe("actionsFor", () => {
  it("joins the actions of every rule holding the trigger, in rule order, without repeats", () => {
    const r = rules(rule("a", ["click.merge"], ["git.merge", "bb.refresh"]), rule("b", ["click.merge", "click.ff"], ["git.pull-main", "git.merge"]));
    expect(actionsFor(r, "click.merge")).toEqual(["git.merge", "bb.refresh", "git.pull-main"]);
  });

  it("is empty for a trigger no rule holds", () => {
    expect(actionsFor(rules(rule("a", ["click.merge"], ["git.merge"])), "click.wake")).toEqual([]);
  });
});

describe("shownBy", () => {
  it("is empty once the show action is in no rule", () => {
    const r = rules(rule("a", ["state.open"], ["show.pr"]));
    expect(shownBy(r, "show.merge").size).toBe(0);
  });

  it("ignores a rule without triggers", () => {
    expect(shownBy(rules(rule("a", [], ["show.merge"])), "show.merge").size).toBe(0);
  });
});

describe("parseRules", () => {
  it("keeps an empty rule list as empty — the owner removed everything on purpose", () => {
    expect(parseRules({ version: 1, rules: [] }).rules).toEqual([]);
  });

  it("round-trips any normalized rules", () => {
    fc.assert(fc.property(arbRules, (r) => {
      const n = normalizeRules(r);
      expect(parseRules(JSON.parse(JSON.stringify(n)))).toEqual(n);
    }));
  });
});

describe("normalizeRules", () => {
  it("is idempotent and keeps the set of rules", () => {
    fc.assert(fc.property(arbRules, (r) => {
      const once = normalizeRules(r);
      expect(normalizeRules(once)).toEqual(once);
      expect(once.rules.map((x) => x.id).sort()).toEqual(r.rules.map((x) => x.id).sort());
    }));
  });

  it("orders groups click, state, outcome, then rules without a trigger, keeping order inside a group", () => {
    const r = rules(rule("o", ["outcome.merged"], []), rule("n", [], []), rule("c1", ["click.ff"], []), rule("s", ["state.poll"], []), rule("c2", ["click.pr"], []));
    expect(normalizeRules(r).rules.map((x) => x.id)).toEqual(["c1", "c2", "s", "o", "n"]);
  });

  it("drops repeated tags inside a rule", () => {
    const r = rules(rule("a", ["click.ff", "click.ff"], ["git.fast-forward", "git.fast-forward"]));
    expect(normalizeRules(r).rules[0]).toEqual(rule("a", ["click.ff"], ["git.fast-forward"]));
  });
});

describe("ruleGroup", () => {
  it("is the group of the first trigger", () => {
    expect(ruleGroup(rule("a", ["outcome.merged", "click.pr"], []))).toBe("outcome");
    expect(ruleGroup(rule("a", [], []))).toBe("none");
  });
});

describe("moveRule", () => {
  it("keeps the rule set and never moves a rule out of its group", () => {
    fc.assert(fc.property(arbRules, fc.nat(), fc.nat(), (r, pick, to) => {
      const n = normalizeRules(r);
      if (n.rules.length === 0) return;
      const moved = n.rules[pick % n.rules.length]!;
      const next = moveRule(n, moved.id, to % (n.rules.length + 1));
      expect(next.rules.map((x) => x.id).sort()).toEqual(n.rules.map((x) => x.id).sort());
      expect(normalizeRules(next)).toEqual(next);
      expect(next.rules.map(ruleGroup)).toEqual(n.rules.map(ruleGroup));
    }));
  });

  it("moves a rule to the target index inside its group", () => {
    const r = rules(rule("a", ["click.pr"], []), rule("b", ["click.ff"], []), rule("c", ["click.wake"], []), rule("s", ["state.poll"], []));
    expect(moveRule(r, "c", 0).rules.map((x) => x.id)).toEqual(["c", "a", "b", "s"]);
    expect(moveRule(r, "a", 3).rules.map((x) => x.id)).toEqual(["b", "c", "a", "s"]);
  });
});

describe("ruleProblems", () => {
  it("names a rule with actions but no trigger", () => {
    expect(ruleProblems(rule("a", [], ["bb.archive"]))).toHaveLength(1);
  });

  it("names an archive placed before the merge", () => {
    expect(ruleProblems(rule("a", ["click.merge"], ["bb.archive", "git.merge"]))).toHaveLength(1);
    expect(ruleProblems(rule("a", ["click.merge"], ["git.merge", "bb.archive"]))).toEqual([]);
  });
});

describe("archiveNeedsPreflight", () => {
  it("is true only for an archive with no merge before it", () => {
    expect(archiveNeedsPreflight(["bb.tasks-done", "bb.archive"])).toBe(true);
    expect(archiveNeedsPreflight(["git.merge", "bb.tasks-done", "bb.archive"])).toBe(false);
    expect(archiveNeedsPreflight(["git.merge"])).toBe(false);
  });
});

describe("sameRules", () => {
  it("tells the defaults from an edited copy", () => {
    expect(sameRules(DEFAULT_RULES, parseRules(DEFAULT_RULES))).toBe(true);
    expect(sameRules(DEFAULT_RULES, rules(...DEFAULT_RULES.rules.slice(1)))).toBe(false);
  });
});
