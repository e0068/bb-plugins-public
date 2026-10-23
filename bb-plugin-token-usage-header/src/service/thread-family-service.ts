// Reads a thread's family — itself and every thread it spawned — for the
// session page: each member's usage and chart, and the sum over all of them.
// Who belongs to the family is src/core/thread-family.ts's call; this module
// lists the threads, finds each one's session and reads its numbers through
// the two existing services, so a member costs exactly what the same thread
// costs on its own page.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { familyOf, sumTotals, usageTotalsOf, type ThreadEntry, type ThreadNode, type UsageTotals } from "../core";
import { mapWithLimit } from "./map-with-limit";
import type { ThreadsTimelineService } from "./threads-timeline-service";
import type { TokenUsageService } from "./token-usage-service";
import type { QueryOptions } from "./types";

/**
 * Most threads of one family read at once: every member is two counting runs
 * (usage and chart), and a workflow's agent threads can number in the dozens.
 * The rest is dropped and the answer says so (`truncated`).
 */
export const MAX_FAMILY_MEMBERS = 40;

/** How many members are read at the same time — each one starts a child process. */
const FAMILY_LOOKUP_CONCURRENCY = 4;

/** How many of bb's most recent threads are searched for the family's members; the same window the threads feed scans. */
const THREADS_SCAN_LIMIT = 1000;

/** One thread of the family with the numbers of its current Claude Code session. */
export interface FamilyMember {
  threadId: string;
  title: string | null;
  sessionId: string;
  totals: UsageTotals;
  /** The thread's own chart; null when only the chart could not be built — its usage still counts. */
  chart: { thread: ThreadEntry; agentLabels: Record<string, string> } | null;
}

export interface ThreadFamily {
  /** The thread first, then its descendants; empty for a thread that started nothing. */
  members: FamilyMember[];
  /** Usage of all members added up; zeros when there are none. */
  total: UsageTotals;
  /** True when the family had more threads than MAX_FAMILY_MEMBERS and the rest is not counted. */
  truncated: boolean;
  /** Threads whose usage could not be read — not in `members` and not in `total`. A thread with no session yet is not one of them. */
  unreadable: number;
}

export interface ThreadFamilyParams {
  threadId: string;
  /** Chart bin width in seconds. */
  unit: number;
  groupWorkflows: boolean;
}

export interface ThreadFamilyService {
  /** Rejects when bb cannot list the threads; a single member that fails only counts as `unreadable`. */
  query(params: ThreadFamilyParams, options?: QueryOptions): Promise<ThreadFamily>;
}

export interface ThreadFamilyServiceDeps {
  tokenUsage: TokenUsageService;
  threadsTimeline: ThreadsTimelineService;
}

/** What reading one member came to: its numbers, no session yet, or a failure. */
type MemberRead = { kind: "member"; member: FamilyMember } | { kind: "no-session" } | { kind: "unreadable" };

const NOTHING: ThreadFamily = { members: [], total: sumTotals([]), truncated: false, unreadable: 0 };

export function createThreadFamilyService(bb: BbPluginApi, { tokenUsage, threadsTimeline }: ThreadFamilyServiceDeps): ThreadFamilyService {
  async function readMember(node: ThreadNode, { unit, groupWorkflows }: ThreadFamilyParams, options: QueryOptions): Promise<MemberRead> {
    try {
      const sessionId = await tokenUsage.resolveSessionId(node.id);
      if (sessionId === null) return { kind: "no-session" };
      const [usage, timeline] = await Promise.all([
        tokenUsage.query({ by: "session", session: sessionId }, options),
        threadsTimeline.query({ unit, limit: 1, session: sessionId, groupWorkflows }, options),
      ]);
      if (!usage.ok) return { kind: "unreadable" };
      const thread = timeline.ok ? timeline.data.threads[0] : undefined;
      return {
        kind: "member",
        member: {
          threadId: node.id,
          title: node.title,
          sessionId,
          totals: usageTotalsOf(usage.data.totals),
          chart: thread === undefined || !timeline.ok ? null : { thread, agentLabels: timeline.data.agentLabels },
        },
      };
    } catch {
      return { kind: "unreadable" };
    }
  }

  return {
    async query(params, options) {
      // Hidden threads included: a workflow's agent threads are hidden from
      // the sidebar, but they spent tokens under their parent all the same.
      const listed = await bb.sdk.threads.list({ limit: THREADS_SCAN_LIMIT, includeHidden: true });
      const family = familyOf(
        params.threadId,
        listed.map((thread) => ({ id: thread.id, parentThreadId: thread.parentThreadId, title: thread.title ?? thread.titleFallback ?? null })),
      );
      if (family.length === 1) return NOTHING;

      const queryOptions: QueryOptions = { fresh: options?.fresh };
      const reads = await mapWithLimit(family.slice(0, MAX_FAMILY_MEMBERS), FAMILY_LOOKUP_CONCURRENCY, (node) => readMember(node, params, queryOptions));
      const members = reads.flatMap((read) => (read.kind === "member" ? [read.member] : []));
      return {
        members,
        total: sumTotals(members.map((member) => member.totals)),
        truncated: family.length > MAX_FAMILY_MEMBERS,
        unreadable: reads.filter((read) => read.kind === "unreadable").length,
      };
    },
  };
}
