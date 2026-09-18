// Layer 1 — which plugin/package a changed path belongs to, and how a
// package.json's "version" field grows: `bumpBy` raises whichever component
// the chain's step named (major, minor or patch), `bumpPatch` is that
// arithmetic for the level every chain used before the levels existed. Zero
// effects.

import { decodeBase64, encodeBase64 } from "./base64";
import type { ChangedFile } from "./github-requests";

const PLUGIN_ROOT = /^(bb-plugin-[^/]+)\//;
const PACKAGE_ROOT = /^(packages\/[^/]+)\//;

/**
 * The plugin/package root a changed file's path belongs to, or null when the
 * path is outside any (e.g. memory/, scripts/, a repo-root file).
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

/** Increments a plain semver's patch component; total over its (already-parsed) input. */
export function bumpPatch(major: number, minor: number, patch: number): string {
  return `${major}.${minor}.${patch + 1}`;
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
      return bumpPatch(major, minor, patch);
  }
}

const PLAIN_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Bumps the patch component of a package.json's top-level "version" field.
 * The field is found by parsing the JSON — not by pattern-matching a line —
 * so a same-named field nested deeper (e.g. a "bb": { "version": … } block,
 * or a dependency literally named "version") can never be picked up instead
 * of the real one. Once the top-level value is known, only that exact
 * literal is rewritten in the text, leaving everything else byte-for-byte.
 * Returns null when the content isn't valid JSON, has no top-level "version"
 * string, or that string isn't a plain `x.y.z` (e.g. a prerelease suffix).
 */
export function bumpPackageJsonVersion(
  content: string,
): { content: string; from: string; to: string } | null {
  const from = topLevelVersion(content);
  if (!from) return null;
  const parts = PLAIN_SEMVER.exec(from);
  if (!parts) return null;
  return setPackageJsonVersion(content, bumpPatch(Number(parts[1]), Number(parts[2]), Number(parts[3])));
}

/**
 * Writes an explicit version into a package.json's top-level "version",
 * leaving the rest of the text byte-for-byte. Unlike
 * {@link bumpPackageJsonVersion} it does not derive the value and does not
 * insist the existing one is a plain `x.y.z` — deciding what the version
 * should become is somebody else's job (see merge-time-bump.ts). Returns
 * null when the text is not JSON or carries no top-level "version" string.
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
 * Bumps one changed file's content if it's a plugin/package.json with a
 * plain-semver "version" field; a deletion, a non-JSON file, or a version
 * that doesn't parse is left alone (null). Decoding/encoding follows the
 * file's own declared encoding, so the result round-trips exactly like the
 * input.
 */
export function bumpChangedFileVersion(file: ChangedFile): ChangedFile | null {
  if (file.kind === "delete") return null;
  const text = file.encoding === "base64" ? decodeBase64(file.content) : file.content;
  const bump = bumpPackageJsonVersion(text);
  if (!bump) return null;
  return {
    kind: "upsert",
    path: file.path,
    content: file.encoding === "base64" ? encodeBase64(bump.content) : bump.content,
    encoding: file.encoding,
  };
}

/**
 * Bumps a changed package.json and reports the resulting version alongside
 * it — the wiring layer needs `to` to drive the matching package-lock.json
 * bump onto the exact same value, not an independent patch increment of
 * whatever the lockfile itself last said.
 */
export function bumpChangedFileVersionWithTarget(
  file: ChangedFile,
): { file: ChangedFile; to: string } | null {
  const bumped = bumpChangedFileVersion(file);
  if (!bumped || bumped.kind === "delete") return null;
  const text = bumped.encoding === "base64" ? decodeBase64(bumped.content) : bumped.content;
  const to = topLevelVersion(text);
  return to ? { file: bumped, to } : null;
}

/**
 * Sets a package-lock.json's version to `to` — not an independent patch
 * bump: npm requires the lockfile's version to equal package.json's, so it
 * must track whatever `to` the sibling package.json bump already landed on,
 * even when the lockfile's own prior value had already drifted from it.
 *
 * lockfileVersion 2/3 duplicates the version at `packages[""].version`
 * alongside the top-level one; lockfileVersion 1 has only the top-level
 * field. Both are set when present. Unlike `bumpPackageJsonVersion`, this
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

/**
 * Bumps one changed file's content if it's a package-lock.json — same
 * decode/encode round-trip as `bumpChangedFileVersion`, targeting `to`
 * instead of deriving its own increment.
 */
export function bumpChangedLockFileVersion(file: ChangedFile, to: string): ChangedFile | null {
  if (file.kind === "delete") return null;
  const text = file.encoding === "base64" ? decodeBase64(file.content) : file.content;
  const bumped = bumpPackageLockVersion(text, to);
  if (!bumped) return null;
  return {
    kind: "upsert",
    path: file.path,
    content: file.encoding === "base64" ? encodeBase64(bumped) : bumped,
    encoding: file.encoding,
  };
}

export interface FilePayload {
  content: string;
  encoding: "utf-8" | "base64";
}

/**
 * Chooses which reading of a not-yet-diffed package.json is safe to bump:
 * the base branch's live tip — but only when it's textually identical to
 * the same file at the PR's merge-base.
 *
 * The PR's commit is built with the merge-base as its parent (see
 * memory/decisions/pr-commit-parent-is-merge-base.md), so anything the
 * commit writes is compared against the merge-base's version of that file,
 * not the live tip. If the base already moved this file since the
 * merge-base, that "from" value has silently gone stale: bumping from the
 * live tip would build a commit whose base_tree still shows the old value,
 * so GitHub's three-way merge sees the base's real edit and the injected
 * bump as two different changes to the same line — a conflict this PR
 * didn't otherwise have. Skipping is the only choice that's never wrong;
 * the next PR from a branch whose merge-base has caught up bumps normally.
 */
export function resolveLiveBumpSource(
  atMergeBase: FilePayload | null,
  atBaseTip: FilePayload | null,
): FilePayload | null {
  if (!atMergeBase || !atBaseTip) return null;
  return textOf(atMergeBase) === textOf(atBaseTip) ? atBaseTip : null;
}

function textOf(file: FilePayload): string {
  return file.encoding === "base64" ? decodeBase64(file.content) : file.content;
}
