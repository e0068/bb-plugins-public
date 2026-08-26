// Runs tools/threads_timeline.py --json, parses its output, and caches
// identical queries — the "Ленты тредов" counterpart of
// src/service/tokens-runner.ts + src/service/token-usage-service.ts. Kept
// as its own self-contained module (own runner + own cache) rather than
// wired through those, so this file doesn't need to touch
// src/service/index.ts or src/service/types.ts, which belong to other
// groups' file maps.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { parseThreadsTimeline, type ThreadEntry, type ThreadsTimeline } from "../core/threads-timeline";
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
    ? `${parsed.message} (код завершения ${result.code}): ${diagnostic}`
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
          message: "unit должен быть конечным положительным числом секунд.",
        };
      }
      if (params.limit !== undefined && (!Number.isFinite(params.limit) || params.limit < 0)) {
        return {
          ok: false,
          reason: "invalid_params",
          message: "limit не может быть отрицательным.",
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
            message: `Превышен общий бюджет времени (${totalTimeoutMs}ms) до попытки запустить "${interpreter}"`,
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
          "Не найден интерпретатор Python (python3 или python) в PATH. Установите Python 3 и убедитесь, что команда python3 доступна.",
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

type BbProjectMatch = Pick<ThreadEntry, "bbProjectId" | "bbProjectName" | "threadId" | "bbThreadTitle">;

const UNMATCHED_BB_PROJECT: BbProjectMatch = {
  bbProjectId: null,
  bbProjectName: null,
  threadId: null,
  bbThreadTitle: null,
};

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
): Promise<Map<string, { threadId: string; projectId: string; title: string | null }>> {
  const threads = await bb.sdk.threads.list({ limit: THREADS_SCAN_LIMIT });
  const map = new Map<string, { threadId: string; projectId: string; title: string | null }>();
  await Promise.all(
    threads.map(async (thread) => {
      const sessionId = await resolver.resolve(thread.id);
      if (sessionId !== null) {
        map.set(sessionId, {
          threadId: thread.id,
          projectId: thread.projectId,
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
 * "Проекты" picker on the feed page can group by BB's actual projects (a
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
      return {
        ...thread,
        bbProjectId: match.projectId,
        bbProjectName: projectNames.get(match.projectId) ?? null,
        threadId: match.threadId,
        bbThreadTitle: match.title,
      };
    });
    return { ...timeline, threads };
  } catch (err) {
    console.error("[threads-timeline-service] BB project enrichment failed, falling back to unmatched:", err);
    return { ...timeline, threads: timeline.threads.map((thread) => ({ ...thread, ...UNMATCHED_BB_PROJECT })) };
  }
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
      // same cached promise as the raw slice — a cache hit above skips both
      // the python process and the BB project scan together.
      const promise = runner.run(params).then(async (result): Promise<ThreadsTimelineRunResult> => {
        if (!result.ok) return result;
        return { ok: true, data: await enrichBbProjects(bb, resolver, result.data) };
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
