// Layer 1 — the fixed catalog of settings.json keys shown in the generic
// "Settings" section, plus total encode/decode between a key's native JSON
// value and the display text a text field, dropdown or JSON block edits.
// No I/O: server.ts reads the files, config-view.ts resolves levels; this
// module only knows what a key looks like and how to read/write its text.
//
// Scope: only keys not already owned by a dedicated section (Hooks, Plugins,
// Connectors, Skills, Agents, env.ENABLE_TOOL_SEARCH) — see
// docs/decisions/claude-config-generic-settings-section.md for the list
// and why it's a curated subset of Claude Code's ~150 documented keys, not
// all of them.

import { autoModeSummary } from "./auto-mode";

export type SettingKind = "boolean" | "number" | "string" | "enum" | "json";

export interface EnumOption {
  value: string;
  label: string;
}

export type SettingGroup = "look" | "safety" | "session" | "git";

export const SETTING_GROUPS: readonly { key: SettingGroup; label: string }[] = [
  { key: "look", label: "Model and look" },
  { key: "safety", label: "Permissions and safety" },
  { key: "session", label: "Session" },
  { key: "git", label: "Git and terminal" },
];

/** One field of an object-valued key edited as a form (statusLine, attribution). */
export interface FormField {
  key: string;
  label: string;
  description: string;
  kind: "text" | "multiline" | "number";
  placeholder: string;
  /** Blank text is kept as "" (it means something) rather than dropping the field. */
  blankKeeps: boolean;
}

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  description: string;
  group: SettingGroup;
  /** Present only for kind "enum". */
  enumOptions?: readonly EnumOption[];
  /** kind "enum": any non-blank text is a valid value too. */
  allowCustom?: boolean;
  /** Opens in the document column rather than editing in the list. */
  detail?: boolean;
  /** kind "json" edited as a form: its fields, plus keys every value carries. */
  fields?: readonly FormField[];
  fixed?: Readonly<Record<string, unknown>>;
}

const formField = (
  key: string,
  label: string,
  description: string,
  kind: FormField["kind"],
  placeholder: string,
  blankKeeps = false,
): FormField => ({ key, label, description, kind, placeholder, blankKeeps });

export const GENERIC_SETTINGS: readonly SettingDef[] = [
  {
    key: "model",
    label: "Model",
    kind: "enum",
    group: "look",
    allowCustom: true,
    description: "The model Claude Code starts with.",
    enumOptions: [
      { value: "opus", label: "Opus" },
      { value: "sonnet", label: "Sonnet" },
      { value: "haiku", label: "Haiku" },
      { value: "fable", label: "Fable" },
      { value: "opusplan", label: "Opus in plan mode, Sonnet otherwise" },
    ],
  },
  {
    key: "outputStyle",
    label: "Output style",
    kind: "enum",
    group: "look",
    allowCustom: true,
    description: "Claude's role, tone, and output format.",
    enumOptions: [
      { value: "Explanatory", label: "Explanatory" },
      { value: "Learning", label: "Learning" },
    ],
  },
  {
    key: "theme",
    label: "Theme",
    kind: "enum",
    group: "look",
    allowCustom: true,
    description: "Color theme of the terminal interface.",
    enumOptions: [
      { value: "auto", label: "Match system" },
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
      { value: "dark-daltonized", label: "Dark (colorblind)" },
      { value: "light-daltonized", label: "Light (colorblind)" },
      { value: "dark-ansi", label: "Dark (ANSI colors)" },
      { value: "light-ansi", label: "Light (ANSI colors)" },
    ],
  },
  {
    key: "alwaysThinkingEnabled",
    label: "Always thinking",
    kind: "boolean",
    group: "look",
    description: "Turn extended thinking on for every session.",
  },
  {
    key: "spinnerTipsEnabled",
    label: "Spinner tips",
    kind: "boolean",
    group: "look",
    description: "Show tips in the spinner while Claude works.",
  },
  {
    key: "permissions",
    label: "Permissions",
    kind: "json",
    group: "safety",
    detail: true,
    description: "Which tool calls run without asking, which ask, which are denied.",
  },
  {
    key: "autoMode",
    label: "Auto mode",
    kind: "json",
    group: "safety",
    detail: true,
    description: "What the auto mode classifier treats as yours and what it blocks.",
  },
  {
    key: "forceLoginMethod",
    label: "Force login method",
    kind: "enum",
    group: "safety",
    allowCustom: true,
    description: "Restrict login to one kind of account.",
    enumOptions: [
      { value: "claudeai", label: "Claude.ai account" },
      { value: "console", label: "Claude Console (API)" },
    ],
  },
  {
    key: "autoCompactEnabled",
    label: "Auto-compact",
    kind: "boolean",
    group: "session",
    description: "Automatically compact the conversation as context fills up.",
  },
  {
    key: "cleanupPeriodDays",
    label: "Cleanup period (days)",
    kind: "number",
    group: "session",
    description: "How many days Claude Code keeps transcripts before deleting them.",
  },
  {
    key: "respectGitignore",
    label: "Respect .gitignore",
    kind: "boolean",
    group: "session",
    description: "Keep gitignored files out of the @ file picker.",
  },
  {
    key: "inputNeededNotifEnabled",
    label: "Notify when input is needed",
    kind: "boolean",
    group: "session",
    description: "Send a push notification when Claude is waiting on you.",
  },
  {
    key: "agentPushNotifEnabled",
    label: "Agent push notifications",
    kind: "boolean",
    group: "session",
    description: "Let Claude send a push notification to your phone when it decides to.",
  },
  {
    key: "includeGitInstructions",
    label: "Git instructions",
    kind: "boolean",
    group: "git",
    description: "Include the built-in commit and PR instructions in the system prompt.",
  },
  {
    key: "attribution",
    label: "Attribution",
    kind: "json",
    group: "git",
    detail: true,
    description: "Text Claude Code adds to commits and pull requests.",
    fields: [
      formField("commit", "Commits", "Trailer added to commit messages. Empty — no trailer.", "multiline", "Co-Authored-By: Claude <noreply@anthropic.com>", true),
      formField("pr", "Pull requests", "Line added to pull request descriptions. Empty — no line.", "multiline", "Generated with Claude Code", true),
    ],
  },
  {
    key: "statusLine",
    label: "Status line",
    kind: "json",
    group: "git",
    detail: true,
    description: "Command that draws a line under the prompt.",
    fixed: { type: "command" },
    fields: [
      formField("command", "Command", "Receives the session as JSON on stdin.", "text", "~/.claude/statusline.sh"),
      formField("padding", "Padding", "Empty columns before the line.", "number", "0"),
    ],
  },
];

export function findSettingDef(key: string): SettingDef | undefined {
  return GENERIC_SETTINGS.find((def) => def.key === key);
}

/** An enum's own option, or — for a key that allows one — any other text. */
const isEnumValue = (def: SettingDef, value: string): boolean =>
  def.allowCustom === true || (def.enumOptions ?? []).some((option) => option.value === value);

/** The sentinel meaning "not set at this level" — never a valid encoded value. */
export const UNSET = "inherit";

/**
 * Renders a key's native JSON value as display text for its kind. Total: a
 * value of the wrong shape for the kind (hand-edited garbage, or genuinely
 * absent — callers pass `undefined` for that) renders as `UNSET`, the same
 * lenient "garbage in the file reads back as unset" convention the other
 * sections use (see getSkill/getPlugin in settings-doc.ts).
 */
export function encodeSettingValue(def: SettingDef, value: unknown): string {
  switch (def.kind) {
    case "boolean":
      return value === true ? "true" : value === false ? "false" : UNSET;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : UNSET;
    case "string":
      return typeof value === "string" ? value : UNSET;
    case "enum":
      return typeof value === "string" && value !== UNSET && isEnumValue(def, value)
        ? value
        : UNSET;
    case "json":
      return value === undefined ? UNSET : JSON.stringify(value, null, 2);
  }
}

export type DecodeResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * Parses display text back into a key's native JSON value, per its kind.
 * Never throws — malformed input (a typo, broken JSON) is a `DecodeResult`
 * the caller shows next to the field, not an exception.
 */
export function decodeSettingText(def: SettingDef, text: string): DecodeResult {
  switch (def.kind) {
    case "boolean":
      if (text === "true") return { ok: true, value: true };
      if (text === "false") return { ok: true, value: false };
      return { ok: false, message: "Expected true or false." };
    case "number": {
      if (text.trim() === "") return { ok: false, message: "Expected a number." };
      const value = Number(text);
      return Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, message: "Expected a number." };
    }
    case "string":
      return { ok: true, value: text };
    case "enum":
      return text.trim() !== "" && isEnumValue(def, text)
        ? { ok: true, value: text }
        : { ok: false, message: "Not one of the allowed values." };
    case "json":
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch (error) {
        return { ok: false, message: `Invalid JSON: ${(error as Error).message}` };
      }
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

/** A JSON object from a key's display text; unset or anything else is null. */
export const objectOf = (text: string | null): JsonObject | null => {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null;
  }
};

/**
 * A form key's fields as display text; a field that is absent (or the whole
 * value unset or not an object) is undefined — apart from an empty string,
 * which for attribution means "no trailer".
 */
export function formValues(def: SettingDef, text: string | null): Record<string, string | undefined> {
  const object = objectOf(text) ?? {};
  return Object.fromEntries(
    (def.fields ?? []).map((entry) => {
      const value = object[entry.key];
      return [entry.key, typeof value === "string" || typeof value === "number" ? String(value) : undefined];
    }),
  );
}

const fieldValue = (entry: FormField, text: string | null): unknown => {
  if (text === null) return undefined;
  if (entry.kind !== "number") return text === "" && !entry.blankKeeps ? undefined : text;
  const number = Number(text);
  return text.trim() === "" || !Number.isFinite(number) ? undefined : number;
};

/**
 * The key's JSON text with one field rewritten, keeping keys the form
 * doesn't know; null when nothing but the fixed keys would remain.
 */
export function withFormValue(
  def: SettingDef,
  text: string | null,
  fieldKey: string,
  /** null — drop the field, back to Claude Code's default for it. */
  fieldText: string | null,
): string | null {
  const entry = (def.fields ?? []).find((candidate) => candidate.key === fieldKey);
  const base: JsonObject = { ...(def.fixed ?? {}), ...(objectOf(text) ?? {}) };
  if (!entry) return JSON.stringify(base, null, 2);
  const { [fieldKey]: _old, ...rest } = base;
  const value = fieldValue(entry, fieldText);
  const next = value === undefined ? rest : { ...rest, [fieldKey]: value };
  const meaningful = Object.keys(next).some((key) => !Object.hasOwn(def.fixed ?? {}, key));
  return meaningful ? JSON.stringify(next, null, 2) : null;
}

const countOf = (object: JsonObject, group: string): number => {
  const rules = object[group];
  return Array.isArray(rules) ? rules.length : 0;
};

/** A detail key's value in one line for its row in the Settings list. */
export function settingSummary(key: string, text: string | null): string {
  const object = objectOf(text) ?? (text === null ? {} : null);
  if (object === null) return "Can't read as a form — JSON";
  switch (key) {
    case "autoMode":
      return autoModeSummary(object);
    case "permissions": {
      const mode = typeof object.defaultMode === "string" ? object.defaultMode : "default";
      return [mode, ...["allow", "ask", "deny"].map((group) => `${countOf(object, group)} ${group}`)].join(" · ");
    }
    case "statusLine":
      return typeof object.command === "string" && object.command !== "" ? object.command : "Not set";
    case "attribution":
      return text === null ? "Claude Code default" : "Custom";
    default:
      return text === null ? "Not set" : "Set";
  }
}
