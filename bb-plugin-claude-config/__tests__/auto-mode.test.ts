import { describe, expect, it } from "vitest";

import snapshot from "../src/auto-mode-defaults.json";
import {
  ENV_FIELDS,
  envTemplate,
  filledProjectFields,
  joinItems,
  listItems,
  readEnvironment,
  readRules,
  readVisibility,
  ruleTitle,
  toggleBuiltin,
  withEnvValue,
  withoutFields,
  writeEnvironment,
  writeRules,
} from "../src/auto-mode";

const template = envTemplate(snapshot.environment);
const line = (key: string, value: string) => `**${key}**: ${value}`;

describe("the snapshot and the field catalog", () => {
  it("every template line is a known field and every field has a template line", () => {
    expect(Object.keys(template).sort()).toEqual(ENV_FIELDS.map((field) => field.key).sort());
  });

  it("carries rules in all three groups", () => {
    expect(snapshot.allow.length).toBeGreaterThan(0);
    expect(snapshot.soft_deny.length).toBeGreaterThan(0);
    expect(snapshot.hard_deny.length).toBeGreaterThan(0);
  });
});

describe("readEnvironment / writeEnvironment", () => {
  it("an unset group reads as all defaults and writes back as unset", () => {
    const state = readEnvironment(undefined, template);
    expect(state).toEqual({ values: {}, extra: [] });
    expect(writeEnvironment(state, template)).toBeUndefined();
  });

  it("a line equal to its template value is not an own value", () => {
    const state = readEnvironment([line("Organization", template.Organization)], template);
    expect(state.values).toEqual({});
  });

  it("headings, plain text and unknown keys are kept in order as extra", () => {
    const lines = ["### Org-wide", line("Organization", "Acme"), "free text", line("Mystery", "x")];
    const state = readEnvironment(lines, template);
    expect(state.values).toEqual({ Organization: "Acme" });
    expect(state.extra).toEqual(["### Org-wide", "free text", line("Mystery", "x")]);
  });

  it("$defaults is dropped: the writer always spells out the template", () => {
    const state = readEnvironment(["$defaults", "note"], template);
    expect(state).toEqual({ values: {}, extra: ["note"] });
  });

  it("writes every template field in template order, own values in place, then extra", () => {
    const written = writeEnvironment(
      { values: { "Source control": "github.com:me/repo.git" }, extra: ["note"] },
      template,
    )!;
    expect(written).toHaveLength(ENV_FIELDS.length + 1);
    expect(written.slice(0, -1).map((text) => /^\*\*([^*]+)\*\*/.exec(text)![1])).toEqual(
      snapshot.environment.map((text) => /^\*\*([^*]+)\*\*/.exec(text)![1]),
    );
    expect(written).toContain(line("Source control", "github.com:me/repo.git"));
    expect(written.at(-1)).toBe("note");
  });

  it("round-trips own values and extra lines of any mix", () => {
    const samples: string[][] = [
      [line("Organization", "Acme"), "### Heading"],
      ["plain", line("Trusted cloud buckets", "gs://a; gs://b"), line("Unknown key", "v")],
      [line("Repository visibility", "public"), line("Organization", template.Organization)],
    ];
    for (const lines of samples) {
      const state = readEnvironment(lines, template);
      expect(readEnvironment(writeEnvironment(state, template), template)).toEqual(state);
    }
  });
});

describe("withEnvValue", () => {
  it("sets, and blank or template text removes", () => {
    const set = withEnvValue({ values: {}, extra: [] }, "Organization", "  Acme  ");
    expect(set.values).toEqual({ Organization: "Acme" });
    expect(withEnvValue(set, "Organization", " ").values).toEqual({});
    expect(withEnvValue(set, "Organization", template.Organization, template).values).toEqual({});
  });
});

describe("list fields", () => {
  it("split on semicolons and join with '; '", () => {
    expect(listItems("a; b ;c,d")).toEqual(["a", "b", "c,d"]);
    expect(listItems("")).toEqual([]);
    expect(joinItems(["a", " ", "b"])).toBe("a; b");
    expect(listItems(joinItems(["x (y, z)", "w"]))).toEqual(["x (y, z)", "w"]);
  });
});

describe("readVisibility", () => {
  it("reads private, public, default and anything else as custom text", () => {
    expect(readVisibility(undefined)).toEqual({ kind: "default" });
    expect(readVisibility("private (gh API)")).toEqual({ kind: "private" });
    expect(readVisibility("Public")).toEqual({ kind: "public" });
    expect(readVisibility("mixed")).toEqual({ kind: "custom", text: "mixed" });
  });
});

describe("project fields", () => {
  it("lists only filled project-only fields", () => {
    const state = { values: { "Source control": "x", Organization: "Acme" }, extra: [] };
    expect(filledProjectFields(state).map((field) => field.key)).toEqual(["Source control"]);
  });

  it("withoutFields drops exactly the named values and keeps extra lines", () => {
    const global = { values: { "Source control": "x", "Trusted repo": "y", Organization: "A" }, extra: ["n"] };
    expect(withoutFields(global, ["Source control", "Trusted repo"])).toEqual({
      values: { Organization: "A" },
      extra: ["n"],
    });
  });
});

describe("ruleTitle", () => {
  it("splits name, drops the bracket note, keeps the description", () => {
    expect(ruleTitle("Production Deploy [named+specifics — x]: Deploying to prod")).toEqual({
      name: "Production Deploy",
      description: "Deploying to prod",
    });
    expect(ruleTitle("Local Operations: Deleting local files")).toEqual({
      name: "Local Operations",
      description: "Deleting local files",
    });
    expect(ruleTitle("Bash(firebase deploy:*)")).toEqual({
      name: "Bash(firebase deploy:*)",
      description: "",
    });
  });
});

describe("readRules / writeRules", () => {
  const builtins = ["A: a", "B: b", "C: c"];

  it("an unset group has everything on and nothing own, and writes back as unset", () => {
    const state = readRules(undefined, builtins);
    expect(state).toEqual({ off: new Set(), own: [] });
    expect(writeRules(state, builtins)).toBeUndefined();
  });

  it("$defaults keeps every built-in on; other lines are own", () => {
    expect(readRules(["$defaults", "Mine: m"], builtins)).toEqual({ off: new Set(), own: ["Mine: m"] });
    expect(writeRules({ off: new Set(), own: ["Mine: m"] }, builtins)).toEqual(["$defaults", "Mine: m"]);
  });

  it("without $defaults a built-in missing from the list is off", () => {
    expect(readRules(["A: a", "C: c", "Mine: m"], builtins)).toEqual({
      off: new Set([1]),
      own: ["Mine: m"],
    });
  });

  it("turning one off spells out the rest verbatim, turning it back restores $defaults", () => {
    const off = toggleBuiltin({ off: new Set(), own: ["Mine: m"] }, 1);
    expect(writeRules(off, builtins)).toEqual(["A: a", "C: c", "Mine: m"]);
    const back = toggleBuiltin(off, 1);
    expect(writeRules(back, builtins)).toEqual(["$defaults", "Mine: m"]);
  });

  it("round-trips the effective rule set", () => {
    const samples: (string[] | undefined)[] = [
      undefined,
      ["$defaults"],
      ["B: b"],
      ["Mine: m", "A: a"],
      [],
      ["$defaults", "x", "y"],
    ];
    const effective = (lines: string[] | undefined) =>
      lines === undefined ? builtins : lines.flatMap((rule) => (rule === "$defaults" ? builtins : [rule]));
    for (const lines of samples) {
      const written = writeRules(readRules(lines, builtins), builtins);
      expect(new Set(effective(written))).toEqual(new Set(effective(lines)));
    }
  });
});
