import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  AUTO_MODE_DEFAULTS,
  ENV_FIELDS,
  ENV_TEMPLATE,
  autoModeSummary,
  readEnvironment,
  readRules,
  writeEnvironment,
  writeRules,
} from "../src/auto-mode";

const line = (key: string, value: string) => `**${key}**: ${value}`;
const word = fc.stringMatching(/^[a-z][a-z .:/;-]{0,20}[a-z]$/);
const envLine = fc.oneof(
  fc.tuple(fc.constantFrom(...ENV_FIELDS.map((field) => field.key)), word).map(([key, value]) => line(key, value)),
  word.map((text) => `### ${text}`),
  word,
  fc.constant("$defaults"),
);

describe("environment round trip", () => {
  it("a repeated key keeps both lines: the second goes to extra", () => {
    const state = readEnvironment([line("Organization", "A"), line("Organization", "B"), "note"], ENV_TEMPLATE);
    expect(state.values).toEqual({ Organization: "A" });
    expect(state.extra).toEqual([line("Organization", "B"), "note"]);
  });

  it("writing keeps every line except $defaults and values equal to the template", () => {
    fc.assert(
      fc.property(fc.array(envLine, { maxLength: 30 }), (lines) => {
        const written = writeEnvironment(readEnvironment(lines, ENV_TEMPLATE), ENV_TEMPLATE) ?? [];
        const kept = lines.filter((text) => {
          if (text === "$defaults") return false;
          const match = /^\*\*([^*]+)\*\*: (.*)$/.exec(text);
          return !(match && ENV_TEMPLATE[match[1]] === match[2]);
        });
        for (const text of kept) expect(written).toContain(text);
      }),
    );
  });

  it("reading what was written gives the same state", () => {
    fc.assert(
      fc.property(fc.array(envLine, { maxLength: 30 }), (lines) => {
        const state = readEnvironment(lines, ENV_TEMPLATE);
        expect(readEnvironment(writeEnvironment(state, ENV_TEMPLATE), ENV_TEMPLATE)).toEqual(state);
      }),
    );
  });
});

describe("rules round trip", () => {
  const builtins = AUTO_MODE_DEFAULTS.soft_deny.slice(0, 5);
  const ruleLine = fc.oneof(fc.constantFrom(...builtins), fc.constant("$defaults"), word);
  const effective = (lines: readonly string[] | undefined) =>
    new Set(lines === undefined ? builtins : lines.flatMap((rule) => (rule === "$defaults" ? builtins : [rule])));

  it("writing what was read keeps the effective rule set", () => {
    fc.assert(
      fc.property(fc.option(fc.array(ruleLine, { maxLength: 12 }), { nil: undefined }), (lines) => {
        expect(effective(writeRules(readRules(lines, builtins), builtins))).toEqual(effective(lines));
      }),
    );
  });
});

describe("autoModeSummary", () => {
  const total = AUTO_MODE_DEFAULTS.allow.length + AUTO_MODE_DEFAULTS.soft_deny.length + AUTO_MODE_DEFAULTS.hard_deny.length;

  it("unset is defaults and every built-in rule", () => {
    expect(autoModeSummary({})).toBe(`Environment: defaults · ${total} built-in rules`);
  });

  it("counts own fields, rules turned off and own rules", () => {
    const object = {
      environment: [line("Organization", "Acme")],
      soft_deny: [...AUTO_MODE_DEFAULTS.soft_deny.slice(1), "Mine: m"],
    };
    expect(autoModeSummary(object)).toBe(`1 own environment fields · ${total} built-in rules, 1 off · 1 own`);
  });

  it("a group that isn't a list of strings counts as unset", () => {
    expect(autoModeSummary({ allow: "oops" })).toBe(`Environment: defaults · ${total} built-in rules`);
  });
});
