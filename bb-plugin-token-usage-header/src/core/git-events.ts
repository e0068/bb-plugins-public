// Git activity markers shown on the token-usage chart (commit/push/pull
// request/merge) — types, the zod schema shared verbatim by
// src/core/threads-timeline.ts, src/core/agent-timeline.ts and server.ts (no
// mirror-then-`satisfies` duplication: those three all live in this same
// codebase, edited by the same hand, so there's no reason to keep two copies
// of the shape in sync by convention instead of by import), plus pure
// formatting/parsing helpers. No I/O — the live git/gh calls that produce
// commit/merge events live in src/service/threads-timeline-service.ts and
// src/service/agent-timeline-service.ts; this module only shapes their result.
import { z } from "zod";

const commitEventSchema = z
  .object({
    type: z.literal("commit"),
    ts: z.string(),
    hash: z.string(),
    message: z.string(),
    /** GitHub commit URL, or null when the thread's repo slug couldn't be resolved (no PR event and no readable git remote). */
    url: z.string().nullable(),
  })
  .strict();

const pushEventSchema = z
  .object({
    type: z.literal("push"),
    ts: z.string(),
    /** Target branch, when the transcript's own gitBranch context was available at push time. */
    branch: z.string().nullable(),
    /** GitHub branch tree URL, or null — same resolution (and same possible failure) as a commit's url. */
    url: z.string().nullable(),
  })
  .strict();

const prEventSchema = z
  .object({
    type: z.literal("pr"),
    ts: z.string(),
    number: z.number().int(),
    url: z.string(),
    repository: z.string(),
  })
  .strict();

const mergeEventSchema = z
  .object({
    type: z.literal("merge"),
    ts: z.string(),
    number: z.number().int(),
    url: z.string(),
    repository: z.string(),
  })
  .strict();

export const gitEventSchema = z.discriminatedUnion("type", [commitEventSchema, pushEventSchema, prEventSchema, mergeEventSchema]);

export type GitEvent = z.infer<typeof gitEventSchema>;
export type CommitEvent = z.infer<typeof commitEventSchema>;
export type PushEvent = z.infer<typeof pushEventSchema>;
export type PrEvent = z.infer<typeof prEventSchema>;
export type MergeEvent = z.infer<typeof mergeEventSchema>;

// SSH scp-like form: git@github.com:owner/repo(.git)
const SSH_SCP_REMOTE_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/;
// https:// or ssh:// form, with or without an embedded git@ user: (https|ssh)://[git@]github.com/owner/repo(.git)
const URL_REMOTE_RE = /^(?:https?|ssh):\/\/(?:git@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/;

/**
 * Parses a `git remote get-url origin` value into GitHub's "owner/repo" slug,
 * or null for anything that isn't a github.com remote (a non-GitHub host, or
 * a malformed/empty string). Pure — the caller (threads-timeline-service.ts)
 * owns actually running the command; this only makes sense of its output.
 */
export function githubRepoSlugFromRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const scp = SSH_SCP_REMOTE_RE.exec(trimmed);
  if (scp) return `${scp[1]}/${scp[2]}`;
  const url = URL_REMOTE_RE.exec(trimmed);
  if (url) return `${url[1]}/${url[2]}`;
  return null;
}

/** Short, human-recognizable form of a commit hash — GitHub's own convention. */
export function shortCommitHash(hash: string): string {
  return hash.slice(0, 7);
}

/**
 * One-line label for a git event, for the chart's hover tooltip. Doesn't
 * include the link — see `gitEventLinkUrl` — a label is shown even when the
 * event has no resolvable url (e.g. a push with an unknown repo slug).
 */
export function gitEventLabel(event: GitEvent): string {
  switch (event.type) {
    case "commit":
      return `${shortCommitHash(event.hash)} ${event.message}`;
    case "push":
      return event.branch ? `Push → ${event.branch}` : "Push";
    case "pr":
      return `PR #${event.number} opened`;
    case "merge":
      return `PR #${event.number} merged`;
  }
}

/** The event's outbound link, or null when none could be resolved (see the schema's own field docs). */
export function gitEventLinkUrl(event: GitEvent): string | null {
  return event.url;
}
