// Pure routing decision for opening a file, based on two independent
// settings (memory/decisions/claude-config-opener-two-axes.md — supersedes
// claude-config-opener-setting.md's single three-way enum):
//   - fileOpenerLocation: "inline" (the panel's own column) vs. "host" (bb's
//     host tab). Separated from app.tsx so it can be tested without jsdom
//     and the SDK.
//   - fileOpenerRenderer: "md-opener" (Kasimov) vs. "builtin" (the older
//     column renderer). Only meaningful when location is "inline" — bb's
//     host tab always renders its own generic preview and has no parameter
//     to request a specific registered fileOpener plugin (checked against
//     ExperimentalFileOpenOptions in @get-bb/plugin-sdk/app).

import { opensInEditMode as opensInEditModeCore } from "../packages/md-doc-view/open-mode";

export type FileOpenerLocation = "inline" | "host";
export type FileOpenerRenderer = "md-opener" | "builtin";

export const DEFAULT_FILE_OPENER_LOCATION: FileOpenerLocation = "inline";
export const DEFAULT_FILE_OPENER_RENDERER: FileOpenerRenderer = "md-opener";

// Normalizes the location setting (may come in as undefined or some
// unrelated string), falling back to the default.
export function normalizeOpenerLocation(value: unknown): FileOpenerLocation {
  return value === "inline" || value === "host" ? value : DEFAULT_FILE_OPENER_LOCATION;
}

// Normalizes the renderer setting, falling back to the default.
export function normalizeOpenerRenderer(value: unknown): FileOpenerRenderer {
  return value === "md-opener" || value === "builtin" ? value : DEFAULT_FILE_OPENER_RENDERER;
}

// true — the file goes to bb's host tab; false — to the panel's built-in
// column (both the Kasimov and builtin renderers open in the column). Takes
// an already-normalized location, not `unknown`: callers hold a raw setting
// value for a few lines at most (readOpenerSettings normalizes it right
// away), and a wider parameter would silently accept a renderer value too.
export function isHostOpen(location: FileOpenerLocation): boolean {
  return location === "host";
}

const LOCATION_KEY = "fileOpenerLocation";
const RENDERER_KEY = "fileOpenerRenderer";

// The one declaration of both settings' keys: server.ts spreads this into
// bb.settings.define, app.tsx reads values through readOpenerSettings below —
// neither hand-writes the key strings, so a rename can't drift the two apart.
export const OPENER_DESCRIPTORS = {
  [LOCATION_KEY]: {
    type: "select" as const,
    label: "Where to open files",
    options: ["inline", "host"],
    default: DEFAULT_FILE_OPENER_LOCATION,
  },
  [RENDERER_KEY]: {
    type: "select" as const,
    label: "What to open files with",
    options: ["md-opener", "builtin"],
    default: DEFAULT_FILE_OPENER_RENDERER,
  },
};

export function readOpenerSettings(values: Record<string, unknown> | undefined): {
  location: FileOpenerLocation;
  renderer: FileOpenerRenderer;
} {
  return {
    location: normalizeOpenerLocation(values?.[LOCATION_KEY]),
    renderer: normalizeOpenerRenderer(values?.[RENDERER_KEY]),
  };
}

/**
 * Whether a freshly loaded document opens ready to edit, per the
 * "open documents in edit mode" setting (docStartInEdit) — for the panel's
 * OLDER column. The rule itself is the shared one MdDocView uses for the
 * Kasimov column (imported from the module directly, not through the
 * package's barrel, which would drag React and CSS in): a setting must not
 * mean one thing in one renderer and another in the other.
 *
 * What this layer adds is the one dimension the shared package knows nothing
 * about: `composite` — a view the server assembled (a connector), which has
 * no single file behind it to write back to.
 */
export function opensInEditMode(
  startInEdit: boolean,
  doc: { content: string | null; error?: string | null },
  composite: boolean,
): boolean {
  return !composite && opensInEditModeCore(startInEdit, doc);
}
