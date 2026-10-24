// Which board stands for a bb project, and what its icon draws — pure, so bb's thread list (shell/sidebar-row-icon.tsx)
// and other plugins asking over RPC (bbProjectIcons in api/index.ts) put the same icon on a project.
import { DEFAULT_PROJECT_ICON } from "@bb-plugins/icon-catalog";
import { iconDrawing, type IconDrawing } from "./icon-drawing";

export interface LinkedBoard {
  readonly id: string;
  readonly icon?: string;
  readonly color: string;
  readonly linkedBbProjectId: string | null;
  readonly database?: { readonly table?: string } | null;
}

/** The task board linked to the bb project — not a section beside it — or undefined for a project with none. */
export const linkedBoardOf = <Board extends LinkedBoard>(projectId: string, boards: readonly Board[]): Board | undefined =>
  boards.find((board) => board.linkedBbProjectId === projectId && board.database?.table === undefined);

export interface BbProjectIcon {
  readonly bbProjectId: string;
  readonly drawing: IconDrawing;
}

/** The icon of every bb project that has a board, as its row in bb's thread list wears it. */
export function bbProjectIcons(boards: readonly LinkedBoard[]): BbProjectIcon[] {
  const projectIds = new Set(boards.flatMap((board) => board.linkedBbProjectId ?? []));
  return [...projectIds].flatMap((bbProjectId) => {
    const board = linkedBoardOf(bbProjectId, boards);
    const drawing = board === undefined ? null : iconDrawing(board.icon, DEFAULT_PROJECT_ICON, board.color);
    return drawing === null ? [] : [{ bbProjectId, drawing }];
  });
}
