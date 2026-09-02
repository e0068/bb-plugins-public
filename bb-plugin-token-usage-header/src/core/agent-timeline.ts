// Types + parser + formatter mirroring the JSON contract emitted by
// tools/agent_timeline.py --json. No I/O here — the caller
// (src/service/agent-timeline-service.ts) runs the process; this module only
// ever sees a string (stdout) and pure data.
import { z } from "zod";
import { formatCost } from "./format";
import type { GitEvent } from "./git-events";

/**
 * Version of the --json report format understood by this bundle. Must match
 * SCHEMA_VERSION in tools/agent_timeline.py — the counter script is read
 * from disk on every call, while this file lives in the built bundle and
 * only gets updated on rebuild. Same approach as EXPECTED_SCHEMA_VERSION in
 * src/core/types.ts — see memory/decisions/token-usage-json-schema-version.md.
 *
 * 1 -> 2: assistant messages carry optional tokens/cost — see
 * memory/decisions/token-usage-cost-on-messages.md.
 *
 * 2 -> 3: agent carries requestFull/requestFullTruncated/responseFull/
 * responseFullTruncated — the untruncated (within FULL_TEXT_MAX in
 * tools/agent_timeline.py) full text of the agent's request and response, on
 * top of the short preview fragments in events[].text.
 *
 * 3 -> 4: every message event carries fullText/fullTextTruncated — the full
 * text of THAT SPECIFIC message, so expanding any timeline row shows it in
 * full, not just the agent's first request / last response
 * (agent.requestFull/responseFull).
 *
 * 4 -> 5: the report gained a top-level prNumbers field — every PR
 * referenced anywhere in the session's transcript (main + subagents), as
 * {number, repository} pairs. src/service/agent-timeline-service.ts uses it
 * to look up each PR's live merge status (`gh pr view`) and turn a merged
 * one into a "merge" GitEvent for the session chart — see
 * src/core/git-events.ts.
 */
export const EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION = 5;

const toolEventSchema = z
  .object({
    ts: z.string(),
    kind: z.literal("tool"),
    /** Tool name from the tool_use block: Read/Glob/Grep/Skill/Bash/Task/Edit/Write/… */
    name: z.string(),
    /** One meaningful call argument (file_path/pattern/command/…), or null. */
    target: z.string().nullable(),
  })
  .strict();

const hookEventSchema = z
  .object({
    ts: z.string(),
    kind: z.literal("hook"),
    hookName: z.string().nullable(),
    hookEvent: z.string().nullable(),
  })
  .strict();

const messageEventSchema = z
  .object({
    ts: z.string(),
    kind: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    /** A short text excerpt — already truncated by the script, not the full message. */
    text: z.string(),
    /**
     * Full text of this message (within FULL_TEXT_MAX characters in
     * tools/agent_timeline.py), not just the preview in `text` — for an
     * expanded timeline row.
     */
    fullText: z.string(),
    fullTextTruncated: z.boolean(),
    /**
     * Cost of the model call that produced this message — priced on the
     * whole assistant record (owner's decision: not on individual tool_use
     * entries within it). Present only on role:"assistant" records that have
     * usage in the transcript; absent, not null, for user messages and
     * records without usage (see tools/agent_timeline.py::message_event).
     */
    tokens: z.number().finite().optional(),
    cost: z.number().finite().optional(),
  })
  .strict();

export const agentTimelineEventSchema = z.discriminatedUnion("kind", [
  toolEventSchema,
  hookEventSchema,
  messageEventSchema,
]);

export type AgentTimelineToolEvent = z.infer<typeof toolEventSchema>;
export type AgentTimelineHookEvent = z.infer<typeof hookEventSchema>;
export type AgentTimelineMessageEvent = z.infer<typeof messageEventSchema>;
export type AgentTimelineEvent = z.infer<typeof agentTimelineEventSchema>;

const agentTimelineAgentInfoSchema = z
  .object({
    /** "main" for the main agent, "agent-<hash>" for a subagent. */
    key: z.string(),
    agentType: z.string().nullable(),
    description: z.string().nullable(),
    model: z.string().nullable(),
    spawnDepth: z.number().nullable(),
    /** Excerpt of the prompt the subagent was launched with; null for the main agent. */
    promptExcerpt: z.string().nullable(),
    /**
     * Full (within FULL_TEXT_MAX characters) text of this agent's first real
     * user message — the input it was launched with, in full, not the
     * 300-character promptExcerpt. Read from the agent's OWN transcript, so
     * it works even where promptExcerpt can't (workflow-run subagents have
     * no toolUseId to find the record in the main transcript). null if there
     * is no such record.
     */
    requestFull: z.string().nullable(),
    requestFullTruncated: z.boolean(),
    /**
     * Full text of the last assistant message — the agent's final response
     * in full. The last record wins, including an empty one: a transcript
     * that breaks off on a bare tool_use yields null, not a stale response.
     */
    responseFull: z.string().nullable(),
    responseFullTruncated: z.boolean(),
  })
  .strict();

export type AgentTimelineAgentInfo = z.infer<typeof agentTimelineAgentInfoSchema>;

const agentTimelinePrNumberSchema = z
  .object({
    number: z.number().int(),
    repository: z.string(),
  })
  .strict();

export type AgentTimelinePrNumber = z.infer<typeof agentTimelinePrNumberSchema>;

const agentTimelineSchema = z
  .object({
    schemaVersion: z.number(),
    agent: agentTimelineAgentInfoSchema,
    events: z.array(agentTimelineEventSchema),
    /** Every PR referenced anywhere in the session (main + subagents), deduped by number — see tools/agent_timeline.py's own doc. */
    prNumbers: z.array(agentTimelinePrNumberSchema),
  })
  .strict();

/**
 * The script's own fields plus mergeEvents — added by the service layer
 * (src/service/agent-timeline-service.ts), never by the script itself: a
 * PR's merge state is GitHub-side truth, resolved with a live `gh pr view`
 * per prNumbers entry. parseAgentTimeline below fills it with `[]` right
 * after validating the raw script output, the same two-step shape
 * threads-timeline.ts uses for its own service-added fields
 * (bbProjectId/…). Only ever non-empty here — this type is exclusively
 * consumed by the session page (AgentTimelinePage); the feed and header
 * popup never call the `agentTimeline` RPC at all, by design (see
 * memory/decisions/merge-marker-session-page-only.md) — not just an unused field.
 */
export type AgentTimeline = z.infer<typeof agentTimelineSchema> & { mergeEvents: GitEvent[] };

export type AgentTimelineParseFailureReason =
  | "invalid_json"
  | "invalid_shape"
  | "script_error"
  | "schema_version_mismatch";

export interface AgentTimelineParseSuccess {
  ok: true;
  data: AgentTimeline;
}

export interface AgentTimelineParseFailure {
  ok: false;
  reason: AgentTimelineParseFailureReason;
  message: string;
}

export type AgentTimelineParseResult = AgentTimelineParseSuccess | AgentTimelineParseFailure;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(reason: AgentTimelineParseFailureReason, message: string): AgentTimelineParseFailure {
  return { ok: false, reason, message };
}

/**
 * Parses the stdout of `tools/agent_timeline.py --json`. Never throws —
 * malformed input from an external process is an expected case, not a bug.
 */
export function parseAgentTimeline(raw: string): AgentTimelineParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail("invalid_json", "empty output");
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    return fail("invalid_json", `not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!isRecord(json)) {
    return fail("invalid_shape", "expected a JSON object at the top level");
  }

  // agent_timeline.py's own top-level exception handler prints
  // {"error": "..."} and nothing else — distinguish that from a malformed
  // real report (mirrors isScriptError in src/core/parse.ts).
  if (typeof json.error === "string" && !("events" in json)) {
    return fail("script_error", json.error);
  }

  // Checked before events/agent and anything else, the same way
  // parseTokensOutput does it in src/core/parse.ts.
  if (json.schemaVersion !== EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION) {
    const got =
      json.schemaVersion === undefined
        ? "the schema version field is missing"
        : `got version ${JSON.stringify(json.schemaVersion)}`;
    const remedy =
      typeof json.schemaVersion === "number" && json.schemaVersion > EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION
        ? "Rebuild the plugin."
        : "Rebuilding the plugin won't help: update the plugin installation or check which tree tools/agent_timeline.py is being read from.";
    return fail(
      "schema_version_mismatch",
      `Plugin was built against a different version of the tools/agent_timeline.py counter: expected schema version ${EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION}, ${got}. ${remedy}`,
    );
  }

  const parsed = agentTimelineSchema.safeParse(json);
  if (!parsed.success) {
    return fail("invalid_shape", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  // mergeEvents isn't part of the script's own contract (see AgentTimeline's
  // doc comment) — starts empty here, the same way parseThreadsTimeline
  // starts bbProjectId/… at null right after validating the raw script
  // output, for the service layer to fill in when it resolves it.
  return { ok: true, data: { ...parsed.data, mergeEvents: [] } };
}

/** True when a parsed JSON value looks like agent_timeline.py's `{"error": "..."}` output. */
export function isAgentTimelineScriptError(json: unknown): json is { error: string } {
  return isRecord(json) && typeof json.error === "string" && !("events" in json);
}

const TOOL_KIND_LABEL = "Tool";
const HOOK_KIND_LABEL = "Hook";
const USER_LABEL = "User";
const ASSISTANT_LABEL = "Assistant";

function truncate(raw: string, maxLength: number): string {
  if (raw.length <= maxLength) return raw;
  if (maxLength <= 1) return raw.slice(0, Math.max(maxLength, 0));
  return `${raw.slice(0, maxLength - 1)}…`;
}

/**
 * The single place where a timeline event turns into a UI caption: a
 * type-word (standing in for an icon in the text) plus a human-readable
 * target. The client renders the finished string and doesn't assemble it
 * again — the same approach as formatBucketDisplay in src/core/format.ts
 * (see memory/decisions/token-usage-one-caption-source.md).
 */
export function formatEventLabel(event: AgentTimelineEvent, maxLength = 80): string {
  switch (event.kind) {
    case "tool": {
      const base = `${TOOL_KIND_LABEL} ${event.name}`;
      return event.target ? truncate(`${base}: ${event.target}`, maxLength) : base;
    }
    case "hook": {
      const name = event.hookName ?? "?";
      const hookEvent = event.hookEvent ?? "?";
      return `${HOOK_KIND_LABEL} ${name} (${hookEvent})`;
    }
    case "message": {
      const roleLabel = event.role === "user" ? USER_LABEL : ASSISTANT_LABEL;
      // Cost only exists for assistant messages with usage (see messageEventSchema);
      // the field being absent, not 0, means "no price" — the suffix isn't shown.
      const prefix = event.cost !== undefined ? `${roleLabel} (${formatCost(event.cost)})` : roleLabel;
      return event.text ? truncate(`${prefix}: ${event.text}`, maxLength) : prefix;
    }
    default: {
      // Exhaustiveness guard — a new event kind added to the discriminated
      // union without updating this switch fails to compile here.
      const _never: never = event;
      return String(_never);
    }
  }
}
