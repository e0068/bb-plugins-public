// Layer 1 (core) — a dev-only tool for pushing a notification toast into the
// live plugin frontend, so any tone/title/details/link/threadLink can be
// eyeballed on demand without reproducing the real event.
//
// The `bb pr-toast` CLI command (server.ts) parses argv here and publishes the
// result on PREVIEW_TOAST_CHANNEL; the listener (src/ui/preview-toast-listener)
// validates the incoming payload with asPreviewToast and shows it. Both sides
// are pure and tested here; the effectful halves are three lines each.
import type { Notification, NotificationTone } from "./notification";

/** The one realtime channel the publisher (CLI) and subscriber (frontend) share. */
export const PREVIEW_TOAST_CHANNEL = "preview-toast";

const TONES: readonly NotificationTone[] = ["success", "warning", "error"];

const isTone = (value: unknown): value is NotificationTone =>
  typeof value === "string" && (TONES as readonly string[]).includes(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Validate an arbitrary value (a realtime payload, or a parsed --json blob)
 * into a Notification, or null if it is not one. `details` defaults to []; the
 * optional `link`/`threadLink` are kept only when whole. `prompt` is not
 * accepted — it drives the repoint confirmation, not a general toast.
 */
export function asPreviewToast(value: unknown): Notification | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isTone(v.tone)) return null;
  if (typeof v.title !== "string" || v.title === "") return null;
  const details = v.details === undefined ? [] : v.details;
  if (!isStringArray(details)) return null;

  const link = v.link ?? null;
  if (link !== null) {
    if (typeof link !== "object") return null;
    const l = link as Record<string, unknown>;
    if (typeof l.label !== "string" || typeof l.url !== "string") return null;
  }

  const toast: Notification = { tone: v.tone, title: v.title, details: [...details], link: link as Notification["link"] };

  if (v.threadLink !== undefined) {
    if (typeof v.threadLink !== "object" || v.threadLink === null) return null;
    const t = v.threadLink as Record<string, unknown>;
    if (typeof t.label !== "string" || typeof t.threadId !== "string") return null;
    return { ...toast, threadLink: { label: t.label, threadId: t.threadId } };
  }
  return toast;
}

export type ParseResult =
  | { readonly ok: true; readonly toast: Notification }
  | { readonly ok: false; readonly error: string };

/** Collect `--flag value` pairs and repeated flags into a map of string lists. */
function readFlags(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "";
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return flags;
}

const first = (flags: Map<string, string[]>, key: string): string | undefined => flags.get(key)?.at(-1);

/**
 * Parse the `bb pr-toast` argv into a Notification. Two forms: `--json <blob>`
 * for a whole Notification at once, or the flags `--tone --title --detail
 * (repeatable) --link-label --link-url --thread-label --thread-id`. A link or
 * threadLink must be whole (both halves) or absent.
 */
export function parsePreviewToastArgv(argv: readonly string[]): ParseResult {
  const flags = readFlags(argv);

  const json = first(flags, "json");
  if (json !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: "--json is not valid JSON" };
    }
    const toast = asPreviewToast(parsed);
    return toast ? { ok: true, toast } : { ok: false, error: "--json is not a valid toast (need tone + title)" };
  }

  const tone = first(flags, "tone");
  if (!isTone(tone)) return { ok: false, error: `--tone must be one of ${TONES.join(", ")}` };
  const title = first(flags, "title");
  if (title === undefined || title === "") return { ok: false, error: "--title is required" };

  const details = (flags.get("detail") ?? []).filter((line) => line !== "");

  const linkLabel = first(flags, "link-label");
  const linkUrl = first(flags, "link-url");
  if ((linkLabel === undefined) !== (linkUrl === undefined)) {
    return { ok: false, error: "--link-label and --link-url must be given together" };
  }
  const link = linkLabel !== undefined && linkUrl !== undefined ? { label: linkLabel, url: linkUrl } : null;

  const threadLabel = first(flags, "thread-label");
  const threadId = first(flags, "thread-id");
  if ((threadLabel === undefined) !== (threadId === undefined)) {
    return { ok: false, error: "--thread-label and --thread-id must be given together" };
  }

  const base: Notification = { tone, title, details, link };
  return {
    ok: true,
    toast:
      threadLabel !== undefined && threadId !== undefined
        ? { ...base, threadLink: { label: threadLabel, threadId } }
        : base,
  };
}
