// Layer 1 — settings keys whose value is groups of rule strings (autoMode,
// permissions): which groups a key has, total parsing of its JSON value into
// an editable object, immutable edits that keep every key and rule the
// editor doesn't touch exactly where it was, and a permission rule as a tool
// plus a pattern. No I/O and no React: the
// Settings row in app.tsx reads the value, calls these, and writes back the
// re-encoded JSON through the same path the plain JSON block uses.

/** The rule that splices Claude Code's built-in list into an autoMode group. */
export const BUILT_IN_DEFAULTS = "$defaults";

export interface RuleGroupDef {
  key: string;
  label: string;
}

export interface RuleModeDef {
  key: string;
  label: string;
  options: readonly string[];
}

export interface RuleSetDef {
  groups: readonly RuleGroupDef[];
  /** A single-choice key living next to the groups, or null. */
  mode: RuleModeDef | null;
}

const RULE_SETS: Readonly<Record<string, RuleSetDef>> = {
  autoMode: {
    groups: [
      { key: "allow", label: "Allow" },
      { key: "soft_deny", label: "Soft deny" },
      { key: "hard_deny", label: "Hard deny" },
      { key: "environment", label: "Environment" },
    ],
    mode: null,
  },
  permissions: {
    groups: [
      { key: "allow", label: "Allow" },
      { key: "ask", label: "Ask" },
      { key: "deny", label: "Deny" },
    ],
    mode: {
      key: "defaultMode",
      label: "Default mode",
      options: ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"],
    },
  },
};

export function ruleSetFor(settingKey: string): RuleSetDef | undefined {
  return Object.hasOwn(RULE_SETS, settingKey) ? RULE_SETS[settingKey] : undefined;
}

export type RuleSetObject = Readonly<Record<string, unknown>>;

export type ParsedRuleSet =
  | { ok: true; object: RuleSetObject }
  | { ok: false; reason: string };

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * A key's native value as an editable rule set. Unset reads as an empty set;
 * anything whose known groups aren't string lists (or whose mode isn't a
 * string) is not a rule set — the caller falls back to the JSON block rather
 * than show a lossy view. Unknown keys are carried along untouched.
 */
export function parseRuleSet(def: RuleSetDef, value: unknown): ParsedRuleSet {
  if (value === undefined) return { ok: true, object: {} };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "The value isn't an object." };
  }
  const object = value as RuleSetObject;
  const badGroup = def.groups.find(
    (group) => object[group.key] !== undefined && !isStringList(object[group.key]),
  );
  if (badGroup) return { ok: false, reason: `${badGroup.key} isn't a list of strings.` };
  if (def.mode && object[def.mode.key] !== undefined && typeof object[def.mode.key] !== "string") {
    return { ok: false, reason: `${def.mode.key} isn't a string.` };
  }
  return { ok: true, object };
}

/**
 * The same, from a Settings row's display text: JSON (encodeSettingValue's
 * output), or null when the key is unset at every level. Broken JSON is not
 * a rule set rather than an exception.
 */
export function parseRuleSetText(def: RuleSetDef, text: string | null): ParsedRuleSet {
  if (text === null) return parseRuleSet(def, undefined);
  try {
    return parseRuleSet(def, JSON.parse(text));
  } catch (error) {
    return { ok: false, reason: `Invalid JSON: ${(error as Error).message}` };
  }
}

/** A parsed set's rules in one group; an absent group has none. */
export function rulesOf(object: RuleSetObject, groupKey: string): readonly string[] {
  const rules = object[groupKey];
  return isStringList(rules) ? rules : [];
}

/** A group's lines, or undefined when the key is absent or isn't a list of strings. */
export function groupLines(object: RuleSetObject, groupKey: string): readonly string[] | undefined {
  const rules = object[groupKey];
  return isStringList(rules) ? rules : undefined;
}

/** A parsed set's mode; absent (or, unparsed, not a string) reads as unset. */
export function modeOf(object: RuleSetObject, modeKey: string): string | undefined {
  const mode = object[modeKey];
  return typeof mode === "string" ? mode : undefined;
}

/** The set with one key replaced in place (or appended when new). */
const withKey = (object: RuleSetObject, key: string, value: unknown): RuleSetObject => ({
  ...object,
  [key]: value,
});

export const withRules = (
  object: RuleSetObject,
  groupKey: string,
  rules: readonly string[],
): RuleSetObject => withKey(object, groupKey, [...rules]);

export const withMode = (object: RuleSetObject, modeKey: string, mode: string): RuleSetObject =>
  withKey(object, modeKey, mode);

/** The set without a group — for autoMode, the group reverts to Claude Code's built-ins. */
export function withoutGroup(object: RuleSetObject, groupKey: string): RuleSetObject {
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== groupKey));
}

/** The mode's options, plus the current value when the catalog doesn't know it. */
export function modeChoices(mode: RuleModeDef, current: string | undefined): readonly string[] {
  return current === undefined || mode.options.includes(current)
    ? mode.options
    : [...mode.options, current];
}

export type InlineSpan = { kind: "text" | "strong" | "code"; text: string };

/** Splits `code` and **bold** out of a line; unmatched markers stay as text. */
export function parseInline(text: string): InlineSpan[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((part) => part !== "")
    .map((part): InlineSpan =>
      part.startsWith("`") && part.length > 2 && part.endsWith("`")
        ? { kind: "code", text: part.slice(1, -1) }
        : part.startsWith("**") && part.length > 4 && part.endsWith("**")
          ? { kind: "strong", text: part.slice(2, -2) }
          : { kind: "text", text: part },
    );
}

export interface PermissionRule {
  tool: string;
  /** What goes between the parentheses; null — the rule covers every call. */
  pattern: string | null;
}

const TOOL_CALL = /^([^()]+)\((.*)\)$/s;

/** `Bash(npm test:*)` → Bash and its pattern; anything else is a bare tool, so no text is lost. */
export function parsePermissionRule(text: string): PermissionRule {
  const match = TOOL_CALL.exec(text);
  return match ? { tool: match[1], pattern: match[2] } : { tool: text, pattern: null };
}

/** The rule text back; a null pattern is the bare tool. */
export const formatPermissionRule = (tool: string, pattern: string | null): string =>
  pattern === null ? tool : `${tool}(${pattern})`;

export interface PermissionTool {
  /** The tool name, or "mcp" for any `mcp__<server>__<tool>` name. */
  tool: string;
  label: string;
  /** A sample pattern, shown as the field's placeholder. */
  example: string;
  hint: string;
}

export const PERMISSION_TOOLS: readonly PermissionTool[] = [
  { tool: "Bash", label: "Bash", example: "npm run test:*", hint: "Command prefix; :* matches anything after" },
  { tool: "Read", label: "Read", example: "./secrets/**", hint: "Path or glob" },
  { tool: "Edit", label: "Edit", example: "./src/**", hint: "Path or glob" },
  { tool: "Write", label: "Write", example: "./docs/**", hint: "Path or glob" },
  { tool: "WebFetch", label: "WebFetch", example: "domain:github.com", hint: "domain:<host>" },
  { tool: "WebSearch", label: "WebSearch", example: "", hint: "Takes no pattern" },
  { tool: "Skill", label: "Skill", example: "deploy", hint: "Skill name" },
  { tool: "Agent", label: "Agent", example: "Explore", hint: "Agent type" },
  { tool: "mcp", label: "MCP tool", example: "mcp__github__*", hint: "Tool name; * covers a whole server" },
];
