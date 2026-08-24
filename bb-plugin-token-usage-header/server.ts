// bb-plugin-token-usage-header — backend entry.
//
// Exposes one RPC method, `sessionTokenUsage`, that the header control
// (app.tsx) polls for a thread's Claude Code token usage: session totals,
// broken down by kind, plus one row per agent invocation (main agent +
// every subagent call), sorted by spend.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { cacheWriteTotal, formatBucketDisplay } from "./src/core";
import { createTokenUsageService, type TokenUsageService } from "./src/service";

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

export const rpcContract = defineRpcContract({
  sessionTokenUsage: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("ready"),
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
});

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

    const { totals } = result.data;
    // tokens.py already returns buckets sorted by descending total (and
    // truncated to --top) — re-sorting here would only ever reproduce that
    // same order, so the report's order is trusted as-is.
    //
    // Подпись считает только formatBucketDisplay — не собирать её здесь
    // заново, см. memory/decisions/token-usage-one-caption-source.md.
    const agents = result.data.buckets.map((bucket) => {
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
      status: "ready" as const,
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
      truncated: result.data.truncated,
    };
  } catch (err) {
    return {
      status: "error" as const,
      message: err instanceof Error ? err.message : "Не удалось получить данные о расходе токенов.",
    };
  }
}

/** Injection seam for tests: `createFakePluginHost` + a stubbed service, no real bb.sdk/python needed. */
export interface PluginDeps {
  service?: TokenUsageService;
}

export default function plugin(bb: BbPluginApi, deps: PluginDeps = {}) {
  const service = deps.service ?? createTokenUsageService(bb);

  bb.rpc.register(rpcContract, {
    sessionTokenUsage: ({ threadId }) => loadSessionTokenUsage(service, threadId),
  });
}
