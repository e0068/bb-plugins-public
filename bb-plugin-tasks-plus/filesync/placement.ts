import { statusFromFolder } from "./map.js";

/** Where a task sits above its status folder. The path is the only place
 *  these live — `<root>/[<assignee>/[<epic>/]]<status>/<slug>.md` — so there
 *  is no frontmatter copy to disagree with the folder. An epic lives inside
 *  its assignee's folder, hence no epic without an assignee. */
export interface TaskPlacement {
  assignee: string | null;
  epic: string | null;
}

export const NO_PLACEMENT: TaskPlacement = { assignee: null, epic: null };

/** The folders between the tasks root and the status folder. */
export function placementSegments(placement: TaskPlacement): string[] {
  if (placement.assignee === null) return [];
  return placement.epic === null ? [placement.assignee] : [placement.assignee, placement.epic];
}

/** A name that can be one folder: trimmed, no separators, not hidden, and
 *  not a status — `done/` under the root is read as a status, never as an
 *  assignee called "done". */
export function validatePlacementName(raw: string, field: "Assignee" | "Epic"): string {
  const name = raw.trim();
  if (name === "" || /[/\\]/.test(name) || name.startsWith(".")) {
    throw new Error(`${field} ${JSON.stringify(raw)} must be a folder name: not empty, no slashes, not starting with a dot`);
  }
  if (statusFromFolder(name) !== null) {
    throw new Error(`${field} ${JSON.stringify(raw)} reads as a status folder`);
  }
  return name;
}

/** The placement after an update: `undefined` keeps, `null` clears. Taking
 *  the assignee off takes the epic with it — the epic folder was inside. */
export function nextPlacement(
  current: TaskPlacement,
  input: { assignee?: string | null; epic?: string | null },
): TaskPlacement {
  const assignee =
    input.assignee === undefined
      ? current.assignee
      : input.assignee === null ? null : validatePlacementName(input.assignee, "Assignee");
  if (input.epic != null && assignee === null) {
    throw new Error("an epic needs an assignee: the epic folder lives inside the assignee's folder");
  }
  // Only a name that came with the input is checked: the current one is a
  // folder already on disk, and an edit of another field must neither
  // rename it nor fail on it.
  const epic =
    input.epic === undefined
      ? (assignee === null ? null : current.epic)
      : input.epic === null ? null : validatePlacementName(input.epic, "Epic");
  return { assignee, epic };
}
