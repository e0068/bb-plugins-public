// Layer 1 — the panel's place, written as an address. Pure: two functions,
// `panelRoute` out and `parsePanelRoute` back, and nothing else knows the
// grammar.
//
// Everything about where the panel is lives here — the area, the section, and
// what's open in the third column — so the place has ONE carrier (`subPath`)
// and every place is a link you can hand to someone. Segments are tagged
// (`a/` area, `s/` section) so "no section picked" is the absence of a pair
// rather than a placeholder segment: a memory file is opened from the rail
// and belongs to no section (memory/decisions/panel-route-grammar.md).
//
// The area is NOT repeated inside the open target: it is already the first
// segment, so "the open file belongs to another area" is not a state this
// type can hold.

import { isSectionId, type SectionId } from "./panel-sections";
import type { StoreKind } from "./workflow/store";

export type ConnectorOrigin = "mcpjson" | "user" | "local";
export type HookOrigin = "user" | "project" | "local";

const CONNECTOR_ORIGINS = ["mcpjson", "user", "local"] as const;
const HOOK_ORIGINS = ["user", "project", "local"] as const;
const STORES = ["project", "global"] as const;

/** What the third column shows. One variant per thing the panel can open. */
export type OpenTarget =
  | { kind: "skill"; name: string }
  | { kind: "connector"; origin: ConnectorOrigin; name: string }
  | { kind: "hook"; origin: HookOrigin; index: number; event: string }
  | { kind: "doc"; path: string }
  | { kind: "workflow"; store: StoreKind; name: string };

/**
 * What the document column can show — everything except a workflow, which
 * has its own builder rather than a document view.
 */
export type DocTarget = Exclude<OpenTarget, { kind: "workflow" }>;

/** The workflow the address names — the builder's half of the same sum. */
export type WorkflowTarget = Extract<OpenTarget, { kind: "workflow" }>;

export interface PanelPlace {
  areaId: string;
  /** null — no section picked: the empty state, or a memory file. */
  section: SectionId | null;
  /** null — nothing open in the third column. */
  open: OpenTarget | null;
}

export const DEFAULT_PLACE: PanelPlace = {
  areaId: "global",
  section: null,
  open: null,
};

// Names and paths go through base64url: a file path's slashes would
// otherwise be read as segment separators. Skill and workflow names can't
// contain a slash (both are file or directory names within one flat store),
// so they stay legible in the address.
//
// Base64 is applied to UTF-8 BYTES, not to code points: `btoa` throws on any
// character above U+00FF, and paths come from the file system — a memory file
// named in Russian would have thrown out of a click handler. On ASCII the two
// encodings agree byte for byte, so addresses written before this still read.
function encodePath(path: string): string {
  const bytes = new TextEncoder().encode(path);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decodePath(encoded: string): string | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    // Not base64, or base64 of bytes that aren't UTF-8 — an address someone
    // typed, or one from a build that encoded differently. `fatal` is what
    // makes the second case an error instead of a path of replacement
    // characters that would then be sent to the server as a real one.
    return null;
  }
}

function openSegments(open: OpenTarget): string[] {
  switch (open.kind) {
    case "skill":
      return ["skill", open.name];
    case "connector":
      return ["connector", open.origin, encodePath(open.name)];
    case "hook":
      return ["hook", open.origin, String(open.index), encodePath(open.event)];
    case "doc":
      return ["doc", encodePath(open.path)];
    case "workflow":
      return ["wf", open.store, open.name];
  }
}

/**
 * Stable identity of what's open: equal keys mean the same thing is open.
 * A place has this on hand as a string, so an effect that reloads when the
 * open file changes depends on it rather than on the target object, which is
 * new on every render.
 */
export function openKey(open: OpenTarget | null): string {
  return open === null ? "" : openSegments(open).join("/");
}

/** The address of a place. The default place has no address at all. */
export function panelRoute(place: PanelPlace): string {
  if (place.areaId === DEFAULT_PLACE.areaId && place.section === null && place.open === null) {
    return "";
  }
  return [
    "a",
    place.areaId,
    ...(place.section === null ? [] : ["s", place.section]),
    ...(place.open === null ? [] : openSegments(place.open)),
  ].join("/");
}

const isOneOf = <T extends string>(set: readonly T[], value: string): value is T =>
  (set as readonly string[]).includes(value);

/** A list position: whole, not negative, and not a stray "NaN" from Number(). */
function parseIndex(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function parseOpen(seg: string[]): OpenTarget | null {
  const [tag, ...rest] = seg;
  if (tag === "skill" && rest[0]) {
    return { kind: "skill", name: rest[0] };
  }
  if (tag === "connector" && rest[0] && rest[1] && isOneOf(CONNECTOR_ORIGINS, rest[0])) {
    const name = decodePath(rest[1]);
    return name === null ? null : { kind: "connector", origin: rest[0], name };
  }
  if (tag === "hook" && rest[0] && rest[1] && rest[2] && isOneOf(HOOK_ORIGINS, rest[0])) {
    const index = parseIndex(rest[1]);
    const event = decodePath(rest[2]);
    return index === null || event === null
      ? null
      : { kind: "hook", origin: rest[0], index, event };
  }
  if (tag === "doc" && rest[0]) {
    const path = decodePath(rest[0]);
    return path === null ? null : { kind: "doc", path };
  }
  if (tag === "wf" && rest[0] && rest[1] && isOneOf(STORES, rest[0])) {
    return { kind: "workflow", store: rest[0], name: rest[1] };
  }
  return null;
}

/**
 * Reads an address back. Total, and repairs rather than refuses: an address
 * comes from a browser profile that outlives builds and from links people
 * keep, so a section that no longer exists or a tail that names nothing
 * openable costs only that part of the place — the area still stands.
 */
export function parsePanelRoute(subPath: string): PanelPlace {
  const seg = subPath.split("/").filter(Boolean);
  if (seg[0] !== "a" || !seg[1]) return DEFAULT_PLACE;
  const areaId = seg[1];
  const hasSection = seg[2] === "s" && seg[3] !== undefined;
  const rest = seg.slice(hasSection ? 4 : 2);
  return {
    areaId,
    section: hasSection && isSectionId(seg[3]) ? seg[3] : null,
    open: rest.length === 0 ? null : parseOpen(rest),
  };
}
