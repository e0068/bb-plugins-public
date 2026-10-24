// Layer: shell, pure. Which bb project a project row of bb's thread list stands for, and which board's icon it wears.
// bb gives plugins no slot on that row: shell/sidebar-row-icon.tsx reads the row off bb's markup and asks here.
import { linkedBoardOf, type LinkedBoard } from "../lib/bb-project-icons.js";

export interface GroupRow {
  /** The project's name as the row shows it. */
  readonly name: string;
  /** The links of the thread rows under it: `/projects/<project>/threads/<thread>`. */
  readonly threadHrefs: readonly string[];
}

export interface NamedProject {
  readonly id: string;
  readonly name: string;
}

/** What a board shows in the row: its icon in its colour. */
export interface RowBoard {
  readonly boardId: string;
  readonly icon: string | undefined;
  readonly color: string;
}

const THREAD_HREF = /\/projects\/(proj_[A-Za-z0-9]+)\/threads\//;

/** The value met most often, or null for none or a tie at the top. */
function mostFrequent(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  return first === undefined || second?.[1] === first[1] ? null : first[0];
}

/**
 * The bb project of a row: the one project of its name; among projects of one name — or for a name not known
 * yet — the one most of its threads name. A thread of another project may sit under a row, so the threads only
 * break a tie. Null when nothing settles it.
 */
export function projectOfGroupRow(row: GroupRow, projects: readonly NamedProject[]): string | null {
  const named = projects.filter((project) => project.name === row.name).map((project) => project.id);
  if (named.length === 1) return named[0]!;
  const linked = row.threadHrefs.flatMap((href) => THREAD_HREF.exec(href)?.[1] ?? []);
  return mostFrequent(named.length === 0 ? linked : linked.filter((id) => named.includes(id)));
}

/** The task board linked to the bb project — not a section beside it — or null for a project with none. */
export function rowBoardOf(projectId: string, boards: readonly LinkedBoard[]): RowBoard | null {
  const board = linkedBoardOf(projectId, boards);
  return board === undefined ? null : { boardId: board.id, icon: board.icon, color: board.color };
}
