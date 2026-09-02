// Pure routing decision for opening a file, based on the `fileOpener`
// setting. Separated from app.tsx so it can be tested without jsdom and the
// SDK: it's only the choice between "host tab vs. built-in column". Which
// editor renders inside the column (Kasimov or the standard one) is already
// DocTab's concern, not decided here.

export type FileOpener = "md-opener" | "builtin" | "host";

export const DEFAULT_FILE_OPENER: FileOpener = "md-opener";

// Normalizes the setting value (may come in as undefined or some unrelated
// string) to one of the three modes, falling back to the default.
export function normalizeOpener(value: unknown): FileOpener {
  return value === "md-opener" || value === "builtin" || value === "host"
    ? value
    : DEFAULT_FILE_OPENER;
}

// true — the file goes to bb's host tab; false — to the panel's built-in
// column (both the Kasimov and builtin modes open in the column).
export function isHostOpen(setting: unknown): boolean {
  return normalizeOpener(setting) === "host";
}
