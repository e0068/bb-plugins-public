// Zod-based parsing of `tools/threads_timeline.py --json` output into a
// typed result, plus pure UI-layout helpers for the threads feed. No I/O
// here — the caller (src/service) runs the process; this module only ever
// sees a string. Never throws: malformed input from an external process is
// an expected case, not a bug, so every failure comes back as a tagged
// result the caller must handle explicitly. Mirrors src/core/parse.ts's
// contract for tools/tokens.py, but a separate schema/version — a different
// script, a different JSON shape.
import { z } from "zod";
import { gitEventSchema } from "./git-events";

/**
 * Version of the threads_timeline.py --json report format understood by
 * this bundle. Must match SCHEMA_VERSION in tools/threads_timeline.py — the
 * counter script is read from disk on every call, while this number lives
 * in the built bundle and only gets updated on rebuild. A separate version
 * from EXPECTED_SCHEMA_VERSION in src/core/types.ts (tools/tokens.py) —
 * different scripts, different contracts, the versions don't have to match.
 *
 * 1 -> 2: added the top-level agentLabels field (human-readable agent names
 * by key — see RawThreadsTimelineSchema below).
 * 2 -> 3: a thread gained totalCost (usage cost in USD at tokens.py's rate)
 * and workflowCount (number of distinct workflow runs in the session).
 * 3 -> 4: a bin's workflow segment (key == "workflow:<run>", only under
 * group_workflows) gained members — the real agentIds merged into the segment.
 * 4 -> 5: a thread gained cwd/gitBranch (its working directory and git
 * branch, read from the transcript) and events (pr/push facts from the same
 * transcript — see git_events.scan_session; commit events are appended
 * later, client-independent of the script, by
 * src/service/threads-timeline-service.ts's enrichCommits).
 */
export const EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION = 5;

const AgentBinSchema = z
  .object({
    /** "main" for the main agent, otherwise the subagent's agentId — as in tokens.py --by agent. */
    key: z.string(),
    total: z.number().finite(),
    /**
     * Real agentIds merged into this segment — present ONLY when `key`
     * itself is a group workflow key (`workflow:<run>`, see
     * tools/threads_timeline.py::_bin_key under --group-workflows); for a
     * regular agent, key is already its real id and the field is absent.
     * Exists so the session chart (thread-chart.tsx) can highlight/dim a
     * segment by the selected agent — without it, which real agent
     * contributed within a merged segment would be indistinguishable.
     */
    members: z.array(z.string()).optional(),
  })
  .strict();

const TimelineBinSchema = z
  .object({
    /** ISO 8601 UTC start of the bin; a multiple of the report's `unit` seconds. */
    t: z.string(),
    agents: z.array(AgentBinSchema),
  })
  .strict();

// Shape exactly as threads_timeline.py --json prints one thread — the
// script doesn't know about BB projects at all, so this schema (used to
// validate its raw stdout below) never mentions bbProjectId/bbProjectName/
// threadId. Those three are attached by parseThreadsTimeline itself, right
// after this schema validates, with null defaults — see ThreadEntry below.
const RawThreadEntrySchema = z
  .object({
    session: z.string(),
    /** Raw transcript directory slug from python (`~/.claude/projects/<slug>`) — not to be confused with bbProjectId/bbProjectName below. */
    project: z.string(),
    /** Currently always equal to `session` — the service substitutes the human-readable name. */
    title: z.string(),
    start: z.string(),
    end: z.string(),
    durationSec: z.number().finite(),
    totalTokens: z.number().finite(),
    /** Cost of the thread's entire usage in USD, at the same rate as tokens.py (Bucket.cost). */
    totalCost: z.number().finite(),
    /** How many distinct workflow runs took part in the session (0 — a regular thread with no workflow). */
    workflowCount: z.number().int().nonnegative(),
    bins: z.array(TimelineBinSchema),
    /** The session's working directory, from its own transcript records — null when none carried both cwd and gitBranch. Used by the service layer to resolve commit events via a live `git log`; the parsed report otherwise only reads it, never runs anything with it. */
    cwd: z.string().nullable(),
    /** The session's git branch, same source/nullability as cwd. */
    gitBranch: z.string().nullable(),
    /** pr/push facts mined from the transcript by tools/git_events.py — commit events are appended on top by the service layer, not present in the script's own output. */
    events: z.array(gitEventSchema),
  })
  .strict();

/**
 * agentId (as in bins[].agents[].key, "main" for the main agent) ->
 * human-readable label. Built by threads_timeline.py from the subagent's
 * meta (description, else agentType, else the agentId itself as a fallback)
 * — see tools/threads_timeline.py::_agent_label. Top-level, not per-thread:
 * the same agentId across different threads of the slice shares one label.
 * An empty object is a valid case (a slice with no threads at all).
 */
const AgentLabelsSchema = z.record(z.string(), z.string());

const RawThreadsTimelineSchema = z
  .object({
    schemaVersion: z.number(),
    /** Bin size in seconds, as passed to --unit. */
    unit: z.number().finite(),
    threads: z.array(RawThreadEntrySchema),
    agentLabels: AgentLabelsSchema,
  })
  .strict();

export type AgentBin = z.infer<typeof AgentBinSchema>;
export type TimelineBin = z.infer<typeof TimelineBinSchema>;

/**
 * A thread as the rest of the plugin sees it — threads_timeline.py's own
 * fields plus the BB project/thread match added on top. bbProjectId/
 * bbProjectName/threadId/bbThreadTitle are always present (never optional)
 * but frequently null: a session that isn't tied to any BB thread (older
 * than threads-timeline-service.ts's scan window, or from outside BB
 * entirely) is the catch-all "Threads" bucket on the project picker, not a
 * parse failure. parseThreadsTimeline fills these four with null right
 * after validating the raw script output; src/service/threads-timeline-service.ts
 * overwrites them with a real match when it finds one. bbThreadTitle is the
 * BB thread's human-readable title (distinct from the script's own `title`
 * field above, which is always just the session id) — the UI prefers it as
 * the card's display name, falling back to a short session id when null.
 */
export type ThreadEntry = z.infer<typeof RawThreadEntrySchema> & {
  bbProjectId: string | null;
  bbProjectName: string | null;
  threadId: string | null;
  bbThreadTitle: string | null;
  /**
   * True when the matched BB thread is live (not archived). False for a
   * session with no BB thread match (the "Threads" bucket) — liveness is a
   * property of a BB thread, and there's none to read. Drives the feed's
   * green thread title.
   */
  isAlive: boolean;
  /**
   * True when work is happening in the matched BB thread right now — its main
   * turn is active or any background work runs (see deriveThreadLiveness).
   * Always false for an unmatched session. Drives the feed's blinking dot.
   */
  isWorking: boolean;
};

export type ThreadsTimeline = Omit<z.infer<typeof RawThreadsTimelineSchema>, "threads"> & {
  threads: ThreadEntry[];
};

export type ThreadsTimelineParseFailureReason =
  | "invalid_json"
  | "invalid_shape"
  | "script_error"
  | "schema_version_mismatch";

export interface ThreadsTimelineParseSuccess {
  ok: true;
  data: ThreadsTimeline;
}

export interface ThreadsTimelineParseFailure {
  ok: false;
  reason: ThreadsTimelineParseFailureReason;
  message: string;
}

export type ThreadsTimelineParseResult = ThreadsTimelineParseSuccess | ThreadsTimelineParseFailure;

export interface ThreadsTimelineScriptError {
  error: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(reason: ThreadsTimelineParseFailureReason, message: string): ThreadsTimelineParseFailure {
  return { ok: false, reason, message };
}

/** True when a parsed JSON value looks like threads_timeline.py's `{"error": "..."}` output. */
export function isThreadsTimelineScriptError(json: unknown): json is ThreadsTimelineScriptError {
  return isRecord(json) && typeof json.error === "string" && !("threads" in json);
}

/**
 * Parses the stdout of `threads_timeline.py --json`. Returns a tagged
 * result — never throws.
 */
export function parseThreadsTimeline(raw: string): ThreadsTimelineParseResult {
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

  // threads_timeline.py's own top-level exception handler prints
  // {"error": "..."} and nothing else — distinguish that from a malformed
  // real report before anything else looks at the shape.
  if (isThreadsTimelineScriptError(json)) {
    return fail("script_error", json.error);
  }

  if (!isRecord(json)) {
    return fail("invalid_shape", "expected a JSON object at the top level");
  }

  // Checked before threads/unit and anything else: a version mismatch means
  // the built plugin and tools/threads_timeline.py on disk speak different
  // dialects of the format, and the failure must name that instead of the
  // first data field the parser happens to reach (see
  // memory/decisions/token-usage-json-schema-version.md for the same
  // approach on the neighboring contract).
  if (json.schemaVersion !== EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION) {
    const got =
      json.schemaVersion === undefined
        ? "the schema version field is missing"
        : `got version ${JSON.stringify(json.schemaVersion)}`;
    const remedy =
      typeof json.schemaVersion === "number" && json.schemaVersion > EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION
        ? "Rebuild the plugin."
        : "Rebuilding the plugin won't help: update the plugin installation or check which tree tools/threads_timeline.py is being read from.";
    return fail(
      "schema_version_mismatch",
      `Plugin was built against a different version of the tools/threads_timeline.py counter: expected schema version ${EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION}, ${got}. ${remedy}`,
    );
  }

  const result = RawThreadsTimelineSchema.safeParse(json);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
    return fail("invalid_shape", message);
  }

  // The raw schema validated the script's own fields; bbProjectId/
  // bbProjectName/threadId/bbThreadTitle aren't part of that contract (see
  // RawThreadEntrySchema's doc comment) — start every thread unmatched, for
  // the service layer to fill in when it enriches against bb.sdk.
  const data: ThreadsTimeline = {
    ...result.data,
    threads: result.data.threads.map((thread) => ({
      ...thread,
      bbProjectId: null,
      bbProjectName: null,
      threadId: null,
      bbThreadTitle: null,
      isAlive: false,
      isWorking: false,
    })),
  };

  return { ok: true, data };
}

// --- UI layout helpers -------------------------------------------------

/**
 * Each thread's width fraction relative to the longest by durationSec: the
 * longest gets 1.0, the rest are proportional to their own duration. Result
 * indexes match `threads`' indexes.
 *
 * Empty array -> empty array. When every thread has zero (or negative —
 * shouldn't happen, but isn't treated as an error here) duration, the
 * maximum is zero and there's nothing to divide by — every thread then gets
 * 1.0, not NaN/Infinity: single-point bars are drawn at the same minimal
 * width instead of disappearing.
 */
export function widthFractions(threads: readonly ThreadEntry[]): number[] {
  if (threads.length === 0) return [];
  const maxDuration = Math.max(...threads.map((t) => t.durationSec), 0);
  if (maxDuration <= 0) return threads.map(() => 1);
  return threads.map((t) => Math.max(t.durationSec, 0) / maxDuration);
}

/** Total usage of one bin — the sum of `total` across all agents within it. */
export function binTotal(bin: TimelineBin): number {
  return bin.agents.reduce((sum, agent) => sum + agent.total, 0);
}

// --- Thread liveness ---------------------------------------------------

/**
 * The BB-thread facts the feed's liveness indicators derive from, reduced to
 * exactly what {@link deriveThreadLiveness} needs. The service (imperative
 * shell) reads these off `bb.sdk.threads.list`'s response and hands them here;
 * this module never imports the SDK, so the mapping stays testable in
 * isolation — see memory/decisions/thread-liveness-signals.md.
 */
export interface ThreadLivenessInput {
  /** Epoch ms the BB thread was archived at, or null while it's still live. */
  archivedAt: number | null;
  /**
   * Epoch ms of the thread's most recent activity — the last transcript
   * record (`end`). The feed is a transcript snapshot, not a live turn feed:
   * bb.sdk.threads.list's own `status`/`runtime.displayStatus` describe the
   * *environment* lifecycle (provisioning/starting/stopping), not "an agent
   * turn is running now" — a local thread works at status "idle". So recency
   * of this record is the honest "working now" signal. NaN when unparseable.
   */
  lastActivityMs: number;
  /** Epoch ms "now" at snapshot time — injected, never read from the clock in core. */
  nowMs: number;
  /** How fresh lastActivityMs must be (ms) to count the thread as working. */
  workingWindowMs: number;
  /** Count of background work items running now (agents + commands + workflows + plan mode + goals). */
  activeWorkCount: number;
}

export interface ThreadLiveness {
  isAlive: boolean;
  isWorking: boolean;
}

/**
 * Derives the two feed indicators from a BB thread's raw liveness facts.
 * Pure and total: same input, same flags, no I/O.
 *
 * - `isAlive` — the thread is not archived.
 * - `isWorking` — the thread is alive AND either its last activity is within
 *   `workingWindowMs` of now, or some background work is running. An archived
 *   thread is never shown working, even with a stale flag (see the decision
 *   doc). A NaN `lastActivityMs` fails the recency test, never throws.
 */
export function deriveThreadLiveness(input: ThreadLivenessInput): ThreadLiveness {
  const isAlive = input.archivedAt === null;
  // No lower bound on the gap: a lastActivityMs slightly in the future (clock
  // skew) is "just now", still recent. NaN makes the comparison false.
  const recentlyActive = input.nowMs - input.lastActivityMs <= input.workingWindowMs;
  const isWorking = isAlive && (recentlyActive || input.activeWorkCount > 0);
  return { isAlive, isWorking };
}
