// Layer 1 — the fixed catalog of settings.json keys shown in the generic
// "Settings" section, plus total encode/decode between a key's native JSON
// value and the display text a text field, dropdown or JSON block edits.
// No I/O: server.ts reads the files, config-view.ts resolves levels; this
// module only knows what a key looks like and how to read/write its text.
//
// Scope: only keys not already owned by a dedicated section (Hooks, Plugins,
// Connectors, Skills, Agents, env.ENABLE_TOOL_SEARCH) — see
// memory/decisions/claude-config-generic-settings-section.md for the list
// and why it's a curated subset of Claude Code's ~150 documented keys, not
// all of them.

export type SettingKind = "boolean" | "number" | "string" | "enum" | "json";

export interface EnumOption {
  value: string;
  label: string;
}

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  description: string;
  /** Present only for kind "enum". */
  enumOptions?: readonly EnumOption[];
}

export const GENERIC_SETTINGS: readonly SettingDef[] = [
  {
    key: "model",
    label: "Model",
    kind: "string",
    description: "The model Claude Code starts with.",
  },
  {
    key: "outputStyle",
    label: "Output style",
    kind: "string",
    description: "Claude's role, tone, and output format.",
  },
  {
    key: "forceLoginMethod",
    label: "Force login method",
    kind: "string",
    description: "Restrict login to claude.ai, Claude Console, or a cloud gateway.",
  },
  {
    key: "theme",
    label: "Theme",
    kind: "string",
    description:
      'Color theme for the interface: "auto", "dark", "light", "dark-daltonized", ' +
      '"light-daltonized", "dark-ansi", "light-ansi", or "custom:<slug>".',
  },
  {
    key: "cleanupPeriodDays",
    label: "Cleanup period (days)",
    kind: "number",
    description: "How many days Claude Code keeps transcripts before deleting them.",
  },
  {
    key: "alwaysThinkingEnabled",
    label: "Always thinking",
    kind: "boolean",
    description: "Turn extended thinking on for every session.",
  },
  {
    key: "spinnerTipsEnabled",
    label: "Spinner tips",
    kind: "boolean",
    description: "Show tips in the spinner while Claude works.",
  },
  {
    key: "autoCompactEnabled",
    label: "Auto-compact",
    kind: "boolean",
    description: "Automatically compact the conversation as context fills up.",
  },
  {
    key: "respectGitignore",
    label: "Respect .gitignore",
    kind: "boolean",
    description: "Keep gitignored files out of the @ file picker.",
  },
  {
    key: "includeGitInstructions",
    label: "Git instructions",
    kind: "boolean",
    description: "Include the built-in commit and PR instructions in the system prompt.",
  },
  {
    key: "inputNeededNotifEnabled",
    label: "Notify when input is needed",
    kind: "boolean",
    description: "Send a push notification when Claude is waiting on you.",
  },
  {
    key: "agentPushNotifEnabled",
    label: "Agent push notifications",
    kind: "boolean",
    description: "Let Claude send a push notification to your phone when it decides to.",
  },
  {
    key: "permissions",
    label: "Permissions",
    kind: "json",
    description: "Allow, ask, and deny rules and the starting permission mode.",
  },
  {
    key: "statusLine",
    label: "Status line",
    kind: "json",
    description: "Command that renders a status line below the prompt.",
  },
  {
    key: "attribution",
    label: "Attribution",
    kind: "json",
    description: "Attribution Claude Code adds to commits and pull requests.",
  },
  {
    key: "autoMode",
    label: "Auto mode rules",
    kind: "json",
    description:
      "Your own allow, soft_deny, hard_deny, and environment rules for the auto mode classifier.",
  },
];

export function findSettingDef(key: string): SettingDef | undefined {
  return GENERIC_SETTINGS.find((def) => def.key === key);
}

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
      return typeof value === "string" &&
        (def.enumOptions ?? []).some((option) => option.value === value)
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
      return (def.enumOptions ?? []).some((option) => option.value === text)
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
