// bb-plugin-token-usage-header — backend entry.
//
// Exposes one RPC method, `sessionTokenUsage`, that the header control
// (app.tsx) polls for a thread's Claude Code token usage: session totals,
// broken down by kind, plus one row per agent invocation (main agent +
// every subagent call), sorted by spend.
import { defineRpcContract, type BbPluginApi, type PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  agentTimelineEventSchema,
  cacheWriteTotal,
  formatBucketDisplay,
  parseVizSettings,
  vizSettingsSchema,
  VIZ_SETTINGS_KV_KEY,
  type AgentTimelineAgentInfo,
  type ThreadEntry,
  type ThreadsTimeline,
  type TokensReport,
  type VizSettings,
} from "./src/core";
import {
  createAgentTimelineService,
  createThreadsTimelineService,
  createTokenUsageService,
  type AgentTimelineService,
  type ThreadsTimelineService,
  type TokenUsageService,
} from "./src/service";

// A finite, non-NaN token/cost count — RPC output must be strict JSON, so
// this closes off the two ways a raw double could sneak past `z.number()`.
const finiteNumber = z.number().finite();

// tools/tokens.py defaults --top to 25 when it isn't passed — fine for its
// human-readable table, but far too low for a session with many subagent
// calls (workflows regularly launch 40+). Pass an explicit, much higher cap
// so the header doesn't silently drop rows, and rely on the report's own
// `truncated` flag (surfaced below) when even this is exceeded.
const AGENT_ROWS_LIMIT = 200;

const tokenBreakdownSchema = z.object({
  total: finiteNumber,
  input: finiteNumber,
  cacheWrite: finiteNumber,
  cacheRead: finiteNumber,
  output: finiteNumber,
  thinking: finiteNumber,
});

// Разбивка стоимости по видам токенов — для цены в каждой строке разбивки
// попапа. input+cacheWrite+cacheRead+output складываются в `cost`; thinking —
// часть output. Считает tools/tokens.py, здесь только протягивается.
const costBreakdownSchema = z.object({
  input: finiteNumber,
  cacheWrite: finiteNumber,
  cacheRead: finiteNumber,
  output: finiteNumber,
  thinking: finiteNumber,
});

const sessionTotalsSchema = tokenBreakdownSchema.extend({
  cost: finiteNumber,
  costs: costBreakdownSchema,
  messages: finiteNumber,
});

const agentUsageSchema = z.object({
  /** Bucket key from tools/tokens.py: "main" for the top-level agent, "agent-<hash>" for a subagent call. */
  key: z.string(),
  /** Готовые имя и подпись — см. formatBucketDisplay в src/core, единственное место, где они вычисляются. */
  name: z.string(),
  caption: z.string().nullable(),
  total: finiteNumber,
  /** Оценка стоимости бакета агента в USD — считалка тарифицирует бакет целиком. */
  cost: finiteNumber,
});

// agent_timeline.py's --json report shape (src/core/agent-timeline.ts) doesn't
// export its `agent` field's schema — only the type. That module lives in
// group A's file map, so its shape is mirrored here rather than changed
// there; the `satisfies` check below fails to compile if the two drift.
// `events` is reused as-is via the exported `agentTimelineEventSchema`
// instead of being redefined.
const agentTimelineAgentInfoSchema = z
  .object({
    key: z.string(),
    agentType: z.string().nullable(),
    description: z.string().nullable(),
    model: z.string().nullable(),
    spawnDepth: z.number().nullable(),
    promptExcerpt: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<AgentTimelineAgentInfo>;

// Same reasoning as agentTimelineAgentInfoSchema above: threads_timeline.py's
// report shape (src/core/threads-timeline.ts) only exports types, not its
// zod schemas — mirrored here, checked against the type with `satisfies`.
const threadsTimelineAgentBinSchema = z.object({
  key: z.string(),
  total: finiteNumber,
});

const threadsTimelineBinSchema = z.object({
  t: z.string(),
  agents: z.array(threadsTimelineAgentBinSchema),
});

const threadsTimelineEntrySchema = z
  .object({
    session: z.string(),
    project: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    durationSec: finiteNumber,
    totalTokens: finiteNumber,
    bins: z.array(threadsTimelineBinSchema),
    // BB project/thread match, resolved by threads-timeline-service.ts —
    // null when the session isn't tied to any BB thread (the "Threads"
    // bucket on the project picker). See threads-timeline.ts's ThreadEntry
    // doc. bbThreadTitle is the matched BB thread's human title, used by the
    // page as the card's display name instead of the raw session id.
    bbProjectId: z.string().nullable(),
    bbProjectName: z.string().nullable(),
    threadId: z.string().nullable(),
    bbThreadTitle: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<ThreadEntry>;

// Same reasoning as threadsTimelineEntrySchema above — mirrors
// ThreadsTimeline["agentLabels"] (src/core/threads-timeline.ts), checked with
// `satisfies`. agentId (as in bins[].agents[].key, "main" for the main
// agent) -> human-readable label built by threads_timeline.py from the
// subagent's meta.json.
const threadsTimelineAgentLabelsSchema = z.record(z.string(), z.string()) satisfies z.ZodType<
  ThreadsTimeline["agentLabels"]
>;

export const rpcContract = defineRpcContract({
  sessionTokenUsage: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ready"),
        /**
         * Claude Code session id, already resolved from `threadId` inside
         * the service — surfaced so the header's "Детали" button can hand
         * it straight to `agentTimeline` (which now takes a session, not a
         * threadId; a chart click only ever knows the session id, not BB's
         * threadId, and that's the mismatch this field fixes).
         */
        sessionId: z.string(),
        totals: sessionTotalsSchema,
        agents: z.array(agentUsageSchema),
        /** True when the agent breakdown was capped at AGENT_ROWS_LIMIT and more rows exist. */
        truncated: z.boolean(),
      }),
      // Normal for a just-created thread: it hasn't produced a
      // `thread/identity` event yet, so there is no Claude Code session to
      // count against — not an error.
      z.object({ status: z.literal("no-session") }),
      // A recognized failure from the counting pipeline (no python3,
      // timeout, tools/tokens.py's own error envelope, ...), reduced to a
      // message fit for display.
      z.object({ status: z.literal("error"), message: z.string() }),
    ]),
  },
  agentTimeline: {
    // Takes a Claude Code session directly (not a BB threadId): the chart
    // that links here only ever knows the session id, and resolving it back
    // to a threadId first (then re-resolving to a session inside the
    // service) would be a pointless round trip through a mapping this
    // endpoint doesn't otherwise need. No `resolveSessionId` call, no
    // "no-session" status — the session is assumed already resolved by the
    // caller (e.g. from sessionTokenUsage's `sessionId`).
    input: z.object({ session: z.string().min(1), agent: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ready"),
        // Same session totals/agent-breakdown shape as sessionTokenUsage's
        // ready output (minus sessionId/truncated) — reused here so the
        // detail panel's left popover (session breakdown + agent list) is
        // fed by this one call instead of a second round trip.
        totals: sessionTotalsSchema,
        agents: z.array(agentUsageSchema),
        agent: agentTimelineAgentInfoSchema,
        events: z.array(agentTimelineEventSchema),
      }),
      z.object({ status: z.literal("error"), message: z.string() }),
    ]),
  },
  threadsTimeline: {
    // Cross-session slice — no threadId: unlike the two methods above, this
    // one doesn't scope to one thread's Claude Code session.
    input: z
      .object({
        limit: z.number().int().min(1).max(100),
        unit: z.number().int().positive(),
        project: z.string().optional(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ready"),
        unit: finiteNumber,
        threads: z.array(threadsTimelineEntrySchema),
        agentLabels: threadsTimelineAgentLabelsSchema,
      }),
      z.object({ status: z.literal("error"), message: z.string() }),
    ]),
  },
  // See memory/decisions/token-usage-viz-settings-persist-kv.md: the two
  // pages' visualization settings (geometry, colours, sort, detail toggles)
  // persist across sessions in bb.storage.kv, not localStorage — kv is only
  // reachable from the server side of the plugin, hence these two RPCs.
  loadVizSettings: {
    input: z.object({}).strict().default({}),
    // Always a full, valid VizSettings — never an error status. A missing
    // or corrupt kv blob (first run, stale shape, hand-edited junk) falls
    // back to defaults inside the handler rather than failing the page; see
    // parseVizSettings's own doc comment for why that's safe to do silently.
    output: vizSettingsSchema,
  },
  saveVizSettings: {
    // The client always sends a complete VizSettings (see
    // pages'-side save call) — the schema itself is the validation, no
    // hand-rolled checks needed in the handler.
    input: vizSettingsSchema,
    output: z.object({ ok: z.literal(true) }),
  },
});

/**
 * Session totals + per-agent breakdown, mapped from tools/tokens.py's report
 * shape to the RPC output shape shared by sessionTokenUsage and agentTimeline
 * (both need the same session-wide numbers — one call site for the mapping
 * instead of two copies drifting apart).
 *
 * tokens.py already returns buckets sorted by descending total (and
 * truncated to --top) — re-sorting here would only ever reproduce that same
 * order, so the report's order is trusted as-is. Подпись считает только
 * formatBucketDisplay — не собирать её здесь заново, см.
 * memory/decisions/token-usage-one-caption-source.md.
 */
function mapSessionTotals(report: TokensReport) {
  const { totals } = report;
  const agents = report.buckets.map((bucket) => {
    const display = formatBucketDisplay(bucket);
    return {
      key: bucket.key,
      name: display.name,
      caption: display.caption,
      total: bucket.total,
      cost: bucket.cost,
    };
  });

  return {
    totals: {
      total: totals.total,
      input: totals.input,
      cacheWrite: cacheWriteTotal(totals),
      cacheRead: totals.cacheRead,
      output: totals.output,
      thinking: totals.thinking,
      cost: totals.cost,
      costs: totals.costs,
      messages: totals.messages,
    },
    agents,
  };
}

async function loadSessionTokenUsage(service: TokenUsageService, threadId: string) {
  // resolveSessionId / query call out to bb.sdk and a child process — both
  // can reject (thread deleted mid-request, daemon unreachable). Without
  // this catch, that exception would escape the rpc handler and the host
  // would turn it into an opaque transport failure instead of the app's
  // handled "error" status with readable text.
  try {
    const sessionId = await service.resolveSessionId(threadId);
    if (sessionId === null) {
      return { status: "no-session" as const };
    }

    const result = await service.query({ by: "agent", session: sessionId, top: AGENT_ROWS_LIMIT });
    if (!result.ok) {
      return { status: "error" as const, message: result.message };
    }

    const { totals, agents } = mapSessionTotals(result.data);

    return {
      status: "ready" as const,
      sessionId,
      totals,
      agents,
      truncated: result.data.truncated,
    };
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : "Не удалось получить данные о расходе токенов.",
    };
  }
}

async function loadAgentTimeline(
  service: TokenUsageService,
  agentTimelineService: AgentTimelineService,
  session: string,
  agent: string,
) {
  // Same reasoning as loadSessionTokenUsage's try/catch: the timeline runner
  // and the totals query both call out to a child process, and must never
  // let a rejection escape as an opaque transport failure. Run both in
  // parallel — the session's totals/agent-list and this one agent's events
  // are independent queries, no reason to serialize them.
  try {
    const [totalsResult, timelineResult] = await Promise.all([
      service.query({ by: "agent", session, top: AGENT_ROWS_LIMIT }),
      agentTimelineService.query({ session, agent }),
    ]);

    if (!totalsResult.ok) {
      return { status: "error" as const, message: totalsResult.message };
    }
    if (!timelineResult.ok) {
      return { status: "error" as const, message: timelineResult.message };
    }

    const { totals, agents } = mapSessionTotals(totalsResult.data);

    return {
      status: "ready" as const,
      totals,
      agents,
      agent: timelineResult.data.agent,
      events: timelineResult.data.events,
    };
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : "Не удалось получить хронологию агента.",
    };
  }
}

async function loadThreadsTimeline(
  threadsTimelineService: ThreadsTimelineService,
  params: { limit: number; unit: number; project?: string },
) {
  try {
    const result = await threadsTimelineService.query(params);
    if (!result.ok) {
      return { status: "error" as const, message: result.message };
    }

    return {
      status: "ready" as const,
      unit: result.data.unit,
      threads: result.data.threads,
      agentLabels: result.data.agentLabels,
    };
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : "Не удалось получить сводную ленту тредов.",
    };
  }
}

/**
 * kv.get can reject the same way the query pipeline can (host unreachable
 * mid-request) — caught here rather than left to escape as an opaque
 * transport failure, same reasoning as loadSessionTokenUsage's try/catch.
 * A missing key (`undefined`, i.e. never saved) and outright corrupt JSON
 * both fall through parseVizSettings's own fallback to defaults; only a
 * thrown rejection needs handling at this layer.
 */
async function loadVizSettings(kv: PluginKvStorage) {
  try {
    const raw = await kv.get<unknown>(VIZ_SETTINGS_KV_KEY);
    return parseVizSettings(raw);
  } catch {
    return parseVizSettings(undefined);
  }
}

/**
 * The input schema (vizSettingsSchema) already validated the value before
 * this handler runs, so there's nothing left to check here — only the kv
 * write itself can fail (host unreachable), caught so it surfaces as a
 * normal RPC rejection with a readable message instead of an opaque one.
 */
async function saveVizSettings(kv: PluginKvStorage, value: VizSettings) {
  try {
    await kv.set(VIZ_SETTINGS_KV_KEY, value);
    return { ok: true as const };
  } catch (err) {
    throw err instanceof Error ? err : new Error("Не удалось сохранить настройки визуализации.");
  }
}

/** Injection seam for tests: `createFakePluginHost` + stubbed services, no real bb.sdk/python needed. */
export interface PluginDeps {
  service?: TokenUsageService;
  agentTimelineService?: AgentTimelineService;
  threadsTimelineService?: ThreadsTimelineService;
  /** Defaults to `bb.storage.kv` — overridable so tests can point viz-settings persistence at their own in-memory kv instead of the fake host's real one. */
  kv?: PluginKvStorage;
}

export default function plugin(bb: BbPluginApi, deps: PluginDeps = {}) {
  const service = deps.service ?? createTokenUsageService(bb);
  const agentTimelineService = deps.agentTimelineService ?? createAgentTimelineService(bb);
  const threadsTimelineService = deps.threadsTimelineService ?? createThreadsTimelineService(bb);
  const kv = deps.kv ?? bb.storage.kv;

  bb.rpc.register(rpcContract, {
    sessionTokenUsage: ({ threadId }) => loadSessionTokenUsage(service, threadId),
    agentTimeline: ({ session, agent }) => loadAgentTimeline(service, agentTimelineService, session, agent),
    threadsTimeline: (params) => loadThreadsTimeline(threadsTimelineService, params),
    loadVizSettings: () => loadVizSettings(kv),
    saveVizSettings: (value) => saveVizSettings(kv, value),
  });
}
