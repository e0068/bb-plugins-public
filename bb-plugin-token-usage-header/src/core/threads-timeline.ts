// Zod-based parsing of `tools/threads_timeline.py --json` output into a
// typed result, plus pure UI-layout helpers for the threads feed. No I/O
// here — the caller (src/service) runs the process; this module only ever
// sees a string. Never throws: malformed input from an external process is
// an expected case, not a bug, so every failure comes back as a tagged
// result the caller must handle explicitly. Mirrors src/core/parse.ts's
// contract for tools/tokens.py, but a separate schema/version — a different
// script, a different JSON shape.
import { z } from "zod";

/**
 * Версия формата отчёта threads_timeline.py --json, которую понимает этот
 * бандл. Должна совпадать с SCHEMA_VERSION в tools/threads_timeline.py —
 * считалка читается с диска при каждом вызове, а это число живёт в
 * собранном бандле и обновляется только пересборкой. Отдельная версия от
 * EXPECTED_SCHEMA_VERSION в src/core/types.ts (tools/tokens.py) — разные
 * скрипты, разные контракты, версии не обязаны совпадать.
 *
 * 1 -> 2: добавлено верхнеуровневое поле agentLabels (человекочитаемые
 * имена агентов по ключу — см. RawThreadsTimelineSchema ниже).
 */
export const EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION = 2;

const AgentBinSchema = z
  .object({
    /** "main" для главного агента, иначе agentId субагента — как в tokens.py --by agent. */
    key: z.string(),
    total: z.number().finite(),
  })
  .strict();

const TimelineBinSchema = z
  .object({
    /** ISO 8601 UTC начало бина; кратно `unit` секундам от отчёта. */
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
    /** Сырой слаг каталога транскрипта из python (`~/.claude/projects/<slug>`) — не путать с bbProjectId/bbProjectName ниже. */
    project: z.string(),
    /** Пока всегда равно `session` — человекочитаемое имя подставляет сервис. */
    title: z.string(),
    start: z.string(),
    end: z.string(),
    durationSec: z.number().finite(),
    totalTokens: z.number().finite(),
    bins: z.array(TimelineBinSchema),
  })
  .strict();

/**
 * agentId (как в bins[].agents[].key, "main" для главного агента) ->
 * человекочитаемая метка. Строится threads_timeline.py из meta субагента
 * (description, иначе agentType, иначе сам agentId как fallback) — см.
 * tools/threads_timeline.py::_agent_label. Верхнеуровневое, не per-thread:
 * один и тот же agentId в разных тредах слайса делит одну метку. Пустой
 * объект — валидный случай (слайс без единого треда).
 */
const AgentLabelsSchema = z.record(z.string(), z.string());

const RawThreadsTimelineSchema = z
  .object({
    schemaVersion: z.number(),
    /** Размер бина в секундах, как был передан в --unit. */
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

  // Проверяется раньше threads/unit и чего угодно ещё: рассинхрон версии
  // означает, что собранный плагин и tools/threads_timeline.py на диске
  // говорят на разных диалектах формата, и претензия должна называть это, а
  // не первое поле данных, до которого дошёл разбор (см.
  // memory/decisions/token-usage-json-schema-version.md для того же приёма
  // на соседнем контракте).
  if (json.schemaVersion !== EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION) {
    const got =
      json.schemaVersion === undefined
        ? "поле версии схемы отсутствует"
        : `получена версия ${JSON.stringify(json.schemaVersion)}`;
    const remedy =
      typeof json.schemaVersion === "number" && json.schemaVersion > EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION
        ? "Нужна пересборка плагина."
        : "Пересборка плагина не поможет: обновите установку плагина или проверьте, из какого дерева берётся tools/threads_timeline.py.";
    return fail(
      "schema_version_mismatch",
      `Плагин собран под другую версию считалки tools/threads_timeline.py: ожидается версия схемы ${EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION}, ${got}. ${remedy}`,
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
    })),
  };

  return { ok: true, data };
}

// --- UI layout helpers -------------------------------------------------

/**
 * Доля ширины каждого треда относительно самого длинного по durationSec:
 * самый длинный получает 1.0, остальные — пропорционально своей
 * длительности. Индексы результата совпадают с индексами `threads`.
 *
 * Пустой массив -> пустой массив. Когда у всех тредов нулевая (или
 * отрицательная — не должно случаться, но не считается ошибкой здесь)
 * длительность, максимум равен нулю и делить не на что — каждый тред тогда
 * получает 1.0, а не NaN/Infinity: одноточечные бары рисуются одной и той
 * же минимальной шириной, а не пропадают.
 */
export function widthFractions(threads: readonly ThreadEntry[]): number[] {
  if (threads.length === 0) return [];
  const maxDuration = Math.max(...threads.map((t) => t.durationSec), 0);
  if (maxDuration <= 0) return threads.map(() => 1);
  return threads.map((t) => Math.max(t.durationSec, 0) / maxDuration);
}

/** Суммарный расход одного бина — сумма total всех агентов внутри него. */
export function binTotal(bin: TimelineBin): number {
  return bin.agents.reduce((sum, agent) => sum + agent.total, 0);
}
