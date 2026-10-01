import type { TaskLayout } from "../shared/enums.js";

/**
 * Client-local table/board choice, one per screen. Stored in the browser
 * profile so one client does not rewrite another client connected to the
 * same bb server — the same boundary as the sidebar and list preferences.
 *
 * A screen's key is `all`, `active`, `waiting`, `project:<id>` or
 * `view:<id>`; each key remembers its own layout independently — there is
 * no cross-screen fallback. A route without an explicit `?view=` resolves
 * through here, so reopening a screen restores the layout last picked for
 * it; a screen never opened before opens as a table.
 */
export const VIEW_PREFERENCE_STORAGE_KEY = "bb-tasks:view-preferences";
export const VIEW_PREFERENCE_VERSION = 1 as const;

const PROJECT_KEY_PREFIX = "project:";
const DEFAULT_LAYOUT: TaskLayout = "table";

interface StoredDocumentV1 {
  version: typeof VIEW_PREFERENCE_VERSION;
  layouts: Record<string, TaskLayout>;
}

/** Reads a layout value, reading a document written before boards had views' "list" as "table". */
function asLayout(value: unknown): TaskLayout | null {
  if (value === "table" || value === "board") return value;
  return value === "list" ? "table" : null;
}

interface ParsedStorage {
  layouts: Record<string, unknown>;
  /** The per-project map from before each screen had its own key. */
  legacyProjects: Record<string, unknown>;
  /** True when the document was written by a newer client. */
  isFutureVersion: boolean;
}

function readStorage(): ParsedStorage | null {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const version =
      typeof record.version === "number" && Number.isFinite(record.version)
        ? record.version
        : null;
    // No older versions shipped; refuse rather than invent fields.
    if (version !== null && version < VIEW_PREFERENCE_VERSION) return null;
    const layouts =
      record.layouts !== null &&
      typeof record.layouts === "object" &&
      !Array.isArray(record.layouts)
        ? (record.layouts as Record<string, unknown>)
        : {};
    const legacyProjects =
      record.projects !== null &&
      typeof record.projects === "object" &&
      !Array.isArray(record.projects)
        ? (record.projects as Record<string, unknown>)
        : {};
    return {
      layouts,
      legacyProjects,
      isFutureVersion: version !== null && version > VIEW_PREFERENCE_VERSION,
    };
  } catch {
    return null;
  }
}

/** A screen's or a view's layout, or null when this client never recorded one. */
export function loadStoredLayout(key: string): TaskLayout | null {
  const document = readStorage();
  if (document === null) return null;
  const stored = asLayout(document.layouts[key]);
  if (stored !== null || !key.startsWith(PROJECT_KEY_PREFIX)) return stored;
  return asLayout(document.legacyProjects[key.slice(PROJECT_KEY_PREFIX.length)]);
}

/** A screen's or a view's layout; a table where nothing was chosen. */
export function loadLayout(key: string): TaskLayout {
  return loadStoredLayout(key) ?? DEFAULT_LAYOUT;
}

/**
 * Persist a screen's layout. Refuses to overwrite storage written by a newer
 * client so older builds cannot down-convert a future document.
 */
export function storeLayout(key: string, layout: TaskLayout): void {
  try {
    const existing = readStorage();
    if (existing?.isFutureVersion) return;
    // Order matters: a legacy per-project choice carries over only where the
    // new format hasn't already recorded that screen, and the key being
    // written now always wins over both.
    const legacyEntries = Object.entries(existing?.legacyProjects ?? {}).flatMap(
      ([id, value]) => {
        const mode = asLayout(value);
        return mode === null ? [] : [[`${PROJECT_KEY_PREFIX}${id}`, mode] as const];
      },
    );
    const currentEntries = Object.entries(existing?.layouts ?? {}).flatMap(
      ([id, value]) => {
        const mode = asLayout(value);
        return mode === null ? [] : [[id, mode] as const];
      },
    );
    const layouts: Record<string, TaskLayout> = {
      ...Object.fromEntries(legacyEntries),
      ...Object.fromEntries(currentEntries),
      [key]: layout,
    };
    const document: StoredDocumentV1 = {
      version: VIEW_PREFERENCE_VERSION,
      layouts,
    };
    window.localStorage.setItem(
      VIEW_PREFERENCE_STORAGE_KEY,
      JSON.stringify(document),
    );
  } catch {
    // Persistence is best-effort (private mode / storage disabled).
  }
}
