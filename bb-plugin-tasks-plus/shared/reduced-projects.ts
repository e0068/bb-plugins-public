// Whether Reduced Colors repaints the analytics' projects with its ramp, or
// leaves each its own colour. A Tasks+ choice beside the shared Reduced
// Colors setting: only Tasks+ projects have colours of their own. Pure and
// zod-free, so the client may import it (shared/frontend-bundle.test.ts).

/** Repaint with the ramp, or keep each project's own colour. */
export const REDUCED_PROJECTS = ["ramp", "own"] as const;

export type ReducedProjects = (typeof REDUCED_PROJECTS)[number];

/** The plugin kv key the choice is stored under. */
export const REDUCED_PROJECTS_KV_KEY = "reduced-colors-projects";

/** Repaint, as the analytics did before the choice existed. */
export const DEFAULT_REDUCED_PROJECTS: ReducedProjects = "ramp";

/** A stored value → the choice; anything but the two answers is the default. */
export function parseReducedProjects(raw: unknown): ReducedProjects {
  return REDUCED_PROJECTS.find((value) => value === raw) ?? DEFAULT_REDUCED_PROJECTS;
}
