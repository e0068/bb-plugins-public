import { describe, expect, it } from "vitest";

import {
  BUILT_IN_DEFAULTS,
  modeChoices,
  modeOf,
  parseInline,
  parseRuleSet,
  parseRuleSetText,
  ruleSetFor,
  rulesOf,
  withMode,
  withRules,
  withoutGroup,
} from "../src/rule-set";

const autoMode = ruleSetFor("autoMode")!;
const permissions = ruleSetFor("permissions")!;

describe("ruleSetFor", () => {
  it("a key without a rule editor has none", () => {
    expect(ruleSetFor("statusLine")).toBeUndefined();
  });
});

describe("parseRuleSet", () => {
  it("unset reads as an empty set", () => {
    expect(parseRuleSet(autoMode, undefined)).toEqual({ ok: true, object: {} });
  });

  it("an object of string lists parses as is", () => {
    const value = { soft_deny: [BUILT_IN_DEFAULTS, "Bash(firebase deploy:*)"], environment: [] };
    expect(parseRuleSet(autoMode, value)).toEqual({ ok: true, object: value });
  });

  it("keys the editor doesn't know don't block parsing", () => {
    const value = { allow: ["Read"], additionalDirectories: ["~/x"], other: { a: 1 } };
    expect(parseRuleSet(permissions, value)).toEqual({ ok: true, object: value });
  });

  it.each([
    ["an array", ["allow"]],
    ["a string", "allow"],
    ["null", null],
    ["a number", 3],
  ])("%s is not a rule set", (_, value) => {
    expect(parseRuleSet(autoMode, value).ok).toBe(false);
  });

  it("a group that is not a list names the group", () => {
    const result = parseRuleSet(autoMode, { soft_deny: "Bash(x)" });
    expect(result).toEqual({ ok: false, reason: "soft_deny isn't a list of strings." });
  });

  it("a group with a non-string item names the group", () => {
    const result = parseRuleSet(permissions, { deny: ["Read", 1] });
    expect(result).toEqual({ ok: false, reason: "deny isn't a list of strings." });
  });

  it("a mode that is not a string names the mode key", () => {
    const result = parseRuleSet(permissions, { defaultMode: 1 });
    expect(result).toEqual({ ok: false, reason: "defaultMode isn't a string." });
  });
});

describe("rulesOf", () => {
  it("returns the group's rules, or none when the group is absent", () => {
    expect(rulesOf({ allow: ["a", "b"] }, "allow")).toEqual(["a", "b"]);
    expect(rulesOf({ allow: ["a"] }, "deny")).toEqual([]);
  });
});

describe("withRules / withoutGroup / withMode", () => {
  const object = { defaultMode: "plan", allow: ["a"], deny: ["d"], extra: 1 };

  it("replaces one group, keeping every other key and the key order", () => {
    const next = withRules(object, "allow", ["a", "b"]);
    expect(next).toEqual({ defaultMode: "plan", allow: ["a", "b"], deny: ["d"], extra: 1 });
    expect(Object.keys(next)).toEqual(Object.keys(object));
  });

  it("a new group goes to the end", () => {
    expect(Object.keys(withRules(object, "ask", ["q"]))).toEqual([
      "defaultMode",
      "allow",
      "deny",
      "extra",
      "ask",
    ]);
  });

  it("an emptied group stays as an empty list", () => {
    expect(withRules(object, "deny", [])).toEqual({ ...object, deny: [] });
  });

  it("withoutGroup drops the key and nothing else", () => {
    expect(withoutGroup(object, "deny")).toEqual({ defaultMode: "plan", allow: ["a"], extra: 1 });
  });

  it("withMode sets the mode key in place", () => {
    const next = withMode(object, "defaultMode", "acceptEdits");
    expect(next).toEqual({ ...object, defaultMode: "acceptEdits" });
    expect(Object.keys(next)).toEqual(Object.keys(object));
  });

  it("never touches the input object", () => {
    const frozen = Object.freeze({ allow: Object.freeze(["a"]) });
    withRules(frozen, "allow", ["b"]);
    withoutGroup(frozen, "allow");
    withMode(frozen, "defaultMode", "plan");
    expect(frozen).toEqual({ allow: ["a"] });
  });
});

describe("modeChoices", () => {
  it("offers the permission modes", () => {
    expect(modeChoices(permissions.mode!, undefined)).toEqual(permissions.mode!.options);
  });

  it("keeps an unknown current mode selectable instead of hiding it", () => {
    const choices = modeChoices(permissions.mode!, "someFutureMode");
    expect(choices).toEqual([...permissions.mode!.options, "someFutureMode"]);
  });
});

describe("parseInline", () => {
  it("splits bold and code out of plain text", () => {
    expect(parseInline("from `~/x` and **y** ok")).toEqual([
      { kind: "text", text: "from " },
      { kind: "code", text: "~/x" },
      { kind: "text", text: " and " },
      { kind: "strong", text: "y" },
      { kind: "text", text: " ok" },
    ]);
  });

  it("plain text is one span", () => {
    expect(parseInline("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });

  it("joining the spans' text loses nothing but the markers", () => {
    const line = "a **b** `c` d**";
    const joined = parseInline(line)
      .map((span) => span.text)
      .join("");
    expect(joined).toBe("a b c d**");
  });
});

describe("parseRuleSetText", () => {
  it("null (unset at every level) reads as an empty set", () => {
    expect(parseRuleSetText(autoMode, null)).toEqual({ ok: true, object: {} });
  });

  it("JSON text of a rule set parses into it", () => {
    expect(parseRuleSetText(permissions, '{"allow":["Read"]}')).toEqual({
      ok: true,
      object: { allow: ["Read"] },
    });
  });

  it("broken JSON is not a rule set, without throwing", () => {
    expect(parseRuleSetText(autoMode, "{").ok).toBe(false);
  });

  it("valid JSON of the wrong shape carries the shape's reason", () => {
    expect(parseRuleSetText(autoMode, '{"allow":"x"}')).toEqual({
      ok: false,
      reason: "allow isn't a list of strings.",
    });
  });
});

describe("modeOf", () => {
  it("returns the mode when set, nothing when absent or not a string", () => {
    expect(modeOf({ defaultMode: "plan" }, "defaultMode")).toBe("plan");
    expect(modeOf({}, "defaultMode")).toBeUndefined();
    expect(modeOf({ defaultMode: 3 }, "defaultMode")).toBeUndefined();
  });
});
