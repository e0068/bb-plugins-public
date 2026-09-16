import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_RULES, parseRules, ruleProblems, type AutomationRules, type Rule } from "./automation";
import { STATUS_ACTIONS, rowStateShown, statusesShown } from "./automation-status";
import type { RowState } from "./row-status";

const rule = (id: string, triggers: Rule["triggers"], actions: Rule["actions"]): Rule => ({ id, triggers, actions });
const rules = (...list: Rule[]): AutomationRules => ({ version: 2, rules: list });

const STATES: RowState[] = [
  { kind: "uncommitted", busy: false },
  { kind: "committed", busy: false },
  { kind: "pr-open" },
  { kind: "pr-checking" },
  { kind: "pr-conflict" },
  { kind: "pr-reviewed" },
  { kind: "pr-merged" },
];

describe("thread status — the third kind of display", () => {
  it("is its own kind, one action per state the sidebar icon can show", () => {
    expect(STATUS_ACTIONS).toHaveLength(STATES.length);
    for (const id of STATUS_ACTIONS) expect(ACTIONS[id].domain).toBe("status");
  });

  it("by default every state shows, on the 20-second poll only", () => {
    const holding = DEFAULT_RULES.rules.filter((r) => r.actions.some((a) => a.startsWith("status.")));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.triggers).toEqual(["state.poll"]);
    expect([...holding[0]!.actions].sort()).toEqual([...STATUS_ACTIONS].sort());
    for (const state of STATES) expect(rowStateShown(DEFAULT_RULES, state)).toBe(true);
  });

  it("a state taken off the rules is not shown, the others still are", () => {
    const r = rules(rule("s", ["state.poll"], ["status.pr-merged"]));
    expect(rowStateShown(r, { kind: "pr-merged" })).toBe(true);
    expect(rowStateShown(r, { kind: "pr-open" })).toBe(false);
  });

  it("clearing the icon is always allowed", () => {
    expect(rowStateShown(rules(), { kind: "none" })).toBe(true);
  });

  it("a status in a row without the poll shows nothing — the poll is the only trigger that reaches the icon", () => {
    expect(statusesShown(rules(rule("s", ["state.env"], ["status.pr-open"]))).size).toBe(0);
    expect(ruleProblems(rule("s", ["state.env", "state.poll"], ["status.pr-open"]))).toHaveLength(1);
    expect(ruleProblems(rule("s", ["state.poll"], ["status.pr-open"]))).toEqual([]);
  });

  it("the old single glyph action becomes every status, in version 1 and version 2 alike", () => {
    for (const version of [1, 2]) {
      const parsed = parseRules({ version, rules: [{ id: "g", triggers: ["state.poll"], actions: ["show.row-glyph"] }] });
      const statuses = parsed.rules.flatMap((r) => r.actions).filter((a) => a.startsWith("status."));
      expect([...statuses].sort()).toEqual([...STATUS_ACTIONS].sort());
      expect(parsed.rules.flatMap(ruleProblems)).toEqual([]);
    }
  });
});
