// Runs tools/threads_timeline.py --json, parses its output, and caches
// identical queries — the "Thread feeds" counterpart of
// src/service/tokens-runner.ts + src/service/token-usage-service.ts. Kept
// as its own self-contained module (own runner + own cache) rather than
// wired through those, so this file doesn't need to touch
// src/service/index.ts or src/service/types.ts, which belong to other
// groups' file maps.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  deriveThreadLiveness,
  parseThreadsTimeline,
  type ThreadEntry,
  type ThreadsTimeline,
} from "../core/threads-timeline";
import { githubRepoSlugFromRemoteUrl, type CommitEvent, type GitEvent, type PrEvent } from "../core/git-events";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  runProcess,
  type ProcessRunner,
  type ProcessRunResult,
} from "./process-runner";
import { createThreadSessionResolver, type ThreadSessionResolver } from "./thread-session";

/** Interpreters tried in order; whichever works first is remembered. */
const INTERPRETER_CANDIDATES = ["python3", "python"] as const;
type Interpreter = (typeof INTERPRETER_CANDIDATES)[number];

/** How many ancestor directories to check before giving up. */
const MAX_ROOT_SEARCH_DEPTH = 6;

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_LIMIT = 20;

/**
 * How many of BB's most recently active threads to scan (via
 * `bb.sdk.threads.list`) when building the session→{threadId, projectId} map
 * for enrichBbProjects below. Bounds the identity-resolution work per
 * enrichment pass to a fixed, reasonable cost rather than walking every
 * thread BB has ever seen — see enrichBbProjects's doc comment for why a
 * per-thread identity call can't be avoided entirely.
 */
const THREADS_SCAN_LIMIT = 300;

/**
 * Walks up from `startDir` looking for a directory that has
 * `tools/threads_timeline.py` directly under it — that directory is the
 * plugin root. Same depth-bounded approach as tokens-runner.ts's
 * resolvePluginRoot, kept as an independent copy here rather than an
 * import: tokens-runner.ts belongs to a file map this group doesn't own,
 * and the two searches differ only in which script they look for.
 */
export function resolveThreadsTimelinePluginRoot(
  startDir: string,
  exists: (path: string) => boolean = existsSync,
  maxDepth: number = MAX_ROOT_SEARCH_DEPTH,
): string | null {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    if (exists(join(dir, "tools", "threads_timeline.py"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Resolves tools/threads_timeline.py from this module's own location, not
 * the process's cwd — same reasoning as tokens-runner.ts's
 * defaultScriptPath: `bb plugin build` inlines this module one level above
 * the plugin root, so a fixed number of `../` segments would break either
 * the source layout or the built one.
 */
export function defaultThreadsTimelineScriptPath(): string {
  const startDir = dirname(fileURLToPath(import.meta.url));
  const root = resolveThreadsTimelinePluginRoot(startDir) ?? join(startDir, "..", "..");
  return join(root, "tools", "threads_timeline.py");
}

/** Slice parameters accepted by `tools/threads_timeline.py --json`. */
export interface ThreadsTimelineQueryParams {
  /** How many of the most recently active sessions to include. Defaults to 20. */
  limit?: number;
  /** Bin size in seconds. Required — mirrors the script's required --unit. */
  unit: number;
  /** Substring match on the project path, as the script's `--project` does. */
  project?: string;
  /** Exact Claude Code session id — the single-session slice (session page). Overrides recency selection. */
  session?: string;
  /** Merge every agent of one workflow run into a single segment (`workflow:<runId>`). */
  groupWorkflows?: boolean;
}

export type ThreadsTimelineRunFailureReason =
  | "python_not_found"
  | "timeout"
  | "output_limit"
  | "script_error"
  | "invalid_output"
  | "process_error"
  | "invalid_params";

export type ThreadsTimelineRunResult =
  | { ok: true; data: ThreadsTimeline }
  | { ok: false; reason: ThreadsTimelineRunFailureReason; message: string };

function buildArgs(scriptPath: string, params: ThreadsTimelineQueryParams): string[] {
  const args = [scriptPath, "--json", "--unit", String(params.unit)];
  if (params.limit !== undefined) args.push("--limit", String(params.limit));
  if (params.project) args.push("--project", params.project);
  if (params.session) args.push("--session", params.session);
  if (params.groupWorkflows) args.push("--group-workflows");
  return args;
}

function mapProcessFailure(result: Extract<ProcessRunResult, { ok: false }>): ThreadsTimelineRunResult {
  const reason =
    result.reason === "not_found" ? "python_not_found" : result.reason === "spawn_error" ? "process_error" : result.reason;
  return { ok: false, reason, message: result.message };
}

// Same shape as tokens-runner.ts's mapStdout: parse stdout on its own, but
// on failure fold in stderr/exit code, since the process runner reports
// `ok: true` for any exit code as long as it reached `close`.
function mapStdout(result: Extract<ProcessRunResult, { ok: true }>): ThreadsTimelineRunResult {
  const parsed = parseThreadsTimeline(result.stdout);
  if (parsed.ok) return { ok: true, data: parsed.data };
  if (parsed.reason === "script_error") {
    return { ok: false, reason: "script_error", message: parsed.message };
  }
  const diagnostic = result.stderr.trim();
  const message = diagnostic
    ? `${parsed.message} (exit code ${result.code}): ${diagnostic}`
    : parsed.message;
  return { ok: false, reason: "invalid_output", message };
}

export interface ThreadsTimelineRunnerOptions {
  /** Defaults to the real `node:child_process`-backed runner. */
  processRunner?: ProcessRunner;
  scriptPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ThreadsTimelineRunner {
  run(params: ThreadsTimelineQueryParams): Promise<ThreadsTimelineRunResult>;
}

/**
 * Builds a runner that finds a Python interpreter, invokes
 * tools/threads_timeline.py with the given slice params, and parses the
 * result. Never throws — every failure mode comes back as a tagged result.
 */
export function createThreadsTimelineRunner(options: ThreadsTimelineRunnerOptions = {}): ThreadsTimelineRunner {
  const processRunner = options.processRunner ?? runProcess;
  const scriptPath = options.scriptPath ?? defaultThreadsTimelineScriptPath();
  const totalTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  let cachedInterpreter: Interpreter | null = null;

  return {
    async run(params) {
      if (!Number.isFinite(params.unit) || params.unit <= 0) {
        return {
          ok: false,
          reason: "invalid_params",
          message: "unit must be a finite positive number of seconds.",
        };
      }
      if (params.limit !== undefined && (!Number.isFinite(params.limit) || params.limit < 0)) {
        return {
          ok: false,
          reason: "invalid_params",
          message: "limit must not be negative.",
        };
      }

      const args = buildArgs(scriptPath, params);
      const order: readonly Interpreter[] = cachedInterpreter
        ? [cachedInterpreter, ...INTERPRETER_CANDIDATES.filter((c) => c !== cachedInterpreter)]
        : INTERPRETER_CANDIDATES;

      // One deadline shared across every interpreter attempt in this call —
      // see tokens-runner.ts's identical reasoning.
      const deadline = Date.now() + totalTimeoutMs;

      for (const interpreter of order) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          return {
            ok: false,
            reason: "timeout",
            message: `Overall time budget (${totalTimeoutMs}ms) exceeded before attempting to run "${interpreter}"`,
          };
        }

        const result = await processRunner(interpreter, args, { timeoutMs: remainingMs, maxOutputBytes });
        if (result.ok) {
          cachedInterpreter = interpreter;
          return mapStdout(result);
        }
        if (result.reason !== "not_found") {
          return mapProcessFailure(result);
        }
        if (cachedInterpreter === interpreter) cachedInterpreter = null;
      }

      return {
        ok: false,
        reason: "python_not_found",
        message:
          "Python interpreter (python3 or python) not found in PATH. Install Python 3 and make sure the python3 command is available.",
      };
    },
  };
}

/** Canonical cache key for a slice — order-independent, missing fields normalized. */
export function threadsTimelineCacheKey(params: ThreadsTimelineQueryParams): string {
  return JSON.stringify({
    limit: params.limit ?? DEFAULT_LIMIT,
    unit: params.unit,
    project: params.project ?? null,
    session: params.session ?? null,
    groupWorkflows: params.groupWorkflows ?? false,
  });
}

export interface ThreadsTimelineServiceOptions extends ThreadsTimelineRunnerOptions {
  /** Cache TTL in ms; defaults to 30s, same as token-usage-service.ts. */
  cacheTtlMs?: number;
  /** Injectable clock for deterministic TTL tests. */
  now?: () => number;
}

export interface ThreadsTimelineService {
  /** Runs (or serves from cache) the threads_timeline.py slice described by `params`. */
  query(params: ThreadsTimelineQueryParams): Promise<ThreadsTimelineRunResult>;
  /** Drops every cached entry, including in-flight ones. */
  clearCache(): void;
}

type BbProjectMatch = Pick<
  ThreadEntry,
  "bbProjectId" | "bbProjectName" | "threadId" | "bbThreadTitle" | "isAlive" | "isWorking"
>;

const UNMATCHED_BB_PROJECT: BbProjectMatch = {
  bbProjectId: null,
  bbProjectName: null,
  threadId: null,
  bbThreadTitle: null,
  // No BB thread matched → no liveness to read; the "Threads" bucket is
  // neither coloured alive nor blinking.
  isAlive: false,
  isWorking: false,
};

/**
 * What buildSessionToBbThreadMap keeps per matched session: the BB thread's
 * identity/title plus its raw liveness facts. The working flag is derived
 * later (enrichBbProjects), once the python thread's `end` and a clock are
 * also in hand.
 */
interface SessionBbThread {
  threadId: string;
  projectId: string;
  title: string | null;
  archivedAt: number | null;
  activeWorkCount: number;
}

/**
 * A thread counts as "working now" if its last activity is at most this fresh.
 * The feed refetches on mount and every ~30s (cache TTL), so a 2-minute window
 * lights the thread being worked at snapshot time and clears once it goes
 * quiet, without flickering across an agent's brief between-record gaps.
 */
const WORKING_WINDOW_MS = 2 * 60_000;

/**
 * Raw liveness facts of one `bb.sdk.threads.list` item, read defensively: a
 * degraded host (or a partial test stub) may omit `archivedAt`/`activity`, so a
 * missing field reads as "live / no background work" rather than throwing
 * inside the enrichment pass. The real SDK always sends all of them (see
 * threadListResponseSchema in bb-plugin-sdk.d.ts). Recency (the main "working"
 * signal) comes from the python thread's `end`, not from here — see
 * deriveThreadLiveness's doc.
 */
function livenessFactsOf(thread: {
  archivedAt?: number | null;
  activity?: {
    activeBackgroundAgentCount?: number;
    activeBackgroundCommandCount?: number;
    activeWorkflowCount?: number;
    activePlanModeCount?: number;
    activeGoalCount?: number;
  };
}): { archivedAt: number | null; activeWorkCount: number } {
  const a = thread.activity ?? {};
  const activeWorkCount =
    (a.activeBackgroundAgentCount ?? 0) +
    (a.activeBackgroundCommandCount ?? 0) +
    (a.activeWorkflowCount ?? 0) +
    (a.activePlanModeCount ?? 0) +
    (a.activeGoalCount ?? 0);
  return { archivedAt: thread.archivedAt ?? null, activeWorkCount };
}

/**
 * Scans up to THREADS_SCAN_LIMIT of BB's most recent threads and resolves
 * each one's Claude Code session id (via `resolver`, i.e.
 * createThreadSessionResolver — cached across calls so repeat threads are
 * free after their first resolution), building a session -> {threadId,
 * projectId, title} map.
 *
 * Neither `ThreadResponse` (bb.sdk.threads.list's item shape) nor any other
 * SDK method carries a session/providerThreadId field directly or supports
 * a reverse (session -> thread) lookup — see bundled-types/bb-plugin-sdk.d.ts.
 * The only way to learn a thread's session is a `thread/identity` event
 * lookup per thread, which is exactly what the resolver already does for
 * sessionTokenUsage. This is therefore the one place that pays the O(threads
 * scanned) cost; every other consumer of the resolver pays O(1) per thread
 * once it's cached.
 */
async function buildSessionToBbThreadMap(
  bb: BbPluginApi,
  resolver: ThreadSessionResolver,
): Promise<Map<string, SessionBbThread>> {
  const threads = await bb.sdk.threads.list({ limit: THREADS_SCAN_LIMIT });
  const map = new Map<string, SessionBbThread>();
  await Promise.all(
    threads.map(async (thread) => {
      const sessionId = await resolver.resolve(thread.id);
      if (sessionId !== null) {
        map.set(sessionId, {
          threadId: thread.id,
          projectId: thread.projectId,
          // Raw liveness facts off the same list item; the working flag also
          // needs the python thread's `end`, so the derivation happens in
          // enrichBbProjects — see memory/decisions/thread-liveness-signals.md.
          ...livenessFactsOf(thread),
          // `title` is BB's user-set (or auto-generated on first message)
          // thread name; `titleFallback` is BB's own derived fallback for a
          // thread that never got one (see bb-plugin-sdk.d.ts's
          // threadListResponseSchema). Preferring title mirrors how BB's own
          // UI picks a thread's display name; null only when neither is set
          // (e.g. a thread with no messages yet), in which case the page
          // falls back to a short session id instead.
          title: thread.title ?? thread.titleFallback ?? null,
        });
      }
    }),
  );
  return map;
}

/** projectId -> display name, for every BB project (including the personal one — a session may well belong to it). */
async function buildProjectNameMap(bb: BbPluginApi): Promise<Map<string, string>> {
  const projects = await bb.sdk.projects.list({ includePersonal: true });
  const map = new Map<string, string>();
  for (const project of projects) {
    map.set(project.id, project.name);
  }
  return map;
}

/**
 * Enriches each parsed thread entry with its matching BB project, so the
 * "Projects" picker on the feed page can group by BB's actual projects (a
 * handful) instead of raw `~/.claude/projects` directory slugs (dozens) —
 * see this group's task description. A session that doesn't match any of
 * the scanned BB threads (older than THREADS_SCAN_LIMIT, or from outside BB
 * entirely) gets `{ bbProjectId: null, bbProjectName: null, threadId: null
 * }`, which the UI renders as the catch-all "Threads" bucket.
 *
 * Never throws and never fails the slice: bb.sdk is a live round trip to the
 * host and can reject (daemon unreachable, thread deleted mid-scan) the same
 * way the python process can — an enrichment failure degrades to "every
 * thread unmatched", not a lost slice. Logged softly (console.error) since
 * there's no RPC-level error channel for a partial/degraded success.
 */
async function enrichBbProjects(
  bb: BbPluginApi,
  resolver: ThreadSessionResolver,
  timeline: ThreadsTimeline,
  nowMs: number,
): Promise<ThreadsTimeline> {
  if (timeline.threads.length === 0) return timeline;

  try {
    const [sessionMap, projectNames] = await Promise.all([
      buildSessionToBbThreadMap(bb, resolver),
      buildProjectNameMap(bb),
    ]);

    const threads = timeline.threads.map((thread): ThreadEntry => {
      const match = sessionMap.get(thread.session);
      if (!match) return { ...thread, ...UNMATCHED_BB_PROJECT };
      // Working = alive + recent last activity (`end`) or running background
      // work — see deriveThreadLiveness and the decision doc.
      const liveness = deriveThreadLiveness({
        archivedAt: match.archivedAt,
        lastActivityMs: Date.parse(thread.end),
        nowMs,
        workingWindowMs: WORKING_WINDOW_MS,
        activeWorkCount: match.activeWorkCount,
      });
      return {
        ...thread,
        bbProjectId: match.projectId,
        bbProjectName: projectNames.get(match.projectId) ?? null,
        threadId: match.threadId,
        bbThreadTitle: match.title,
        isAlive: liveness.isAlive,
        isWorking: liveness.isWorking,
      };
    });
    return { ...timeline, threads };
  } catch (err) {
    console.error("[threads-timeline-service] BB project enrichment failed, falling back to unmatched:", err);
    return { ...timeline, threads: timeline.threads.map((thread) => ({ ...thread, ...UNMATCHED_BB_PROJECT })) };
  }
}

// --- Commit/push enrichment (live `git log` / `git config`) --------------

// Field/record separators for `git log --pretty=format`, chosen because a
// commit subject can itself contain almost any character except these two
// control bytes — a plain "," or "|" would risk splitting a real subject.
const COMMIT_LOG_FIELD_SEP = "\x1f";
const COMMIT_LOG_RECORD_SEP = "\x1e";
const COMMIT_LOG_FORMAT = `%H${COMMIT_LOG_FIELD_SEP}%aI${COMMIT_LOG_FIELD_SEP}%s${COMMIT_LOG_RECORD_SEP}`;

/**
 * Per-call timeout for one `git log`/`git config` invocation — short on
 * purpose: these run once per thread, in parallel, and a single hung/huge
 * repo must not hold up the whole feed's response the way DEFAULT_TIMEOUT_MS
 * (30s) would if applied here.
 */
const GIT_CALL_TIMEOUT_MS = 5_000;

/** Parses `git log --pretty=format:COMMIT_LOG_FORMAT` stdout into commit events, priced with repoSlug's URL scheme when known. */
function parseCommitLog(stdout: string, repoSlug: string | null): CommitEvent[] {
  return stdout
    .split(COMMIT_LOG_RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, authorDate, ...rest] = record.split(COMMIT_LOG_FIELD_SEP);
      const message = rest.join(COMMIT_LOG_FIELD_SEP);
      return {
        type: "commit" as const,
        ts: authorDate,
        hash,
        message,
        url: repoSlug ? `https://github.com/${repoSlug}/commit/${hash}` : null,
      };
    });
}

/**
 * A thread's GitHub "owner/repo" slug, for building commit/push links.
 * Prefers a `pr` event already on the thread (free — no extra process, and
 * it's the exact repo the PR was opened against) over a live `git config`
 * lookup, which only runs when no PR event exists yet. Never throws: a
 * failed/missing remote resolves to null, same as an unresolvable one.
 */
async function resolveRepoSlug(thread: ThreadEntry, processRunner: ProcessRunner): Promise<string | null> {
  const prEvent = thread.events.find((event): event is PrEvent => event.type === "pr");
  if (prEvent) return prEvent.repository;
  if (!thread.cwd) return null;
  const result = await processRunner("git", ["-C", thread.cwd, "config", "--get", "remote.origin.url"], {
    timeoutMs: GIT_CALL_TIMEOUT_MS,
  });
  if (!result.ok || result.code !== 0) return null;
  return githubRepoSlugFromRemoteUrl(result.stdout.trim());
}

/** Live `git log` for one thread's own window (its branch, [start, end]) — [] on any failure, never throws. */
async function commitEventsFor(
  thread: ThreadEntry,
  repoSlug: string | null,
  processRunner: ProcessRunner,
): Promise<CommitEvent[]> {
  if (!thread.gitBranch || !thread.cwd) return [];
  const result = await processRunner(
    "git",
    [
      "-C",
      thread.cwd,
      "log",
      thread.gitBranch,
      `--since=${thread.start}`,
      `--until=${thread.end}`,
      `--pretty=format:${COMMIT_LOG_FORMAT}`,
    ],
    { timeoutMs: GIT_CALL_TIMEOUT_MS },
  );
  if (!result.ok || result.code !== 0) return [];
  return parseCommitLog(result.stdout, repoSlug);
}

/** Fills in a push event's url once repoSlug is known — a no-op for every other event kind, or one already carrying a url. */
function backfillPushUrl(event: GitEvent, repoSlug: string | null): GitEvent {
  if (event.type !== "push" || event.url !== null || repoSlug === null || event.branch === null) return event;
  return { ...event, url: `https://github.com/${repoSlug}/tree/${event.branch}` };
}

async function enrichThreadCommits(thread: ThreadEntry, processRunner: ProcessRunner): Promise<ThreadEntry> {
  // No cwd, or the worktree it pointed at is gone (cleaned up by git
  // hygiene after the thread's branch merged/closed) — nothing live to ask,
  // same "graceful, not an error" outcome as an unmatched BB project above.
  if (!thread.cwd || !existsSync(thread.cwd)) return thread;
  try {
    const repoSlug = await resolveRepoSlug(thread, processRunner);
    const commits = await commitEventsFor(thread, repoSlug, processRunner);
    const events = [...thread.events.map((event) => backfillPushUrl(event, repoSlug)), ...commits].sort((a, b) =>
      a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
    );
    return { ...thread, events };
  } catch (err) {
    console.error("[threads-timeline-service] commit enrichment failed for one thread, leaving it without commit events:", err);
    return thread;
  }
}

/**
 * Adds live commit events to every thread whose working directory still
 * exists on disk, and backfills a push event's url once the thread's GitHub
 * repo slug becomes known. Threads are enriched in parallel and
 * independently — same resilience shape as enrichBbProjects: one thread's
 * git failure never fails the slice, it just leaves that thread without
 * commit events.
 */
async function enrichCommits(timeline: ThreadsTimeline, processRunner: ProcessRunner): Promise<ThreadsTimeline> {
  if (timeline.threads.length === 0) return timeline;
  const threads = await Promise.all(timeline.threads.map((thread) => enrichThreadCommits(thread, processRunner)));
  return { ...timeline, threads };
}

/**
 * `bb` powers BB-project enrichment (see enrichBbProjects above): each
 * query's result is tagged with the BB project/thread its Claude Code
 * session matches, or nulls when it doesn't match any. The session resolver
 * is created once here, not per query, so its positive-result cache (see
 * createThreadSessionResolver) is reused across queries instead of being
 * rebuilt from scratch every time — the one piece of this enrichment that's
 * cheap to keep warm.
 */
export function createThreadsTimelineService(
  bb: BbPluginApi,
  options: ThreadsTimelineServiceOptions = {},
): ThreadsTimelineService {
  const runner = createThreadsTimelineRunner(options);
  const resolver = createThreadSessionResolver(bb);
  const processRunner = options.processRunner ?? runProcess;
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;

  const entries = new Map<string, { expiresAt: number; promise: Promise<ThreadsTimelineRunResult> }>();

  return {
    query(params) {
      const key = threadsTimelineCacheKey(params);
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        return existing.promise;
      }

      // Enrichment runs once per (uncached) query and is folded into the
      // same cached promise as the raw slice — a cache hit above skips the
      // python process, the BB project scan, AND the per-thread git calls
      // together.
      const promise = runner.run(params).then(async (result): Promise<ThreadsTimelineRunResult> => {
        if (!result.ok) return result;
        const withProjects = await enrichBbProjects(bb, resolver, result.data, now());
        const withCommits = await enrichCommits(withProjects, processRunner);
        return { ok: true, data: withCommits };
      });
      const entry = { expiresAt: now() + ttlMs, promise };
      entries.set(key, entry);

      const dropIfCurrent = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      promise.catch(dropIfCurrent);
      // Failures aren't cached — same reasoning as cache.ts: an
      // environment problem (missing python, transient error) shouldn't
      // freeze the whole TTL on one bad result.
      promise.then((result) => {
        if (!result.ok) dropIfCurrent();
      }, dropIfCurrent);

      return promise;
    },
    clearCache() {
      entries.clear();
    },
  };
}
