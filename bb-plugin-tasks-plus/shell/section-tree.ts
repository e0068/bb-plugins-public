import { useCallback, useSyncExternalStore } from "react";
import type { Project } from "../shared/contract.js";

/**
 * The left column's projects as a tree: a project kept in a database holds
 * its top sections, a section the ones inside it. Folding is Shapeshift's tree
 * (src/2-functions/tree-rows.ts, tree-keys.ts — openToDepth, foldLevels,
 * toggleOpen, treeKey, ported as they are): a branch opens and closes by its
 * chevron or the arrows, and the level switch folds the whole tree to a depth.
 * What is closed is kept in the browser profile, so a section added later
 * shows up open.
 */

export interface SectionNode {
  readonly id: string;
  readonly children: readonly SectionNode[];
}

/** A project's row in the tree: its depth and whether it holds rows. */
export interface TreeRow {
  readonly id: string;
  readonly depth: number;
  readonly branch: boolean;
  readonly open: boolean;
}

/** A board that is a section of a project's database, not a project. */
export const isSection = (project: Project): boolean => project.database?.table !== undefined;

/** The sections a row holds: for a project kept in a database its top ones, for a section the ones inside it.
 *  A section whose parent is not on the list stands at the top, so it never goes missing. */
export const sectionsIn = (holder: Project, projects: readonly Project[]): Project[] => {
  const url = holder.database?.url;
  if (url === undefined) return [];
  const sections = projects.filter((candidate) => isSection(candidate) && candidate.database?.url === url);
  const tables = new Set(sections.map((section) => section.database?.table));
  const parentOf = (section: Project): string | undefined =>
    tables.has(section.database?.parent) ? section.database?.parent : undefined;
  return sections.filter((section) => parentOf(section) === holder.database?.table);
};

/** The tree under each of `roots`. */
export const sectionTree = (roots: readonly Project[], projects: readonly Project[]): SectionNode[] =>
  roots.map((root) => ({ id: root.id, children: sectionTree(sectionsIn(root, projects), projects) }));

/** Every section a project holds, at any depth: what deleting it takes along. */
export const sectionsUnder = (holder: Project, projects: readonly Project[]): Project[] =>
  sectionsIn(holder, projects).flatMap((section) => [section, ...sectionsUnder(section, projects)]);

/** Whether `section` may be dropped on `target`: a row of its own project's database that is neither the section,
 *  nor a section inside it, nor the row it already sits in. */
export const takesSection = (target: Project, section: Project, projects: readonly Project[]): boolean =>
  target.id !== section.id &&
  target.database?.url === section.database?.url &&
  !sectionsUnder(section, projects).some((inner) => inner.id === target.id) &&
  !sectionsIn(target, projects).some((inner) => inner.id === section.id);

/** The rows drawn: each node, and under an open one its children, a step deeper. */
export const treeRows = (nodes: readonly SectionNode[], closed: ReadonlySet<string>, depth = 0): TreeRow[] =>
  nodes.flatMap((node) => {
    const branch = node.children.length > 0;
    const open = branch && !closed.has(node.id);
    const row: TreeRow = { id: node.id, depth, branch, open };
    return open ? [row, ...treeRows(node.children, closed, depth + 1)] : [row];
  });

const treeDepth = (nodes: readonly SectionNode[], at = 1): number =>
  nodes.reduce((deepest, node) => Math.max(deepest, at, node.children.length > 0 ? treeDepth(node.children, at + 1) : 0), 0);

/** How many levels the tree has — as many as the switch offers to fold it to. */
export const foldLevels = (nodes: readonly SectionNode[]): readonly number[] => Array.from({ length: treeDepth(nodes) }, (_, at) => at + 1);

/** The branches open when the tree shows `depth` levels; leaves are never in it. */
export function openToDepth(nodes: readonly SectionNode[], depth: number, at = 1): ReadonlySet<string> {
  const out = new Set<string>();
  if (at >= depth) return out;
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    out.add(node.id);
    for (const id of openToDepth(node.children, depth, at + 1)) out.add(id);
  }
  return out;
}

const branchesOf = (nodes: readonly SectionNode[]): string[] =>
  nodes.flatMap((node) => (node.children.length > 0 ? [node.id, ...branchesOf(node.children)] : []));

/** The branches closed when the tree is folded to `depth` levels. */
export const closedAtDepth = (nodes: readonly SectionNode[], depth: number): ReadonlySet<string> => {
  const open = openToDepth(nodes, depth);
  return new Set(branchesOf(nodes).filter((id) => !open.has(id)));
};

/** The level whose rows the tree draws now, or null when its branches were opened and closed by hand. */
export function foldedLevel(nodes: readonly SectionNode[], closed: ReadonlySet<string>): number | null {
  const drawn = treeRows(nodes, closed).map((row) => row.id).join("\n");
  return foldLevels(nodes).find((level) => treeRows(nodes, closedAtDepth(nodes, level)).map((row) => row.id).join("\n") === drawn) ?? null;
}

/** A new set with `id` if it was not there, without it if it was. */
export function toggleOpen(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

export interface KeyMove {
  readonly current: string | null;
  readonly toggle: string | null;
}

const parentAbove = (rows: readonly TreeRow[], index: number, depth: number): TreeRow | null =>
  [...rows.slice(0, index)].reverse().find((row) => row.depth === depth - 1) ?? null;

const childBelow = (rows: readonly TreeRow[], index: number, depth: number): TreeRow | null => {
  const next = rows[index + 1];
  return next !== undefined && next.depth === depth + 1 ? next : null;
};

type Handler = (rows: readonly TreeRow[], index: number, row: TreeRow) => KeyMove;

const HANDLERS: Readonly<Record<string, Handler>> = {
  Home: (rows) => ({ current: rows[0]!.id, toggle: null }),
  End: (rows) => ({ current: rows[rows.length - 1]!.id, toggle: null }),
  ArrowDown: (rows, index) => ({ current: rows[Math.min(index + 1, rows.length - 1)]!.id, toggle: null }),
  ArrowUp: (rows, index) => ({ current: rows[Math.max(index - 1, 0)]!.id, toggle: null }),
  ArrowRight: (rows, index, row) => {
    if (!row.branch) return { current: row.id, toggle: null };
    if (!row.open) return { current: row.id, toggle: row.id };
    return { current: childBelow(rows, index, row.depth)?.id ?? row.id, toggle: null };
  },
  ArrowLeft: (rows, index, row) => {
    if (row.branch && row.open) return { current: row.id, toggle: row.id };
    return { current: (row.depth > 0 ? parentAbove(rows, index, row.depth) : null)?.id ?? row.id, toggle: null };
  },
};

/** The arrows, Home and End walk the drawn rows and name the branch to open or close; other keys move nothing. */
export function treeKey(rows: readonly TreeRow[], current: string | null, key: string): KeyMove {
  const handler = Object.hasOwn(HANDLERS, key) ? HANDLERS[key]! : null;
  if (handler === null) return { current, toggle: null };
  if (rows.length === 0) return { current: null, toggle: null };
  if (key === "Home" || key === "End") return handler(rows, -1, rows[0]!);
  const index = rows.findIndex((row) => row.id === current);
  if (index === -1) return { current: rows[0]!.id, toggle: null };
  return handler(rows, index, rows[index]!);
}

// ---------------------------------------------------------------------------
// Shell: the closed branches in the browser profile
// ---------------------------------------------------------------------------

export const CLOSED_SECTIONS_STORAGE_KEY = "bb-tasks:closed-sections";

let closed: ReadonlySet<string> = readClosed();
const listeners = new Set<() => void>();

function readClosed(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CLOSED_SECTIONS_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The closed branches and a setter: kept for the session even where the profile refuses to store them. */
export function useClosedSections(): [ReadonlySet<string>, (next: (current: ReadonlySet<string>) => ReadonlySet<string>) => void] {
  const current = useSyncExternalStore(subscribe, () => closed);
  const set = useCallback((next: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
    closed = next(closed);
    try {
      localStorage.setItem(CLOSED_SECTIONS_STORAGE_KEY, JSON.stringify([...closed]));
    } catch {
      // A private window keeps the fold for the session only.
    }
    listeners.forEach((notify) => notify());
  }, []);
  return [current, set];
}
