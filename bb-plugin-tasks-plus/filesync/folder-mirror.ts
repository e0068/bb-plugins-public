import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * The mirror of a database board in a folder on disk: every live record as a
 * file, with the same text the database row holds. One way only — a hand
 * edit of a file never reaches the database and is written over by the next
 * change of its record. The mirror keeps a list of the files it wrote in
 * `.tasks-mirror.json` beside them and touches no other file. See
 * docs/specs/tasks-zerkalo-doski-bazy-v-papku-na-diske.md, node `mirror`.
 */

// ---------------------------------------------------------------------------
// Core: what to write and what to remove, without a disk
// ---------------------------------------------------------------------------

/** The files the mirror wrote, by file name, with the hash of the text it wrote. */
export type MirrorManifest = ReadonlyMap<string, string>;

export interface MirrorPlan {
  write: readonly { name: string; text: string }[];
  remove: readonly string[];
  manifest: MirrorManifest;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A record's file name: its key, which survives a rename of the record, or its slug while it has none. */
export function mirrorFileName(slug: string, text: string): string {
  const key = parseFrontmatter(text).data.key;
  const stem = typeof key === "string" && SAFE_NAME.test(key) ? key : slug;
  return `${stem}.md`;
}

/**
 * The writes and removals that bring a folder from `manifest` to `snapshot`
 * (record texts by slug): a file whose text changed or is new is written, a
 * file of the mirror no record names any more is removed.
 */
export function mirrorPlan(manifest: MirrorManifest, snapshot: ReadonlyMap<string, string>, hash: (text: string) => string): MirrorPlan {
  const wanted = new Map([...snapshot].map(([slug, text]) => [mirrorFileName(slug, text), text] as const));
  const write = [...wanted]
    .filter(([name, text]) => manifest.get(name) !== hash(text))
    .map(([name, text]) => ({ name, text }));
  const remove = [...manifest.keys()].filter((name) => !wanted.has(name));
  return { write, remove, manifest: new Map([...wanted].map(([name, text]) => [name, hash(text)])) };
}

// ---------------------------------------------------------------------------
// Shell: the folder itself
// ---------------------------------------------------------------------------

export const MIRROR_MANIFEST = ".tasks-mirror.json";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The folder a setting names: `~` is the home folder; anything not absolute is no folder. */
export function mirrorDirectory(setting: string): string | null {
  const trimmed = setting.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  // Resolved, so `/x/` and `/x` are one folder.
  return expanded !== "" && isAbsolute(expanded) ? resolve(expanded) : null;
}

export interface FolderMirror {
  readonly dir: string;
  /** Brings the folder to the records of `snapshot`; one sync at a time. */
  sync(snapshot: ReadonlyMap<string, string>): Promise<void>;
}

async function readManifest(dir: string): Promise<MirrorManifest> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, MIRROR_MANIFEST), "utf8"));
    const files = parsed !== null && typeof parsed === "object" ? (parsed as { files?: unknown }).files : undefined;
    if (files === null || typeof files !== "object") return new Map();
    return new Map(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return new Map();
  }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

async function writeAtomically(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}

export function createFolderMirror(dir: string, warn: (message: string) => void = () => {}): FolderMirror {
  let manifest: Promise<MirrorManifest> | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function run(snapshot: ReadonlyMap<string, string>): Promise<void> {
    manifest ??= readManifest(dir);
    const known = await manifest;
    const plan = mirrorPlan(known, snapshot, sha256);
    await mkdir(dir, { recursive: true });
    // A file the mirror did not write is someone else's: it is left alone, and so is the record that would take its name.
    const foreign = new Set(
      (await Promise.all(plan.write.map(async ({ name }) => (!known.has(name) && (await exists(join(dir, name))) ? name : null)))).filter(
        (name): name is string => name !== null,
      ),
    );
    if (foreign.size > 0) warn(`tasks-plus: the mirror leaves files it did not write in ${dir}: ${[...foreign].join(", ")}`);
    await Promise.all(plan.write.filter(({ name }) => !foreign.has(name)).map(({ name, text }) => writeAtomically(join(dir, name), text)));
    await Promise.all(plan.remove.map((name) => rm(join(dir, name), { force: true })));
    const next = new Map([...plan.manifest].filter(([name]) => !foreign.has(name)));
    await writeAtomically(join(dir, MIRROR_MANIFEST), `${JSON.stringify({ files: Object.fromEntries(next) }, null, 2)}\n`);
    manifest = Promise.resolve(next);
  }

  return {
    dir,
    sync(snapshot) {
      const next = queue.then(() => run(snapshot));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
