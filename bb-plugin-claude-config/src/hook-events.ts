// Layer 1 — Claude Code's hook events, for the "new hook" dialog. Copied
// from https://code.claude.com/docs/en/hooks as of 2026-09-05.
//
// The matcher isn't free-form for every event — `Stop` takes none at all — so
// the table carries that too, and the dialog hides the field where a value
// would be one Claude Code ignores.

export interface HookEventSpec {
  event: string;
  /** The event groups its hooks by a matcher. */
  matcher: boolean;
  /** What the matcher matches — shown under the field; null when there is none. */
  matcherHint: string | null;
}

export const HOOK_EVENTS: readonly HookEventSpec[] = [
  { event: "PreToolUse", matcher: true, matcherHint: "tool name, e.g. Bash or Edit" },
  { event: "PostToolUse", matcher: true, matcherHint: "tool name, e.g. Bash or Edit" },
  { event: "PostToolUseFailure", matcher: true, matcherHint: "tool name" },
  { event: "PostToolBatch", matcher: false, matcherHint: null },
  { event: "PermissionRequest", matcher: true, matcherHint: "tool name" },
  { event: "PermissionDenied", matcher: true, matcherHint: "tool name" },
  { event: "UserPromptSubmit", matcher: false, matcherHint: null },
  { event: "UserPromptExpansion", matcher: true, matcherHint: "command name" },
  { event: "SessionStart", matcher: true, matcherHint: "startup, resume, clear, compact, fork" },
  { event: "SessionEnd", matcher: true, matcherHint: "clear, resume, logout, prompt_input_exit, other" },
  { event: "Setup", matcher: true, matcherHint: "init, maintenance" },
  { event: "Stop", matcher: false, matcherHint: null },
  { event: "StopFailure", matcher: true, matcherHint: "error type" },
  { event: "SubagentStart", matcher: true, matcherHint: "agent type" },
  { event: "SubagentStop", matcher: true, matcherHint: "agent type" },
  { event: "TaskCreated", matcher: false, matcherHint: null },
  { event: "TaskCompleted", matcher: false, matcherHint: null },
  { event: "TeammateIdle", matcher: false, matcherHint: null },
  { event: "InstructionsLoaded", matcher: true, matcherHint: "load reason" },
  { event: "ConfigChange", matcher: true, matcherHint: "configuration source" },
  { event: "CwdChanged", matcher: false, matcherHint: null },
  { event: "DirectoryAdded", matcher: true, matcherHint: "slash_command, register_repo_root" },
  { event: "FileChanged", matcher: true, matcherHint: "file name to watch" },
  { event: "WorktreeCreate", matcher: false, matcherHint: null },
  { event: "WorktreeRemove", matcher: false, matcherHint: null },
  { event: "PreCompact", matcher: true, matcherHint: "manual, auto" },
  { event: "PostCompact", matcher: true, matcherHint: "manual, auto" },
  { event: "PreModelSwitch", matcher: true, matcherHint: "model name" },
  { event: "PostModelSwitch", matcher: true, matcherHint: "model name" },
  { event: "Notification", matcher: true, matcherHint: "notification type" },
  { event: "MessageDisplay", matcher: false, matcherHint: null },
  { event: "Elicitation", matcher: true, matcherHint: "MCP server name" },
  { event: "ElicitationResult", matcher: true, matcherHint: "MCP server name" },
];

const BY_EVENT = new Map(HOOK_EVENTS.map((spec) => [spec.event, spec]));

/**
 * Whether the event groups by matcher. An event that isn't in the table —
 * one added to Claude Code after this copy was taken — keeps the field: a
 * stale catalog shouldn't be able to strip a matcher the hook needs.
 */
export function supportsMatcher(event: string): boolean {
  return BY_EVENT.get(event)?.matcher ?? true;
}

/** Hint for the matcher field, or null when there's nothing to say. */
export function matcherHint(event: string): string | null {
  return BY_EVENT.get(event)?.matcherHint ?? null;
}
