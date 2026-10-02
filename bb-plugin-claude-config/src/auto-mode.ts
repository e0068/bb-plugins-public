// Layer 1 — the autoMode key as a form. Two things live here: the 21-field
// environment template Claude Code ships (`claude auto-mode defaults`), read
// into own values plus lines the form doesn't know and written back; and the
// built-in rule lists, read into "which built-ins are off" plus own rules and
// written back. No I/O and no React: the snapshot comes in as data
// (auto-mode-defaults.json), the editor in components/settings calls these.
//
// Two facts about Claude Code shape the writers (checked on 2.1.285): a set
// `environment` replaces the template wholesale, so the writer spells out
// all 21 lines; and a rule group has no per-rule switch — `$defaults` splices
// the whole built-in list — so turning one built-in off spells out the rest.

import snapshot from "./auto-mode-defaults.json";
import { BUILT_IN_DEFAULTS, groupLines, type RuleSetObject } from "./rule-set";

/** `claude auto-mode defaults` as of the version it records (`npm run defaults:update`). */
export const AUTO_MODE_DEFAULTS = snapshot;

export type EnvGroup = "project" | "infrastructure" | "protection";
export type EnvKind = "text" | "list" | "visibility";

export interface EnvField {
  /** The key as Claude Code's template writes it: `**<key>**: value`. */
  key: string;
  group: EnvGroup;
  kind: EnvKind;
  description: string;
  /** A sample item, for list fields. */
  example: string;
  /** Describes one repository — out of place in the global area. */
  projectOnly: boolean;
}

export const ENV_GROUPS: readonly { key: EnvGroup; label: string }[] = [
  { key: "project", label: "This project" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "protection", label: "Protection" },
];

const field = (
  group: EnvGroup,
  kind: EnvKind,
  key: string,
  description: string,
  example = "",
  projectOnly = false,
): EnvField => ({ key, group, kind, description, example, projectOnly });

export const ENV_FIELDS: readonly EnvField[] = [
  field("project", "text", "Primary use of Claude Code", "What Claude Code is used for."),
  field("project", "text", "Trusted repo", "Which repository counts as yours.", "", true),
  field("project", "visibility", "Repository visibility", "Scopes what may be committed or pushed.", "", true),
  field("project", "list", "Source control", "Remotes and orgs that count as yours.", "github.com:org/repo.git", true),
  field("project", "list", "Org-specific CLIs", "Internal command-line tools the agent may run.", "tools/deploy.sh", true),
  field("project", "list", "CI/CD deploy targets", "Where deploys go.", "Firebase hosting", true),
  field("project", "list", "Key internal services", "Services the agent talks to.", "127.0.0.1:8099", true),
  field("infrastructure", "text", "Organization", "Your company or team."),
  field("infrastructure", "list", "Cloud provider(s)", "Clouds you deploy to.", "Google Firebase"),
  field("infrastructure", "list", "Trusted internal domains", "Domains inside the trust boundary.", "corp.example.com"),
  field("infrastructure", "list", "Trusted cloud buckets", "Buckets inside the trust boundary.", "gs://team-artifacts"),
  field("infrastructure", "list", "Internal package registry", "Where packages come from.", "npm.corp.example.com"),
  field("infrastructure", "list", "Internal sharing / snippet hosting", "Where snippets may be shared.", "gist.corp.example.com"),
  field("infrastructure", "text", "Secrets management", "Where secrets live."),
  field("infrastructure", "text", "Network posture", "VPN, proxies, egress rules."),
  field("infrastructure", "text", "Host containment", "Container, VM, or an open machine."),
  field("protection", "text", "Sensitive remote targets", "Hosts and namespaces treated as production."),
  field("protection", "list", "Protected deployment namespaces / environments", "Environments that are never touched.", "prod-eu"),
  field("protection", "text", "Protected IaC scopes", "Infrastructure the agent must not change."),
  field("protection", "text", "Sensitive data locations & audiences", "Where sensitive data sits and who may see it."),
  field("protection", "text", "Data retention / declassification", "Rules for keeping and releasing data."),
];

/** Default text per field, from the snapshot's environment lines. */
export type EnvTemplate = Readonly<Record<string, string>>;

/** Own values (only those that differ from the template) plus unknown lines. */
export interface EnvState {
  values: Readonly<Record<string, string>>;
  extra: readonly string[];
}

const PAIR = /^\*\*([^*]+)\*\*:\s*(.*)$/s;
const known = new Set(ENV_FIELDS.map((entry) => entry.key));

const pairOf = (text: string): readonly [string, string] | null => {
  const match = PAIR.exec(text);
  return match ? [match[1], match[2].trim()] : null;
};

export function envTemplate(lines: readonly string[]): EnvTemplate {
  return Object.fromEntries(lines.flatMap((text) => {
    const pair = pairOf(text);
    return pair ? [pair] : [];
  }));
}

const EMPTY: EnvState = { values: {}, extra: [] };

/** A group's lines as own values and lines the form doesn't know. */
export function readEnvironment(
  lines: readonly string[] | undefined,
  template: EnvTemplate,
): EnvState {
  // `seen` — keys already read, own or equal to the template: a repeat of
  // one is carried as an unknown line rather than silently dropped.
  const read = (lines ?? []).reduce<EnvState & { seen: ReadonlySet<string> }>(
    (state, text) => {
      if (text === BUILT_IN_DEFAULTS) return state;
      const pair = pairOf(text);
      if (!pair || !known.has(pair[0]) || state.seen.has(pair[0])) {
        return { ...state, extra: [...state.extra, text] };
      }
      const [key, value] = pair;
      const seen = new Set(state.seen).add(key);
      return value === template[key]
        ? { ...state, seen }
        : { ...state, seen, values: { ...state.values, [key]: value } };
    },
    { ...EMPTY, seen: new Set() },
  );
  return { values: read.values, extra: read.extra };
}

/**
 * The group's lines: every template field in template order (own value or
 * default), then the unknown lines. Nothing own and nothing unknown is
 * `undefined` — drop the group and Claude Code applies its template itself.
 */
export function writeEnvironment(
  state: EnvState,
  template: EnvTemplate,
): string[] | undefined {
  if (Object.keys(state.values).length === 0 && state.extra.length === 0) return undefined;
  const fields = Object.keys(template).map(
    (key) => `**${key}**: ${state.values[key] ?? template[key]}`,
  );
  return [...fields, ...state.extra];
}

/** Sets one field; blank text — or the template's own text — clears it. */
export function withEnvValue(
  state: EnvState,
  key: string,
  text: string,
  template: EnvTemplate = {},
): EnvState {
  const value = text.trim();
  const { [key]: _dropped, ...rest } = state.values;
  return value === "" || value === template[key]
    ? { ...state, values: rest }
    : { ...state, values: { ...rest, [key]: value } };
}

export const listItems = (text: string): string[] =>
  text.split(";").map((item) => item.trim()).filter((item) => item !== "");

export const joinItems = (items: readonly string[]): string =>
  items.map((item) => item.trim()).filter((item) => item !== "").join("; ");

export type Visibility =
  | { kind: "default" }
  | { kind: "private" }
  | { kind: "public" }
  | { kind: "custom"; text: string };

export function readVisibility(value: string | undefined): Visibility {
  if (value === undefined) return { kind: "default" };
  const lower = value.toLowerCase();
  if (lower.startsWith("private")) return { kind: "private" };
  if (lower.startsWith("public")) return { kind: "public" };
  return { kind: "custom", text: value };
}

/** Filled fields that describe one repository — a warning in the global area. */
export const filledProjectFields = (state: EnvState): EnvField[] =>
  ENV_FIELDS.filter((entry) => entry.projectOnly && state.values[entry.key] !== undefined);

/** The state without the named fields — "Remove from Globally". */
export const withoutFields = (state: EnvState, keys: readonly string[]): EnvState => ({
  ...state,
  values: Object.fromEntries(Object.entries(state.values).filter(([key]) => !keys.includes(key))),
});

export interface RuleTitle {
  name: string;
  description: string;
}

const TITLE = /^([^:[]+?)(?:\s*\[[^\]]*\])?:\s+(.*)$/s;

/** `Name [note]: description` → name and description; a rule without one is all name. */
export function ruleTitle(text: string): RuleTitle {
  const match = TITLE.exec(text);
  return match
    ? { name: match[1].trim(), description: match[2].trim() }
    : { name: text, description: "" };
}

/** Which built-ins (by index) are off, and the own rules in their order. */
export interface RuleState {
  off: ReadonlySet<number>;
  own: readonly string[];
}

export function readRules(
  lines: readonly string[] | undefined,
  builtins: readonly string[],
): RuleState {
  if (lines === undefined) return { off: new Set(), own: [] };
  const withDefaults = lines.includes(BUILT_IN_DEFAULTS);
  const listed = new Set(lines);
  return {
    off: withDefaults
      ? new Set()
      : new Set(builtins.flatMap((rule, index) => (listed.has(rule) ? [] : [index]))),
    own: lines.filter((rule) => rule !== BUILT_IN_DEFAULTS && !builtins.includes(rule)),
  };
}

/**
 * The group's lines: nothing off and nothing own is `undefined` (drop the
 * group); nothing off is `$defaults` plus own; otherwise the built-ins still
 * on, verbatim, plus own.
 */
export function writeRules(state: RuleState, builtins: readonly string[]): string[] | undefined {
  if (state.off.size === 0) {
    return state.own.length === 0 ? undefined : [BUILT_IN_DEFAULTS, ...state.own];
  }
  return [...builtins.filter((_, index) => !state.off.has(index)), ...state.own];
}

export function toggleBuiltin(state: RuleState, index: number): RuleState {
  const off = new Set(state.off);
  if (!off.delete(index)) off.add(index);
  return { ...state, off };
}

/** The environment template, from the snapshot. */
export const ENV_TEMPLATE: EnvTemplate = envTemplate(snapshot.environment);

const RULE_GROUPS = ["allow", "soft_deny", "hard_deny"] as const;

/** autoMode in one line for its row in the Settings list. */
export function autoModeSummary(object: RuleSetObject): string {
  const own = Object.keys(readEnvironment(groupLines(object, "environment"), ENV_TEMPLATE).values).length;
  const states = RULE_GROUPS.map((group) => readRules(groupLines(object, group), snapshot[group]));
  const off = states.reduce((sum, state) => sum + state.off.size, 0);
  const mine = states.reduce((sum, state) => sum + state.own.length, 0);
  const total = RULE_GROUPS.reduce((sum, group) => sum + snapshot[group].length, 0);
  return [
    own === 0 ? "Environment: defaults" : `${own} own environment fields`,
    `${total} built-in rules${off > 0 ? `, ${off} off` : ""}`,
    ...(mine > 0 ? [`${mine} own`] : []),
  ].join(" · ");
}
