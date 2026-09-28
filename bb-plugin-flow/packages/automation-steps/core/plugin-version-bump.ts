// Layer 1 — which plugin/package a changed path belongs to, and how a
// package.json's "version" field grows: `bumpBy` raises whichever component
// the chain's step named (major, minor or patch). Значение версии здесь
// только считается и записывается — какой ей быть, решает план
// merge-time-бампа (core/merge-time-bump.ts). Zero effects.

const PLUGIN_ROOT = /^(bb-plugin-[^/]+)\//;
const PACKAGE_ROOT = /^(packages\/[^/]+)\//;

/**
 * The plugin/package root a changed file's path belongs to, or null when the
 * path is outside any (e.g. docs/, scripts/, a repo-root file).
 */
export function pluginRootOf(path: string): string | null {
  return PLUGIN_ROOT.exec(path)?.[1] ?? PACKAGE_ROOT.exec(path)?.[1] ?? null;
}

/** The distinct plugin/package roots touched by a diff, sorted for a stable order. */
export function affectedPluginRoots(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const root = pluginRootOf(path);
    if (root) roots.add(root);
  }
  return [...roots].sort();
}

/**
 * Which component a bump raises. The automation step a user puts in the
 * chain (files.bump-major/minor/patch) is the only thing that names it; with
 * no such step the chain keeps the historical "patch".
 */
export type BumpLevel = "major" | "minor" | "patch";

/**
 * Raises one component of a plain semver and zeroes everything below it —
 * the arithmetic the three bump steps differ by, and nothing else. Total
 * over its (already-parsed) input; the answer is always strictly greater
 * than the input.
 */
export function bumpBy(major: number, minor: number, patch: number, level: BumpLevel): string {
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Writes an explicit version into a package.json's top-level "version",
 * leaving the rest of the text byte-for-byte. Значение сюда приходит готовым —
 * какой версии быть, решает план merge-time-бампа (см. merge-time-bump.ts), —
 * поэтому существующее значение не обязано быть простым `x.y.z`. Returns null
 * when the text is not JSON or carries no top-level "version" string.
 */
export function setPackageJsonVersion(
  content: string,
  to: string,
): { content: string; from: string; to: string } | null {
  const from = topLevelVersion(content);
  if (from === null) return null;
  if (from === to) return { content, from, to };

  const pattern = new RegExp(`("version"\\s*:\\s*")${escapeForRegExp(from)}(")`);
  if (!pattern.test(content)) return null;
  const next = content.replace(pattern, `$1${to}$2`);

  // The literal being rewritten is the value JSON.parse said is top-level,
  // but `replace` still targets whichever occurrence of that literal comes
  // first in the text — if an unrelated nested field happens to carry the
  // exact same value ahead of the real one, that's the one that would move.
  // Re-parsing confirms the top-level field actually landed on `to` before
  // this is trusted as a result.
  if (topLevelVersion(next) !== to) return null;
  return { content: next, from, to };
}

/** The package.json's own top-level "version", or null when the text is not JSON or has no string there. */
export function topLevelVersion(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object") return null;
    const version = (parsed as Record<string, unknown>).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sets a package-lock.json's version to `to` — not an independent patch
 * bump: npm requires the lockfile's version to equal package.json's, so it
 * must track whatever `to` the sibling package.json bump already landed on,
 * even when the lockfile's own prior value had already drifted from it.
 *
 * lockfileVersion 2/3 duplicates the version at `packages[""].version`
 * alongside the top-level one; lockfileVersion 1 has only the top-level
 * field. Both are set when present. Unlike `setPackageJsonVersion`, this
 * rewrites via parse → patch → re-stringify rather than a targeted literal
 * replace: the same value appears in at least two places here by design (not
 * as an accidental collision), so there's no single "first occurrence" a
 * literal replace could target unambiguously. A lockfile is a generated
 * file with no hand-authored formatting to preserve, so re-stringifying with
 * npm's own `JSON.stringify(_, null, 2)` convention is safe.
 */
export function bumpPackageLockVersion(content: string, to: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const lock = parsed as Record<string, unknown>;
  if (typeof lock.version !== "string") return null;

  const next: Record<string, unknown> = { ...lock, version: to };
  const packages = lock.packages;
  const rootEntry =
    packages !== null && typeof packages === "object"
      ? (packages as Record<string, unknown>)[""]
      : undefined;
  if (rootEntry !== null && typeof rootEntry === "object") {
    next.packages = {
      ...(packages as Record<string, unknown>),
      "": { ...(rootEntry as Record<string, unknown>), version: to },
    };
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}
